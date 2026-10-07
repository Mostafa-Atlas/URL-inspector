import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [
    react(),
    {
      name: 'inspect-api-dev',
      configureServer(server) {
        server.middlewares.use('/api/inspect', async (req, res) => {
          const u = new URL(req.url || '/', 'http://dev');
          let target = u.searchParams.get('url') || '';
          let options: { method?: string; headers?: Record<string, string>; body?: string } = {};
          if (req.method === 'POST') {
            const chunks: Buffer[] = [];
            for await (const c of req) {
              chunks.push(c as Buffer);
              if (Buffer.concat(chunks).length > 300_000) break;
            }
            try {
              const parsed = JSON.parse(Buffer.concat(chunks).toString('utf-8') || '{}');
              target = parsed.url || '';
              options = { method: parsed.method, headers: parsed.headers, body: parsed.body };
            } catch {
              target = '';
            }
          }
          try {
            const { inspectUrl } = await import('./lib/inspect.js');
            const result = await inspectUrl(target, options);
            res.setHeader('content-type', 'application/json');
            res.end(JSON.stringify(result));
          } catch (e: unknown) {
            const status =
              e && typeof e === 'object' && 'status' in e
                ? Number((e as { status: number }).status) || 502
                : 502;
            const msg =
              e && typeof e === 'object' && 'publicMessage' in e
                ? String((e as { publicMessage: string }).publicMessage)
                : 'The server could not reach this address.';
            res.statusCode = status;
            res.setHeader('content-type', 'application/json');
            res.end(JSON.stringify({ error: msg }));
          }
        });
      },
    },
  ],
});
