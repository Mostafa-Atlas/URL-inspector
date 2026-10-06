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
          const target = u.searchParams.get('url') || '';
          try {
            const { inspectUrl, InspectError } = await import('./lib/inspect.js');
            const result = await inspectUrl(target);
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
