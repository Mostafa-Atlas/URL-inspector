import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { inspectUrl, parseTarget, isPrivateIP, MAX_BYTES } from '../lib/inspect.ts';

process.env.ALLOW_PRIVATE = '1';

function listen(handler) {
  const s = http.createServer(handler);
  return new Promise((resolve) => s.listen(0, '127.0.0.1', () => resolve(s)));
}
const addr = (s) => `http://127.0.0.1:${s.address().port}`;

let ok, redir, big, slow;
before(async () => {
  ok = await listen((req, res) => {
    res.setHeader('content-type', 'text/plain');
    res.setHeader('server', 'test');
    res.end('hello');
  });
  redir = await listen((req, res) => {
    if (req.url === '/final') {
      res.end('done');
      return;
    }
    res.writeHead(302, { location: '/final' });
    res.end();
  });
  big = await listen((req, res) => {
    res.setHeader('content-type', 'application/octet-stream');
    res.writeHead(200);
    res.end(Buffer.alloc(MAX_BYTES + 100, 'x'));
  });
  slow = await listen(() => {});
});
after(() => {
  for (const s of [ok, redir, big, slow]) s.close();
});

describe('validation', () => {
  it('accepts http url', () => {
    assert.equal(parseTarget('http://example.com').protocol, 'http:');
  });
  it('accepts https url', () => {
    assert.equal(parseTarget('https://example.com/x').protocol, 'https:');
  });
  it('rejects invalid url', () => {
    assert.throws(() => parseTarget('notaurl'), /Invalid URL/);
    assert.throws(() => parseTarget('ftp://x.com'), /Invalid URL/);
  });
  it('blocks internal destinations', async () => {
    delete process.env.ALLOW_PRIVATE;
    for (const u of ['http://localhost/', 'http://127.0.0.1/', 'http://10.0.0.1/', 'http://192.168.1.1/']) {
      await assert.rejects(() => inspectUrl(u), /not allowed/, u);
    }
    process.env.ALLOW_PRIVATE = '1';
  });
  it('detects private ips', () => {
    assert.equal(isPrivateIP('127.0.0.1'), true);
    assert.equal(isPrivateIP('10.1.2.3'), true);
    assert.equal(isPrivateIP('8.8.8.8'), false);
  });
});

describe('inspect', () => {
  it('returns fields for valid url', async () => {
    const r = await inspectUrl(`${addr(ok)}/`);
    assert.equal(r.status, 200);
    assert.equal(r.redirectCount, 0);
    assert.ok(r.responseTimeMs >= 0);
    assert.equal(r.contentType, 'text/plain');
    assert.ok(r.sizeBytes > 0);
    assert.equal(r.server, 'test');
    assert.ok(r.headers['content-type']);
    assert.ok(r.timing);
    assert.ok(r.timing.dnsMs >= 0);
    assert.ok(r.timing.ttfbMs >= 0);
    assert.ok(r.timing.bodyMs >= 0);
    assert.equal(r.timing.totalMs, r.responseTimeMs);
  });
  it('follows redirects', async () => {
    const r = await inspectUrl(`${addr(redir)}/`);
    assert.equal(r.redirectCount, 1);
    assert.ok(r.finalUrl.endsWith('/final'));
    assert.equal(r.status, 200);
  });
  it('rejects unreachable url', async () => {
    await assert.rejects(() => inspectUrl('http://127.0.0.1:1/'), /could not reach/);
  });
  it('rejects too-large response', async () => {
    await assert.rejects(() => inspectUrl(`${addr(big)}/`), /too large/);
  });
  it('times out on slow server', { timeout: 20000 }, async () => {
    await assert.rejects(() => inspectUrl(`${addr(slow)}/`), /timed out/);
  });
});
