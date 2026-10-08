# HTTP Inspector

A small tool for checking what a URL returns. It lives in the terminal by default: run it with a URL and it prints status, timing, size, redirects, and headers. A web dashboard comes along for when you want clicks instead of flags.

## Features

Shows status code, timing breakdown (DNS lookup, wait for headers, body download, total), redirect chain, content type, size, server header and resolved IP addresses when present, page title and a 2 KB body preview for text pages, security headers, caching and compression headers, cookies, TLS certificate expiry for HTTPS sites, final URL after redirects, and the full response headers. Errors are plain sentences like "Invalid URL" or "The request timed out."

Compare mode inspects two URLs side by side and lists what differs. Request options allow other methods (POST, PUT, PATCH, DELETE, HEAD, OPTIONS), up to 10 custom headers, and a small body. Results can be downloaded as JSON, copied as cURL, or shared with a link. The dashboard keeps the last 20 inspections in your own browser storage, with one click re-inspection and a note when something changed since your last visit. It has a dark mode toggle that follows your system setting until you pick one.

## Layout

The CLI is the project. The web dashboard lives in `demo/` on its own so it can deploy alone.

```text
bin/    the CLI and the local dashboard server
demo/   the web dashboard (Vercel points here)
demo/lib/  the shared inspection core both of them use
```

## Run locally

```bash
npm --prefix demo install
npm --prefix demo run dev
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

`--dashboard` serves the web UI on your machine instead of printing to the terminal. Build the demo once first (`npm --prefix demo run build`), then:

```bash
./bin/http-inspector.mjs --dashboard
./bin/http-inspector.mjs --dashboard --port 8080
```

The dashboard keeps the same blocks as production. Only the direct CLI call accepts `--allow-private`, which is meant for testing your own services.

## Architecture

```text
Browser -> /api/inspect -> target site
```

The frontend is React plus Vite with plain CSS. The browser never fetches the target directly, which avoids CORS issues. `demo/api/inspect.ts` runs as a Vercel function in production and through a small Vite middleware in dev. `bin/server.mjs` serves the same check locally for `--dashboard`. All three call `inspectUrl()` in `demo/lib/inspect.ts`.

## Deployment

The demo deploys on its own. In Vercel set the project's Root Directory to `demo/` and leave the rest default: the build is `tsc --noEmit && vite build` and `demo/api` becomes the functions. There are no environment variables and nothing secret in the repo.

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

Response bodies show a 2 KB preview. Redirect chains stop at 5. Timeouts and size caps are fixed. IPv6 blocking covers common private ranges.
