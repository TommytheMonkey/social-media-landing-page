// Cron/newsletter entry — runs the weekly newsletter assembly. Scheduled Friday
// 05:12 UTC (= Fri 00:12 EST / 01:12 EDT, just after ET midnight; off the poll +
// nightly grids). Assembly only — no email send.

import type { VercelRequest, VercelResponse } from '@vercel/node';
import { isAuthorized } from '../../src/lib/httpAuth';
import { runNewsletter } from '../../src/flows/newsletter';
import { log } from '../../src/lib/logger';

export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  if (!isAuthorized(req)) {
    res.status(401).json({ ok: false, error: 'unauthorized' });
    return;
  }
  try {
    const result = await runNewsletter();
    res.status(200).json({ ok: true, ...result });
  } catch (err) {
    log.error('newsletter endpoint failed', { error: err instanceof Error ? err.message : String(err) });
    res.status(500).json({ ok: false, error: err instanceof Error ? err.message : String(err) });
  }
}
