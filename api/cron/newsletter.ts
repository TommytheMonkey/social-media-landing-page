// Cron/newsletter entry — MANUAL on-demand trigger for the newsletter pipeline.
// Assembly now runs in the 5-min poll (see api/cron/poll.ts), so this endpoint is
// no longer on a schedule; it just lets you run the same two newsletter steps by
// hand (assembly, then the prep scan) — handy for testing.

import type { VercelRequest, VercelResponse } from '@vercel/node';
import { isAuthorized } from '../../src/lib/httpAuth';
import { pollAndCreateNewsletter } from '../../src/flows/newsletter';
import { pollNewsletterPrep } from '../../src/flows/newsletterFinalize';
import { log } from '../../src/lib/logger';

export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  if (!isAuthorized(req)) {
    res.status(401).json({ ok: false, error: 'unauthorized' });
    return;
  }
  try {
    const newsletter = await pollAndCreateNewsletter();
    const newsletterPrep = await pollNewsletterPrep();
    res.status(200).json({ ok: true, newsletter, newsletterPrep });
  } catch (err) {
    log.error('newsletter endpoint failed', { error: err instanceof Error ? err.message : String(err) });
    res.status(500).json({ ok: false, error: err instanceof Error ? err.message : String(err) });
  }
}
