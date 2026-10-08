import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { inspectUrl, InspectError } from '../demo/lib/inspect.ts';

const TYPES = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};

const distDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'demo', 'dist');

async function readJson(req, limit = 300_000) {
  const chunks = [];
  let size = 0;
  for await (const c of req) {
    chunks.push(c);
    size += c.length;
    if (size > limit) throw new InspectError(413, 'Request body too large.');
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf-8') || '{}');
}

function send(res, code, obj) {
  res.writeHead(code, { 'content-type': 'application/json' });
  res.end(JSON.stringify(obj));
}

async function handleInspect(req, res) {
  let target = '';
  let options = {};
  if (req.method === 'POST') {
    try {
      const body = await readJson(req);
      target = body.url || '';
      options = { method: body.method, headers: body.headers, body: body.body };
    } catch {
      return send(res, 400, { error: 'Invalid URL' });
    }
  } else {
    target = new URL(req.url || '/', 'http://x').searchParams.get('url') || '';
  }
  if (!target) return send(res, 400, { error: 'Invalid URL' });
  try {
    send(res, 200, await inspectUrl(target, options));
  } catch (e) {
    console.error('inspect failed:', e instanceof Error ? e.message : String(e));
    if (e instanceof InspectError) return send(res, e.status, { error: e.publicMessage });
    send(res, 502, { error: 'The server could not reach this address.' });
  }
}

async function handleStatic(req, res) {
  const pathname = new URL(req.url || '/', 'http://x').pathname;
  const file = pathname === '/' ? 'index.html' : pathname.slice(1);
  const full = path.normalize(path.join(distDir, file));
  if (!full.startsWith(distDir)) {
    res.writeHead(403);
    res.end();
    return;
  }
  try {
    const data = await fs.readFile(full);
    res.writeHead(200, { 'content-type': TYPES[path.extname(full)] || 'application/octet-stream' });
    res.end(data);
  } catch {
    try {
      const index = await fs.readFile(path.join(distDir, 'index.html'));
      res.writeHead(200, { 'content-type': 'text/html' });
      res.end(index);
    } catch {
      res.writeHead(404);
      res.end('Not found. Run npm --prefix demo run build first.');
    }
  }
}

export function startServer(port = 3000) {
  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      if (req.url?.startsWith('/api/inspect')) void handleInspect(req, res);
      else if (req.url === '/api/health') send(res, 200, { ok: true });
      else void handleStatic(req, res);
    });
    server.on('error', reject);
    server.listen(port, '127.0.0.1', () => {
      console.log(`Dashboard at http://localhost:${port}/`);
      resolve(server);
    });
  });
}
