import { InspectError, inspectUrl } from '../lib/inspect';

// Vercel Node function (no extra deps). Keep handler untyped to avoid @vercel/node.
export default async function handler(req: any, res: any) {
  const url = req?.query?.url ?? new URL(req?.url || '/', 'http://x').searchParams.get('url');
  if (!url || typeof url !== 'string') {
    return res.status(400).json({ error: 'Invalid URL' });
  }
  try {
    const result = await inspectUrl(url);
    return res.status(200).json(result);
  } catch (e: unknown) {
    if (e instanceof InspectError) {
      return res.status(e.status).json({ error: e.publicMessage });
    }
    return res.status(502).json({ error: 'The server could not reach this address.' });
  }
}
