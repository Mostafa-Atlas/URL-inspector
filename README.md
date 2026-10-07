# HTTP Inspector

A small tool for checking what a URL returns. Paste a URL, hit Inspect, and it shows status, timing, size, redirects, and headers.

I built it as a personal demo I can actually maintain. No accounts, no database, just a form and one API route.

## Features

Shows status code, timing breakdown (DNS lookup, wait for headers, body download, total), content type, size, redirect count, server header when present, page title and a 2 KB body preview for text pages, final URL after redirects, and the full response headers. Errors are plain sentences like "Invalid URL" or "The request timed out."

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

## Architecture

```text
Browser -> /api/inspect -> target site
```

The frontend is React plus Vite with plain CSS. The browser never fetches the target directly, which avoids CORS issues. `api/inspect.ts` runs as a Vercel function in production and through a small Vite middleware in dev. Both call `inspectUrl()` in `lib/inspect.ts`.

## Deployment

Push to Vercel and it works with no extra config. The build is `tsc --noEmit && vite build`. There are no environment variables and nothing secret in the repo.

## Security

Because anyone can pass in a URL, the endpoint has basic guards:

- only http and https, no credentials in the URL
- blocks localhost, private IPv4 ranges, link-local, and common internal hostnames
- resolves DNS on every hop and rechecks each redirect, max 5 redirects
- 10 second timeout, 2 MB response cap
- only GET, no custom headers or methods
- generic error messages, no stack traces

Rate limiting is not included. On serverless that needs shared storage, which felt too heavy for this demo. If you put this online, add it at the edge or in front of the function.

This is reasonable protection for a demo, not a guarantee. DNS rebinding between the check and the fetch is still possible. Do not point this at anything sensitive or use it as a general proxy.

## Limitations

Response bodies are counted but not shown. Redirect chains stop at 5. Timeouts and size caps are fixed. IPv6 blocking covers common private ranges.
