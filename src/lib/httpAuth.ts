// Shared auth guard for the cron/poll endpoints. Vercel Cron automatically sends
// `Authorization: Bearer $CRON_SECRET` when CRON_SECRET is set; external pingers
// can use the same Bearer header or a ?secret= query param.

import type { VercelRequest } from '@vercel/node';

export function isAuthorized(req: VercelRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false; // fail closed if unconfigured

  const auth = req.headers['authorization'];
  if (auth === `Bearer ${secret}`) return true;

  const q = req.query?.['secret'];
  if (typeof q === 'string' && q === secret) return true;

  return false;
}
