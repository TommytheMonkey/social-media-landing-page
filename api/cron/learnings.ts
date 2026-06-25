// Cron/learnings entry — runs Flow 7 (weekly learnings digest). Scheduled 04:30 UTC
// on Mondays = Sunday 23:30 EST / Monday 00:30 EDT — i.e. late Sunday ET, after the
// week's posts have had time to accrue metrics (Flow 6 refreshes for 7 days). Vercel
// crons are UTC-only, so this is the fixed-UTC stand-in for "Sunday night ET".

import type { VercelRequest, VercelResponse } from '@vercel/node';
import { isAuthorized } from '../../src/lib/httpAuth';
import { runLearningsDigest } from '../../src/flows/learningsDigest';
import { log } from '../../src/lib/logger';

export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  if (!isAuthorized(req)) {
    res.status(401).json({ ok: false, error: 'unauthorized' });
    return;
  }
  try {
    const summary = await runLearningsDigest();
    res.status(200).json({ ok: true, ...summary });
  } catch (err) {
    log.error('learnings endpoint failed', { error: err instanceof Error ? err.message : String(err) });
    res.status(500).json({ ok: false, error: err instanceof Error ? err.message : String(err) });
  }
}
