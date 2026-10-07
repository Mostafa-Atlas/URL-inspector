import { useState } from 'react';

interface Result {
  url: string;
  finalUrl: string;
  method: string;
  status: number;
  statusText: string;
  ok: boolean;
  responseTimeMs: number;
  timing: { dnsMs: number; ttfbMs: number; bodyMs: number; totalMs: number };
  redirectCount: number;
  redirects: { url: string; status: number }[];
  contentType: string | null;
  sizeBytes: number;
  server: string | null;
  headers: Record<string, string>;
  previewText: string | null;
  previewTruncated: boolean;
  pageTitle: string | null;
  security: { name: string; present: boolean; value: string | null }[];
  caching: {
    cacheControl: string | null;
    etag: string | null;
    age: string | null;
    expires: string | null;
    contentEncoding: string | null;
  };
  cookies: string[];
  cert: {
    subject: string;
    issuer: string;
    validFrom: string;
    validTo: string;
    daysLeft: number;
  } | null;
}

function fmtSize(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(2)} MB`;
}

function Bar({ label, ms, total }: { label: string; ms: number; total: number }) {
  const pct = total > 0 ? Math.max(2, Math.round((ms / total) * 100)) : 0;
  return (
    <div className="bar-row">
      <span className="bar-label">{label}</span>
      <div className="bar-track">
        <div className="bar-fill" style={{ width: `${pct}%` }} />
      </div>
      <span className="bar-ms">{ms} ms</span>
    </div>
  );
}

function parseHeaderLines(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of text.split('\n')) {
    const i = line.indexOf(':');
    if (i < 1) continue;
    const name = line.slice(0, i).trim();
    const value = line.slice(i + 1).trim();
    if (name && value) out[name] = value;
  }
  return out;
}

async function fetchInspect(
  target: string,
  opts: { method: string; headers: Record<string, string>; body: string }
): Promise<{ ok: boolean; data: Result & { error?: string } }> {
  const custom = opts.method !== 'GET' || Object.keys(opts.headers).length > 0 || opts.body !== '';
  const r = custom
    ? await fetch('/api/inspect', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ url: target, method: opts.method, headers: opts.headers, body: opts.body || undefined }),
      })
    : await fetch(`/api/inspect?url=${encodeURIComponent(target)}`);
  return { ok: r.ok, data: await r.json() };
}

export default function App() {
  const [url, setUrl] = useState('https://example.com');
  const [method, setMethod] = useState('GET');
  const [headerText, setHeaderText] = useState('');
  const [bodyText, setBodyText] = useState('');
  const [result, setResult] = useState<Result | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [touched, setTouched] = useState(false);

  async function onInspect(e: React.FormEvent) {
    e.preventDefault();
    setTouched(true);
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      const { ok, data } = await fetchInspect(url, {
        method,
        headers: parseHeaderLines(headerText),
        body: bodyText,
      });
      if (!ok) {
        setError(data.error || 'Something went wrong.');
        return;
      }
      setResult(data as Result);
    } catch {
      setError('The server could not reach this address.');
    } finally {
      setLoading(false);
    }
  }

  const t = result?.timing;

  return (
    <main className="wrap">
      <h1>HTTP Inspector</h1>
      <p className="sub">Enter a URL to inspect it.</p>
      <form className="row" onSubmit={onInspect}>
        <input
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="https://example.com"
          inputMode="url"
          aria-label="URL to inspect"
        />
        <button type="submit" disabled={loading}>
          {loading ? 'Inspecting…' : 'Inspect'}
        </button>
      </form>
      <details className="opts">
        <summary>Request options</summary>
        <label>
          Method
          <select value={method} onChange={(e) => setMethod(e.target.value)}>
            {['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'].map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </select>
        </label>
        <label>
          Headers, one per line as Name: value
          <textarea
            value={headerText}
            onChange={(e) => setHeaderText(e.target.value)}
            placeholder={'X-Test: 1'}
            rows={3}
            aria-label="Custom request headers"
          />
        </label>
        <label>
          Body (POST, PUT, PATCH, DELETE only)
          <textarea
            value={bodyText}
            onChange={(e) => setBodyText(e.target.value)}
            placeholder='{"a": 1}'
            rows={4}
            aria-label="Request body"
          />
        </label>
      </details>

      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {loading && <p className="hint">Inspecting…</p>}
      {!touched && !result && !error && !loading && (
        <p className="hint">Enter a URL above and hit Inspect to see status, timing, and headers.</p>
      )}

      {result && (
        <section className="card" aria-live="polite">
          <p className={`badge ${result.ok ? 'ok' : 'bad'}`}>
            {result.status} {result.statusText}
          </p>
          <div className="grid">
            <div>
              <span>Method</span>
              <strong>{result.method}</strong>
            </div>
            <div>
              <span>Response</span>
              <strong>{result.responseTimeMs} ms</strong>
            </div>
            <div>
              <span>Content-Type</span>
              <strong>{result.contentType || '—'}</strong>
            </div>
            <div>
              <span>Size</span>
              <strong>{fmtSize(result.sizeBytes)}</strong>
            </div>
            <div>
              <span>Redirects</span>
              <strong>{result.redirectCount}</strong>
            </div>
            <div>
              <span>Server</span>
              <strong>{result.server || '—'}</strong>
            </div>
            <div>
              <span>Page title</span>
              <strong>{result.pageTitle || '—'}</strong>
            </div>
          </div>

          {t && (
            <>
              <h2>Timing</h2>
              <Bar label="DNS lookup" ms={t.dnsMs} total={t.totalMs} />
              <Bar label="Wait for headers" ms={t.ttfbMs} total={t.totalMs} />
              <Bar label="Download body" ms={t.bodyMs} total={t.totalMs} />
              <Bar label="Total" ms={t.totalMs} total={t.totalMs} />
            </>
          )}

          <p className="urls">
            Request: <code>{result.url}</code>
            <br />
            Final: <code>{result.finalUrl}</code>
          </p>

          <h2>Redirects</h2>
          {result.redirects.length === 0 ? (
            <p className="hint">Direct, no redirects.</p>
          ) : (
            <ol className="chain">
              {result.redirects.map((h, i) => (
                <li key={i}>
                  <code>{h.status}</code> <code>{h.url}</code>
                </li>
              ))}
              <li>
                <code>{result.status}</code> <code>{result.finalUrl}</code>
              </li>
            </ol>
          )}

          {result.previewText && (
            <>
              <h2>Body preview</h2>
              <pre className="headers">{result.previewText}</pre>
              {result.previewTruncated && <p className="hint">Truncated to first 2 KB.</p>}
            </>
          )}

          <h2>Security headers</h2>
          <ul className="checks">
            {result.security.map((h) => (
              <li key={h.name}>
                <span className={h.present ? 'good' : 'missing'}>{h.present ? 'Yes' : 'No'}</span>{' '}
                <code>{h.name}</code>
                {h.present && h.value && <span className="hint"> — {h.value.slice(0, 80)}</span>}
              </li>
            ))}
          </ul>

          <h2>Caching and compression</h2>
          <div className="grid">
            <div>
              <span>Cache-Control</span>
              <strong>{result.caching.cacheControl || '—'}</strong>
            </div>
            <div>
              <span>ETag</span>
              <strong>{result.caching.etag || '—'}</strong>
            </div>
            <div>
              <span>Age / Expires</span>
              <strong>{result.caching.age || result.caching.expires || '—'}</strong>
            </div>
            <div>
              <span>Encoding</span>
              <strong>{result.caching.contentEncoding || '—'}</strong>
            </div>
          </div>

          <h2>Cookies ({result.cookies.length})</h2>
          {result.cookies.length === 0 ? (
            <p className="hint">None set.</p>
          ) : (
            <ul className="checks">
              {result.cookies.map((c, i) => (
                <li key={i}>
                  <code>{c.split(';')[0].trim()}</code>
                </li>
              ))}
            </ul>
          )}

          {result.cert && (
            <>
              <h2>Certificate</h2>
              <div className="grid">
                <div>
                  <span>Subject</span>
                  <strong>{result.cert.subject}</strong>
                </div>
                <div>
                  <span>Issuer</span>
                  <strong>{result.cert.issuer}</strong>
                </div>
                <div>
                  <span>Expires</span>
                  <strong>{result.cert.validTo}</strong>
                </div>
                <div>
                  <span>Days left</span>
                  <strong className={result.cert.daysLeft < 30 ? 'missing' : 'good'}>
                    {result.cert.daysLeft}
                  </strong>
                </div>
              </div>
            </>
          )}

          <h2>Response Headers</h2>
          <pre className="headers">
            {Object.entries(result.headers)
              .map(([k, v]) => `${k}: ${v}`)
              .join('\n')}
          </pre>
        </section>
      )}
    </main>
  );
}
