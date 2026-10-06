import dns from 'node:dns/promises';
import net from 'node:net';

export interface InspectResult {
  url: string;
  finalUrl: string;
  status: number;
  statusText: string;
  ok: boolean;
  responseTimeMs: number;
  redirectCount: number;
  contentType: string | null;
  sizeBytes: number;
  server: string | null;
  headers: Record<string, string>;
}

export class InspectError extends Error {
  status: number;
  publicMessage: string;
  constructor(status: number, publicMessage: string) {
    super(publicMessage);
    this.status = status;
    this.publicMessage = publicMessage;
  }
}

export const MAX_REDIRECTS = 5;
export const TIMEOUT_MS = 10_000;
export const MAX_BYTES = 2_000_000;

function ipv4ToInt(ip: string): number {
  const p = ip.split('.').map(Number);
  return ((p[0] * 256 + p[1]) * 256 + p[2]) * 256 + p[3];
}

function inCidr(ip: string, cidr: string): boolean {
  const [base, bitsStr] = cidr.split('/');
  const bits = Number(bitsStr);
  const mask = bits === 0 ? 0 : (0xffffffff - (2 ** (32 - bits) - 1)) >>> 0;
  return (ipv4ToInt(ip) & mask) === (ipv4ToInt(base) & mask);
}

const BLOCKED_V4 = [
  '10.0.0.0/8',
  '172.16.0.0/12',
  '192.168.0.0/16',
  '127.0.0.0/8',
  '0.0.0.0/8',
  '169.254.0.0/16',
  '192.0.2.0/24',
  '198.51.100.0/24',
  '203.0.113.0/24',
  '224.0.0.0/4',
  '100.64.0.0/10',
];

export function isPrivateIP(ip: string): boolean {
  if (net.isIP(ip) === 0) return false;
  if (net.isIPv4(ip)) {
    if (ip === '255.255.255.255') return true;
    return BLOCKED_V4.some((c) => inCidr(ip, c));
  }
  const v = ip.toLowerCase();
  if (v === '::1' || v === '::') return true;
  if (v.startsWith('fe80:') || v.startsWith('fec0:') || v.startsWith('ff')) return true;
  if (v.startsWith('fc') || v.startsWith('fd')) return true; // fc00::/7
  return false;
}

export function isBlockedHostname(host: string): boolean {
  const h = host.toLowerCase().replace(/\.$/, '');
  if (h === 'localhost') return true;
  if (h.endsWith('.localhost')) return true;
  if (h.endsWith('.local') || h.endsWith('.internal') || h.endsWith('.lan')) return true;
  if (h === 'metadata.google.internal') return true;
  return false;
}

export function parseTarget(input: string): URL {
  let u: URL;
  try {
    u = new URL((input || '').trim());
  } catch {
    throw new InspectError(400, 'Invalid URL');
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') {
    throw new InspectError(400, 'Invalid URL');
  }
  if (u.username || u.password) {
    throw new InspectError(400, 'Invalid URL');
  }
  if (!u.hostname) throw new InspectError(400, 'Invalid URL');
  if (isBlockedHostname(u.hostname)) {
    throw new InspectError(403, 'The destination is not allowed.');
  }
  if (net.isIP(u.hostname) && isPrivateIP(u.hostname)) {
    throw new InspectError(403, 'The destination is not allowed.');
  }
  return u;
}

export async function assertSafeHost(hostname: string): Promise<void> {
  if (isBlockedHostname(hostname)) {
    throw new InspectError(403, 'The destination is not allowed.');
  }
  if (net.isIP(hostname)) {
    if (isPrivateIP(hostname)) throw new InspectError(403, 'The destination is not allowed.');
    return;
  }
  // ponytail: DNS lookup per hop, TOCTOU gap remains — pin IP or filter egress if this becomes high-risk
  let records: { address: string }[];
  try {
    records = await dns.lookup(hostname, { all: true });
  } catch {
    throw new InspectError(502, 'The server could not reach this address.');
  }
  for (const r of records) {
    if (isPrivateIP(r.address)) {
      throw new InspectError(403, 'The destination is not allowed.');
    }
  }
}

async function readWithLimit(res: Response): Promise<number> {
  if (!res.body) {
    const buf = await res.arrayBuffer();
    if (buf.byteLength > MAX_BYTES) {
      throw new InspectError(413, 'The response was too large.');
    }
    return buf.byteLength;
  }
  const reader = res.body.getReader();
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_BYTES) {
      await reader.cancel().catch(() => undefined);
      throw new InspectError(413, 'The response was too large.');
    }
  }
  return total;
}

export async function inspectUrl(input: string): Promise<InspectResult> {
  const startUrl = parseTarget(input);
  await assertSafeHost(startUrl.hostname);
  const start = Date.now();
  let current = startUrl.toString();
  let redirectCount = 0;
  let res: Response | null = null;

  for (let i = 0; i <= MAX_REDIRECTS; i++) {
    const u = parseTarget(current);
    await assertSafeHost(u.hostname);
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
    try {
      res = await fetch(current, {
        redirect: 'manual',
        signal: ctrl.signal,
        headers: { 'user-agent': 'http-inspector/0.1' },
      });
    } catch (e: unknown) {
      if (e instanceof InspectError) throw e;
      if ((e as Error)?.name === 'AbortError') {
        throw new InspectError(504, 'The request timed out.');
      }
      throw new InspectError(502, 'The server could not reach this address.');
    } finally {
      clearTimeout(t);
    }

    const status = res!.status;
    if (status >= 300 && status < 400) {
      const loc = res!.headers.get('location');
      if (!loc) break;
      if (redirectCount >= MAX_REDIRECTS) {
        throw new InspectError(508, 'Too many redirects.');
      }
      current = new URL(loc, current).toString();
      redirectCount++;
      continue;
    }
    break;
  }

  if (!res) throw new InspectError(502, 'The server could not reach this address.');

  const sizeBytes = await readWithLimit(res).catch((e) => {
    if (e instanceof InspectError) throw e;
    throw new InspectError(502, 'The server could not reach this address.');
  });
  const headers: Record<string, string> = {};
  res.headers.forEach((v, k) => {
    headers[k] = v;
  });

  return {
    url: startUrl.toString(),
    finalUrl: current,
    status: res.status,
    statusText: res.statusText,
    ok: res.ok,
    responseTimeMs: Date.now() - start,
    redirectCount,
    contentType: res.headers.get('content-type'),
    sizeBytes,
    server: res.headers.get('server'),
    headers,
  };
}
