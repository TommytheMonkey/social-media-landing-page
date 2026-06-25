// Cron/poll entry — runs Flows 1-3 in order. Scheduled every 5 min (see
// vercel.json). On Vercel Hobby, crons run at most daily; for true polling either
// upgrade to Pro or ping this endpoint from an external scheduler with the secret.

import type { VercelRequest, VercelResponse } from '@vercel/node';
import { isAuthorized } from '../../src/lib/httpAuth';
import { pollAndCreate } from '../../src/flows/createContent';
import { pollAndSchedule } from '../../src/flows/scheduleToBuffer';
import { pollAndPostNow } from '../../src/flows/postNow';
import { log } from '../../src/lib/logger';

export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  if (!isAuthorized(req)) {
    res.status(401).json({ ok: false, error: 'unauthorized' });
    return;
  }
  try {
    const created = await pollAndCreate(); // Flow 1
    const scheduled = await pollAndSchedule(); // Flow 2
    const posted = await pollAndPostNow(); // Flow 3
    res.status(200).json({ ok: true, created, scheduled, posted });
  } catch (err) {
    log.error('poll endpoint failed', { error: err instanceof Error ? err.message : String(err) });
    res.status(500).json({ ok: false, error: err instanceof Error ? err.message : String(err) });
  }
}
