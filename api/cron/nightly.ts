// Cron/nightly entry — runs Flow 4 (safety sweep). Scheduled at 05:00 UTC =
// 00:00 ET in winter (EST) / 01:00 ET in summer (EDT). Vercel crons are UTC-only,
// so it can't be pinned to ET midnight year-round, but 05:00 UTC always lands on
// the same ET calendar day just after midnight — which is all the sweep needs.

import type { VercelRequest, VercelResponse } from '@vercel/node';
import { isAuthorized } from '../../src/lib/httpAuth';
import { runNightly } from '../../src/flows/nightlySweep';
import { log } from '../../src/lib/logger';

export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  if (!isAuthorized(req)) {
    res.status(401).json({ ok: false, error: 'unauthorized' });
    return;
  }
  try {
    const summary = await runNightly();
    res.status(200).json({ ok: true, ...summary });
  } catch (err) {
    log.error('nightly endpoint failed', { error: err instanceof Error ? err.message : String(err) });
    res.status(500).json({ ok: false, error: err instanceof Error ? err.message : String(err) });
  }
}
