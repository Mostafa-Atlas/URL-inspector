import { useState } from 'react';

interface Result {
  url: string;
  finalUrl: string;
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

export default function App() {
  const [url, setUrl] = useState('https://example.com');
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
      const r = await fetch(`/api/inspect?url=${encodeURIComponent(url)}`);
      const data = await r.json();
      if (!r.ok) {
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
