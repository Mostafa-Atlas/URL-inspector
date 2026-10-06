import { useState } from 'react';

interface Result {
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
          <div className="grid">
            <div>
              <span>Status</span>
              <strong className={result.ok ? 'ok' : 'bad'}>
                {result.status} {result.statusText}
              </strong>
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
              <strong>
                {result.sizeBytes < 1024
                  ? `${result.sizeBytes} B`
                  : `${(result.sizeBytes / 1024).toFixed(1)} KB`}
              </strong>
            </div>
            <div>
              <span>Redirects</span>
              <strong>{result.redirectCount}</strong>
            </div>
            <div>
              <span>Server</span>
              <strong>{result.server || '—'}</strong>
            </div>
          </div>
          <p className="urls">
            Request: <code>{result.url}</code>
            <br />
            Final: <code>{result.finalUrl}</code>
          </p>
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
