// Cron/metrics entry — runs Flow 6 (post-metrics sync). Scheduled 11:08 UTC =
// 06:08 ET in winter (EST) / 07:08 ET in summer (EDT): always at/after 06:00 ET AND
// after Buffer's overnight metrics ingestion in both DST regimes. The :08 offset
// keeps it off the every-5-min poll grid so it doesn't pile onto a poll tick.
// Vercel crons are UTC-only, hence the fixed UTC hour rather than a literal ET time.

import type { VercelRequest, VercelResponse } from '@vercel/node';
import { isAuthorized } from '../../src/lib/httpAuth';
import { runMetricsSync } from '../../src/flows/syncMetrics';
import { log } from '../../src/lib/logger';

export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  if (!isAuthorized(req)) {
    res.status(401).json({ ok: false, error: 'unauthorized' });
    return;
  }
  try {
    const summary = await runMetricsSync();
    res.status(200).json({ ok: true, ...summary });
  } catch (err) {
    log.error('metrics endpoint failed', { error: err instanceof Error ? err.message : String(err) });
    res.status(500).json({ ok: false, error: err instanceof Error ? err.message : String(err) });
  }
}
