// Simple health check: visit /api/health to verify API routes are deployed.
export default async function handler(req: any, res: any) {
  return res.status(200).json({ ok: true });
}
