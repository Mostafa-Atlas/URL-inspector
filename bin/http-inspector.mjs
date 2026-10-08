#!/usr/bin/env node
import { parseArgs } from 'node:util';
import { pathToFileURL } from 'node:url';
import { inspectUrl, InspectError } from '../lib/inspect.ts';

const HELP = `Usage: http-inspector <url> [options]

Options:
  --method <name>   GET, HEAD, POST, PUT, PATCH, DELETE, OPTIONS (default GET)
  --header "N: V"   custom header, repeatable, max 10
  --body <text>     request body (needs POST, PUT, PATCH, or DELETE)
  --json            print raw JSON
  --allow-private   allow localhost and private addresses
  -h, --help        show this text`;

function parseHeaders(lines) {
  const out = {};
  for (const line of lines) {
    const i = line.indexOf(':');
    if (i < 1) continue;
    out[line.slice(0, i).trim()] = line.slice(i + 1).trim();
  }
  return out;
}

function printPretty(r) {
  console.log(`${r.status} ${r.statusText} · ${r.method} ${r.finalUrl}`);
  console.log(
    `Time ${r.responseTimeMs} ms (dns ${r.timing.dnsMs}, headers ${r.timing.ttfbMs}, body ${r.timing.bodyMs})`
  );
  console.log(
    `Size ${r.sizeBytes} B · Type ${r.contentType || '—'} · Server ${r.server || '—'} · Redirects ${r.redirectCount}`
  );
  if (r.pageTitle) console.log(`Title ${r.pageTitle}`);
  const missing = r.security.filter((h) => !h.present).map((h) => h.name);
  if (missing.length > 0) console.log(`Missing security headers: ${missing.join(', ')}`);
  if (r.cookies.length > 0) console.log(`Cookies: ${r.cookies.map((c) => c.split(';')[0].trim()).join(', ')}`);
  if (r.cert) console.log(`Cert ${r.cert.subject}, expires ${r.cert.validTo} (${r.cert.daysLeft} days left)`);
  if (r.previewText) {
    console.log('--- body ---');
    console.log(r.previewText + (r.previewTruncated ? '\n…truncated' : ''));
  }
}

export async function main(argv = process.argv.slice(2)) {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      method: { type: 'string', default: 'GET' },
      header: { type: 'string', multiple: true, default: [] },
      body: { type: 'string', default: '' },
      json: { type: 'boolean', default: false },
      'allow-private': { type: 'boolean', default: false },
      help: { type: 'boolean', short: 'h', default: false },
    },
  });

  if (values.help) {
    console.log(HELP);
    return 0;
  }
  const target = positionals[0];
  if (!target) {
    console.error(HELP);
    return 2;
  }
  if (values['allow-private']) process.env.ALLOW_PRIVATE = '1';

  try {
    const result = await inspectUrl(target, {
      method: values.method,
      headers: parseHeaders(values.header),
      body: values.body || undefined,
    });
    if (values.json) console.log(JSON.stringify(result, null, 2));
    else printPretty(result);
    return 0;
  } catch (e) {
    console.error(e instanceof InspectError ? e.publicMessage : 'The server could not reach this address.');
    return 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().then((code) => process.exit(code));
}
