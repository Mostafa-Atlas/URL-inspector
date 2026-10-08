import dns from 'node:dns/promises';
import net from 'node:net';
import tls from 'node:tls';

export interface Timing {
  dnsMs: number;
  ttfbMs: number;
  bodyMs: number;
  totalMs: number;
}

export interface RedirectHop {
  url: string;
  status: number;
}

export interface SecurityHeader {
  name: string;
  present: boolean;
  value: string | null;
}

export interface CertInfo {
  subject: string;
  issuer: string;
  validFrom: string;
  validTo: string;
  daysLeft: number;
}

export interface Caching {
  cacheControl: string | null;
  etag: string | null;
  age: string | null;
  expires: string | null;
  contentEncoding: string | null;
}

export interface InspectResult {
  url: string;
  finalUrl: string;
  method: string;
  status: number;
  statusText: string;
  ok: boolean;
  responseTimeMs: number;
  timing: Timing;
  redirectCount: number;
  redirects: RedirectHop[];
  contentType: string | null;
  sizeBytes: number;
  server: string | null;
  headers: Record<string, string>;
  previewText: string | null;
  previewTruncated: boolean;
  pageTitle: string | null;
  security: SecurityHeader[];
  caching: Caching;
  cookies: string[];
  cert: CertInfo | null;
  ips: string[];
}

export interface InspectOptions {
  method?: string;
  headers?: Record<string, string>;
  body?: string;
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
export const PREVIEW_BYTES = 2048;
export const MAX_BODY_BYTES = 100_000;
export const MAX_HEADERS = 10;

const ALLOWED_METHODS = ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'];
const BLOCKED_HEADERS = [
  'host',
  'content-length',
  'connection',
  'keep-alive',
  'transfer-encoding',
  'upgrade',
  'te',
  'trailer',
  'proxy-authenticate',
  'proxy-authorization',
];

export function normalizeOptions(options?: InspectOptions): {
  method: string;
  headers: Record<string, string>;
  body?: string;
} {
  const method = (options?.method || 'GET').toUpperCase();
  if (!ALLOWED_METHODS.includes(method)) {
    throw new InspectError(400, 'Method not allowed.');
  }
  const raw = options?.headers || {};
  const names = Object.keys(raw);
  if (names.length > MAX_HEADERS) {
    throw new InspectError(400, 'Too many headers.');
  }
  const headers: Record<string, string> = {};
  for (const n of names) {
    const name = n.toLowerCase().trim();
    if (!/^[a-z0-9-]+$/.test(name) || name.length > 64) {
      throw new InspectError(400, 'Invalid header name.');
    }
    if (BLOCKED_HEADERS.includes(name)) {
      throw new InspectError(400, `Header not allowed: ${name}`);
    }
    const value = String(raw[n]);
    if (value.length > 2048) throw new InspectError(400, 'Header value too long.');
    headers[name] = value;
  }
  const body = options?.body;
  if (body !== undefined && body !== '') {
    if (method === 'GET' || method === 'HEAD') {
      throw new InspectError(400, 'Body needs POST, PUT, PATCH, or DELETE.');
    }
    if (body.length > MAX_BODY_BYTES) {
      throw new InspectError(413, 'Request body too large.');
    }
    return { method, headers, body };
  }
  return { method, headers };
}

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

const SECURITY_HEADERS = [
  'strict-transport-security',
  'content-security-policy',
  'x-frame-options',
  'x-content-type-options',
  'referrer-policy',
];

export function securityHeaders(headers: Record<string, string>): SecurityHeader[] {
  return SECURITY_HEADERS.map((name) => ({
    name,
    present: name in headers,
    value: headers[name] ?? null,
  }));
}

function getCookies(res: Response, headers: Record<string, string>): string[] {
  const withMethod = res.headers as unknown as { getSetCookie?: () => string[] };
  if (typeof withMethod.getSetCookie === 'function') {
    return withMethod.getSetCookie();
  }
  const raw = headers['set-cookie'];
  if (!raw) return [];
  return [raw];
}

export function certDaysLeft(validTo: string, now = Date.now()): number {
  return Math.ceil((new Date(validTo).getTime() - now) / 86_400_000);
}

async function getCert(hostname: string): Promise<CertInfo | null> {
  if (net.isIP(hostname)) return null;
  return new Promise((resolve) => {
    const socket = tls.connect(
      { host: hostname, port: 443, servername: hostname, rejectUnauthorized: false, timeout: 5000 },
      () => {
        const c = socket.getPeerCertificate() as unknown as Record<string, unknown>;
        socket.end();
        if (!c || !c.valid_to) return resolve(null);
        const issuer = c.issuer as Record<string, string> | undefined;
        const subject = c.subject as Record<string, string> | undefined;
        const validTo = String(c.valid_to);
        resolve({
          subject: subject?.CN ?? hostname,
          issuer: issuer?.O ?? issuer?.CN ?? 'unknown',
          validFrom: String(c.valid_from ?? ''),
          validTo,
          daysLeft: certDaysLeft(validTo),
        });
      }
    );
    socket.on('error', () => resolve(null));
    socket.on('timeout', () => {
      socket.destroy();
      resolve(null);
    });
    setTimeout(() => resolve(null), 6000).unref?.();
  });
}

function allowPrivate(): boolean {
  // test-only bypass so local servers can be inspected
  return process.env.ALLOW_PRIVATE === '1';
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
  if (!allowPrivate()) {
    if (isBlockedHostname(u.hostname)) {
      throw new InspectError(403, 'The destination is not allowed.');
    }
    if (net.isIP(u.hostname) && isPrivateIP(u.hostname)) {
      throw new InspectError(403, 'The destination is not allowed.');
    }
  }
  return u;
}

export async function assertSafeHost(hostname: string): Promise<void> {
  if (allowPrivate()) return;
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

export async function resolveAddresses(hostname: string): Promise<string[]> {
  if (net.isIP(hostname)) return [hostname];
  try {
    const records = await dns.lookup(hostname, { all: true });
    return [...new Set(records.map((r) => r.address))];
  } catch {
    return [];
  }
}

async function readWithLimit(res: Response): Promise<{ sizeBytes: number; preview: Uint8Array }> {
  const chunks: Uint8Array[] = [];
  let previewLen = 0;
  const pushPreview = (value: Uint8Array) => {
    if (previewLen >= PREVIEW_BYTES) return;
    const take = Math.min(value.byteLength, PREVIEW_BYTES - previewLen);
    chunks.push(value.slice(0, take));
    previewLen += take;
  };
  if (!res.body) {
    const buf = await res.arrayBuffer();
    if (buf.byteLength > MAX_BYTES) {
      throw new InspectError(413, 'The response was too large.');
    }
    const bytes = new Uint8Array(buf);
    pushPreview(bytes);
    return { sizeBytes: buf.byteLength, preview: concat(chunks) };
  }
  const reader = res.body.getReader();
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    pushPreview(value);
    if (total > MAX_BYTES) {
      await reader.cancel().catch(() => undefined);
      throw new InspectError(413, 'The response was too large.');
    }
  }
  return { sizeBytes: total, preview: concat(chunks) };
}

function concat(parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.byteLength, 0));
  let off = 0;
  for (const p of parts) {
    out.set(p, off);
    off += p.byteLength;
  }
  return out;
}

