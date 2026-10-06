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

export function parseTarget(input: string): URL {
  let u: URL;
  try {
    u = new URL(input.trim());
  } catch {
    throw new InspectError(400, 'Invalid URL');
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') {
    throw new InspectError(400, 'Invalid URL');
  }
  return u;
}

export async function inspectUrl(input: string): Promise<InspectResult> {
  const startUrl = parseTarget(input);
  const start = Date.now();
  let current = startUrl.toString();
  let redirectCount = 0;
  let res: Response | null = null;

  for (let i = 0; i <= MAX_REDIRECTS; i++) {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
    try {
      res = await fetch(current, {
        redirect: 'manual',
        signal: ctrl.signal,
        headers: { 'user-agent': 'http-inspector/0.1' },
      });
    } catch (e: unknown) {
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
      parseTarget(current);
      redirectCount++;
      continue;
    }
    break;
  }

  if (!res) throw new InspectError(502, 'The server could not reach this address.');

  const buf = await res.arrayBuffer().catch(() => {
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
    sizeBytes: buf.byteLength,
    server: res.headers.get('server'),
    headers,
  };
}
