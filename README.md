# HTTP Inspector

A small tool for checking what a URL returns. Paste a URL, hit Inspect, and it shows status, timing, size, redirects, and headers.

I built it as a personal demo I can actually maintain. No accounts, no database, just a form and one API route.

## Features

Shows status code, timing breakdown (DNS lookup, wait for headers, body download, total), redirect chain, content type, size, server header when present, page title and a 2 KB body preview for text pages, security headers, caching and compression headers, cookies, TLS certificate expiry for HTTPS sites, final URL after redirects, and the full response headers. Errors are plain sentences like "Invalid URL" or "The request timed out."

Compare mode inspects two URLs side by side and lists what differs. Request options allow other methods (POST, PUT, PATCH, DELETE, HEAD, OPTIONS), up to 10 custom headers, and a small body. Results can be downloaded as JSON, copied as cURL, or shared with a link.

## Run locally

```bash
npm install
npm run dev
```

Open http://localhost:5173 and try https://example.com.

Tests:

```bash
npm test
```

`ALLOW_PRIVATE=1` is only read by the local test run so the test servers on 127.0.0.1 can be fetched. Production blocks those addresses.

## CLI

The same inspector runs in the terminal. It needs Node 22 or newer.

```bash
./bin/http-inspector.mjs https://example.com
./bin/http-inspector.mjs https://example.com --json
./bin/http-inspector.mjs https://api.example.com/items --method POST --header "Content-Type: application/json" --body '{"a": 1}'
./bin/http-inspector.mjs http://localhost:3000/ --allow-private
```

`--dashboard` serves the web UI on your machine instead of printing to the terminal. Run `npm run build` once first, then:

```bash
./bin/http-inspector.mjs --dashboard
./bin/http-inspector.mjs --dashboard --port 8080
```

The dashboard keeps the same blocks as production. Only the direct CLI call accepts `--allow-private`, which is meant for testing your own services.

## Architecture

```text
Browser -> /api/inspect -> target site
```

The frontend is React plus Vite with plain CSS. The browser never fetches the target directly, which avoids CORS issues. `api/inspect.ts` runs as a Vercel function in production and through a small Vite middleware in dev. `bin/server.mjs` serves the same check locally for `--dashboard`. All three call `inspectUrl()` in `lib/inspect.ts`.

## Deployment

Push to Vercel and it works with no extra config. The build is `tsc --noEmit && vite build`. There are no environment variables and nothing secret in the repo.

## Security

Because anyone can pass in a URL, the endpoint has basic guards:

- only http and https, no credentials in the URL
- blocks localhost, private IPv4 ranges, link-local, and common internal hostnames
- resolves DNS on every hop and rechecks each redirect, max 5 redirects
- 10 second timeout, 2 MB response cap
- methods limited to GET, HEAD, POST, PUT, PATCH, DELETE, and OPTIONS
- custom headers limited to 10, with connection-level headers blocked
- request bodies capped at 100 KB and rejected on GET and HEAD
- generic error messages, no stack traces

Rate limiting is not included. On serverless that needs shared storage, which felt too heavy for this demo. If you put this online, add it at the edge or in front of the function.

This is reasonable protection for a demo, not a guarantee. DNS rebinding between the check and the fetch is still possible. Do not point this at anything sensitive or use it as a general proxy.

## Limitations

Response bodies are counted but not shown. Redirect chains stop at 5. Timeouts and size caps are fixed. IPv6 blocking covers common private ranges.
