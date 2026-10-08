import { useState } from 'react';
import type { Result } from './ResultCard';

function shQuote(s: string): string {
  return `'${s.replace(/'/g, `'\\''`)}'`;
}

export function buildCurl(
  url: string,
  method: string,
  headers: Record<string, string>,
  body: string
): string {
  const parts = [`curl -X ${method} ${shQuote(url)}`];
  for (const [k, v] of Object.entries(headers)) {
    parts.push(`-H ${shQuote(`${k}: ${v}`)}`);
  }
  if (body) parts.push(`--data ${shQuote(body)}`);
  return parts.join(' ');
}

export function buildShareLink(url: string, method: string): string {
  const q = new URLSearchParams({ url });
  if (method !== 'GET') q.set('method', method);
  return `${location.origin}${location.pathname}?${q.toString()}`;
}

async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const ta = document.createElement('textarea');
    ta.value = text;
    document.body.appendChild(ta);
    ta.select();
    try {
      document.execCommand('copy');
      return true;
    } catch {
      return false;
    } finally {
      ta.remove();
    }
  }
}

export function ExportButtons({
  result,
  method,
  headers,
  body,
}: {
  result: Result;
  method: string;
  headers: Record<string, string>;
  body: string;
}) {
  const [copied, setCopied] = useState<string | null>(null);

  async function onCopy(kind: 'curl' | 'link', text: string) {
    const ok = await copyText(text);
    setCopied(ok ? kind : 'failed');
    setTimeout(() => setCopied(null), 2000);
  }

  function onDownload() {
    const blob = new Blob([JSON.stringify(result, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'inspection.json';
    a.click();
    URL.revokeObjectURL(a.href);
  }

  return (
    <div className="exports">
      <button type="button" onClick={onDownload}>
        Download JSON
      </button>
      <button type="button" onClick={() => void onCopy('curl', buildCurl(result.url, method, headers, body))}>
        {copied === 'curl' ? 'Copied' : 'Copy cURL'}
      </button>
      <button type="button" onClick={() => void onCopy('link', buildShareLink(result.url, method))}>
        {copied === 'link' ? 'Copied' : 'Copy link'}
      </button>
      {copied === 'failed' && <span className="hint">Copy failed.</span>}
    </div>
  );
}
