import { useEffect, useRef, useState } from 'react';
import { ResultCard, diffResults, type Diff, type Result } from './ResultCard';
import { ExportButtons } from './export';
import {
  clearHistory,
  findPrevious,
  loadHistory,
  saveHistory,
  type HistoryEntry,
} from './history';

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
        body: JSON.stringify({
          url: target,
          method: opts.method,
          headers: opts.headers,
          body: opts.body || undefined,
        }),
      })
    : await fetch(`/api/inspect?url=${encodeURIComponent(target)}`);
  return { ok: r.ok, data: await r.json() };
}

export default function App() {
  const [mode, setMode] = useState<'single' | 'compare'>('single');
  const [url, setUrl] = useState('https://example.com');
  const [url2, setUrl2] = useState('https://example.org');
  const [method, setMethod] = useState('GET');
  const [headerText, setHeaderText] = useState('');
  const [bodyText, setBodyText] = useState('');
  const [result, setResult] = useState<Result | null>(null);
  const [result2, setResult2] = useState<Result | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [error2, setError2] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [touched, setTouched] = useState(false);
  const [history, setHistory] = useState<HistoryEntry[]>(() => loadHistory());
  const [lastDiff, setLastDiff] = useState<{ at: number; rows: Diff[] } | null>(null);
  const [dark, setDark] = useState(() => {
    try {
      const saved = localStorage.getItem('http-inspector-theme');
      if (saved) return saved === 'dark';
    } catch {
      // storage unavailable, fall through to system preference
    }
    return typeof matchMedia === 'function' && matchMedia('(prefers-color-scheme: dark)').matches;
  });
  const ranShared = useRef(false);

  useEffect(() => {
    document.documentElement.dataset.theme = dark ? 'dark' : 'light';
    try {
      localStorage.setItem('http-inspector-theme', dark ? 'dark' : 'light');
    } catch {
      // ignore
    }
  }, [dark]);

  useEffect(() => {
    if (ranShared.current) return;
    ranShared.current = true;
    const q = new URLSearchParams(location.search);
    const shared = q.get('url');
    if (!shared) return;
    const m = (q.get('method') || 'GET').toUpperCase();
    setUrl(shared);
    setMethod(m);
    setTouched(true);
    setLoading(true);
    fetchInspect(shared, { method: m, headers: {}, body: '' })
      .then(({ ok, data }) => {
        if (ok) setResult(data as Result);
        else setError(data.error || 'Something went wrong.');
      })
      .catch(() => setError('Could not reach the inspection service.'))
      .finally(() => setLoading(false));
  }, []);

  async function runOne(target: string, m = method, h?: Record<string, string>, b = bodyText) {
    const { ok, data } = await fetchInspect(target, {
      method: m,
      headers: h ?? parseHeaderLines(headerText),
      body: b,
    });
    if (!ok) throw new Error(data.error || 'Something went wrong.');
    return data as Result;
  }

  function record(result: Result) {
    const entry: HistoryEntry = {
      url: result.url,
      method: result.method,
      time: Date.now(),
      status: result.status,
      statusText: result.statusText,
      ok: result.ok,
      contentType: result.contentType,
      server: result.server,
      sizeBytes: result.sizeBytes,
      redirectCount: result.redirectCount,
      pageTitle: result.pageTitle,
      responseTimeMs: result.responseTimeMs,
    };
    const prev = findPrevious(loadHistory(), entry.url, entry.method, entry.time);
    setHistory(saveHistory(entry));
    return prev;
  }

  async function inspectSingle(target: string, m: string, h: Record<string, string>, b: string) {
    const r = await runOne(target, m, h, b);
    setResult(r);
    const prev = record(r);
    setLastDiff(prev ? { at: prev.time, rows: diffResults(prev, r) } : null);
  }

  async function onInspect(e: React.FormEvent) {
    e.preventDefault();
    setTouched(true);
    setLoading(true);
    setError(null);
    setError2(null);
    setResult(null);
    setResult2(null);
    setLastDiff(null);
    try {
      if (mode === 'compare') {
        const h = parseHeaderLines(headerText);
        const [ra, rb] = await Promise.allSettled([
          runOne(url, method, h, bodyText),
          runOne(url2, method, h, bodyText),
        ]);
        if (ra.status === 'fulfilled') {
          setResult(ra.value);
          record(ra.value);
        } else setError(ra.reason instanceof Error ? ra.reason.message : 'Request failed.');
        if (rb.status === 'fulfilled') {
          setResult2(rb.value);
          record(rb.value);
        } else setError2(rb.reason instanceof Error ? rb.reason.message : 'Request failed.');
        setHistory(loadHistory());
      } else {
        await inspectSingle(url, method, parseHeaderLines(headerText), bodyText);
      }
    } catch (err) {
      if (err instanceof TypeError || err instanceof SyntaxError) {
        setError('Could not reach the inspection service.');
      } else {
        setError(err instanceof Error ? err.message : 'The server could not reach this address.');
      }
    } finally {
      setLoading(false);
    }
  }

  async function reinspect(entry: HistoryEntry) {
    setMode('single');
    setUrl(entry.url);
    setMethod(entry.method);
    setTouched(true);
    setLoading(true);
    setError(null);
    setResult(null);
    setLastDiff(null);
    try {
      await inspectSingle(entry.url, entry.method, {}, '');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'The server could not reach this address.');
    } finally {
      setLoading(false);
    }
  }

  const diffs = result && result2 ? diffResults(result, result2) : [];

  return (
    <main className="wrap">
      <div className="top">
        <h1>HTTP Inspector</h1>
        <button type="button" onClick={() => setDark(!dark)} aria-label="Toggle dark mode">
          {dark ? 'Light' : 'Dark'}
        </button>
      </div>
      <p className="sub">Enter a URL to inspect it.</p>
      <div className="mode" role="tablist" aria-label="Mode">
        <button
          type="button"
          role="tab"
          aria-selected={mode === 'single'}
          className={mode === 'single' ? 'active' : ''}
          onClick={() => setMode('single')}
        >
          Single
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={mode === 'compare'}
          className={mode === 'compare' ? 'active' : ''}
          onClick={() => setMode('compare')}
        >
          Compare
        </button>
      </div>
      <form className={mode === 'compare' ? 'col' : 'row'} onSubmit={onInspect}>
        <input
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="https://example.com"
          inputMode="url"
          aria-label="URL to inspect"
        />
        {mode === 'compare' && (
          <input
            value={url2}
            onChange={(e) => setUrl2(e.target.value)}
            placeholder="https://example.org"
            inputMode="url"
            aria-label="Second URL to compare"
          />
        )}
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
      {history.length > 0 && (
        <details className="opts">
          <summary>History ({history.length})</summary>
          <ul className="checks">
            {history.map((h) => (
              <li key={`${h.time}-${h.url}`}>
                <span className={h.ok ? 'good' : 'missing'}>
                  {h.status} {h.statusText}
                </span>{' '}
                <code>{h.method}</code> <code>{h.url}</code>
                <br />
                <span className="hint">{new Date(h.time).toLocaleString()}</span>{' '}
                <button type="button" onClick={() => void reinspect(h)}>
                  Re-inspect
                </button>
              </li>
            ))}
          </ul>
          <button
            type="button"
            onClick={() => {
              clearHistory();
              setHistory([]);
            }}
          >
            Clear history
          </button>
        </details>
      )}

      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {loading && <p className="hint">Inspecting…</p>}
      {!touched && !result && !error && !loading && (
        <p className="hint">Enter a URL above and hit Inspect to see status, timing, and headers.</p>
      )}

      {mode === 'compare' && error2 && (
        <p className="error" role="alert">
          Second URL: {error2}
        </p>
      )}

      {lastDiff && lastDiff.rows.length > 0 && (
        <section className="card">
          <h2 className="card-title">Since {new Date(lastDiff.at).toLocaleString()}</h2>
          <ul className="checks">
            {lastDiff.rows.map((d) => (
              <li key={d.label}>
                <strong>{d.label}:</strong> <code>{d.a}</code> vs <code>{d.b}</code>
              </li>
            ))}
          </ul>
        </section>
      )}
      {lastDiff && lastDiff.rows.length === 0 && (
        <p className="hint">
          No changes since {new Date(lastDiff.at).toLocaleString()}.
        </p>
      )}

      {diffs.length > 0 && result && result2 && (
        <section className="card">
          <h2 className="card-title">Differences ({diffs.length})</h2>
          <ul className="checks">
            {diffs.map((d) => (
              <li key={d.label}>
                <strong>{d.label}:</strong> <code>{d.a}</code> vs <code>{d.b}</code>
              </li>
            ))}
          </ul>
        </section>
      )}
      {mode === 'compare' && result && result2 && diffs.length === 0 && (
        <p className="hint">Both URLs return the same status, type, server, size, redirects, and title.</p>
      )}

      {mode === 'single' && result && (
        <>
          <ResultCard result={result} />
          <ExportButtons
            result={result}
            method={method}
            headers={parseHeaderLines(headerText)}
            body={bodyText}
          />
        </>
      )}
      {mode === 'compare' && result && result2 && (
        <div className="compare">
          <div>
            <ResultCard result={result} title="A" />
            <ExportButtons
              result={result}
              method={method}
              headers={parseHeaderLines(headerText)}
              body={bodyText}
            />
          </div>
          <div>
            <ResultCard result={result2} title="B" />
            <ExportButtons
              result={result2}
              method={method}
              headers={parseHeaderLines(headerText)}
              body={bodyText}
            />
          </div>
        </div>
      )}
      {mode === 'compare' && result && !result2 && !loading && <ResultCard result={result} title="A" />}
    </main>
  );
}
