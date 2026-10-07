import { InspectError, inspectUrl } from '../lib/inspect';

// Vercel Node function (no extra deps). Keep handler untyped to avoid @vercel/node.
export default async function handler(req: any, res: any) {
  const isPost = req?.method === 'POST';
  let body: unknown = req?.body;
  if (isPost && typeof body === 'string') {
    try {
      body = JSON.parse(body);
    } catch {
      return res.status(400).json({ error: 'Invalid URL' });
    }
  }
  const params = (isPost && typeof body === 'object' && body !== null ? body : req?.query) as Record<
    string,
    unknown
  >;
  const url = params?.url ?? new URL(req?.url || '/', 'http://x').searchParams.get('url');
  if (!url || typeof url !== 'string') {
    return res.status(400).json({ error: 'Invalid URL' });
  }
  const options = {
    method: typeof params?.method === 'string' ? params.method : undefined,
    headers:
      typeof params?.headers === 'object' && params.headers !== null
        ? (params.headers as Record<string, string>)
        : undefined,
    body: typeof params?.body === 'string' ? params.body : undefined,
  };
  try {
    const result = await inspectUrl(url, options);
    return res.status(200).json(result);
  } catch (e: unknown) {
    if (e instanceof InspectError) {
      return res.status(e.status).json({ error: e.publicMessage });
    }
    return res.status(502).json({ error: 'The server could not reach this address.' });
  }
}