function buildPreview(contentType: string | null, preview: Uint8Array, sizeBytes: number) {
  const ct = (contentType || '').toLowerCase();
  const textLike = /text\/|json|javascript|xml|html|urlencoded/.test(ct) || sizeBytes === 0;
  if (!textLike) {
    return { previewText: null, previewTruncated: false, pageTitle: null };
  }
  let text = new TextDecoder('utf-8', { fatal: false }).decode(preview);
  let title: string | null = null;
  if (ct.includes('html')) {
    const m = text.match(/<title[^>]*>([^<]{1,200})<\/title>/i);
    if (m) title = m[1].trim();
  }
  if (ct.includes('json')) {
    try {
      const parsed: unknown = JSON.parse(new TextDecoder().decode(preview));
      text = JSON.stringify(parsed, null, 2).slice(0, PREVIEW_BYTES);
    } catch {
      // truncated or non-JSON body, show raw text
    }
  }
  return {
    previewText: text || null,
    previewTruncated: sizeBytes > preview.byteLength,
    pageTitle: title,
  };
}

export async function inspectUrl(input: string, options?: InspectOptions): Promise<InspectResult> {
  const startUrl = parseTarget(input);
  const { method, headers: userHeaders, body } = normalizeOptions(options);
  const dnsStart = Date.now();
  await assertSafeHost(startUrl.hostname);
  const dnsMs = Date.now() - dnsStart;
  const start = Date.now();
  let current = startUrl.toString();
  let redirectCount = 0;
  const redirects: RedirectHop[] = [];
  let res: Response | null = null;
  let ttfbMs = 0;

  for (let i = 0; i <= MAX_REDIRECTS; i++) {
    const u = parseTarget(current);
    await assertSafeHost(u.hostname);
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
    const fetchStart = Date.now();
    try {
      res = await fetch(current, {
        method,
        redirect: 'manual',
        signal: ctrl.signal,
        headers: { 'user-agent': 'http-inspector/0.1', ...userHeaders },
        body,
      });
      if (i === redirectCount) ttfbMs = Date.now() - fetchStart;
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
      redirects.push({ url: current, status });
      current = new URL(loc, current).toString();
      redirectCount++;
      continue;
    }
    break;
  }

  if (!res) throw new InspectError(502, 'The server could not reach this address.');

  const bodyStart = Date.now();
  const { sizeBytes, preview } = await readWithLimit(res).catch((e) => {
    if (e instanceof InspectError) throw e;
    throw new InspectError(502, 'The server could not reach this address.');
  });
  const bodyMs = Date.now() - bodyStart;
  const totalMs = Date.now() - start;
  const contentType = res.headers.get('content-type');
  const { previewText, previewTruncated, pageTitle } = buildPreview(contentType, preview, sizeBytes);
  const headers: Record<string, string> = {};
  res.headers.forEach((v, k) => {
    headers[k] = v;
  });

  return {
    url: startUrl.toString(),
    finalUrl: current,
    method,
    status: res.status,
    statusText: res.statusText,
    ok: res.ok,
    responseTimeMs: totalMs,
    timing: { dnsMs, ttfbMs, bodyMs, totalMs },
    redirectCount,
    redirects,
    contentType,
    sizeBytes,
    server: res.headers.get('server'),
    headers,
    previewText,
    previewTruncated,
    pageTitle,
    security: securityHeaders(headers),
    caching: {
      cacheControl: headers['cache-control'] ?? null,
      etag: headers['etag'] ?? null,
      age: headers['age'] ?? null,
      expires: headers['expires'] ?? null,
      contentEncoding: headers['content-encoding'] ?? null,
    },
    cookies: getCookies(res, headers),
    cert: current.startsWith('https:')
      ? await getCert(new URL(current).hostname).catch(() => null)
      : null,
    ips: await resolveAddresses(new URL(current).hostname).catch(() => []),
  };
}
