// FLOW 3 — Post Now. Triggered by Post Trigger == "Post Now!". Same validation
// as Flow 2 but published immediately (Buffer mode shareNow, no scheduled time).
// On confirmed success -> Status = "Live!".

import type { MondayItem } from '../types';
import * as monday from '../clients/monday';
import { createPost } from '../clients/buffer';
import { COLUMNS, STATUS, POST_TRIGGER } from '../config/board';
import { resolveChannelId } from '../config/channels';
import { cv } from '../domain/columnValues';
import { parseItem, READ_COLUMN_IDS } from '../domain/item';
import { validateForSend } from '../domain/validation';
import { reportError, reportValidationFailure } from '../domain/errors';
import { recordBufferPostId, currentStatus } from '../lib/idempotency';
import { prepareImageUrl } from './sendShared';
import { log } from '../lib/logger';

/** Poll for "Post Now!" items and publish each immediately. */
export async function pollAndPostNow(): Promise<number> {
  const raws = await monday.findItemsByStatus(
    [{ columnId: COLUMNS.postTrigger, label: POST_TRIGGER.postNow }],
    READ_COLUMN_IDS,
  );
  let posted = 0;
  for (const raw of raws) {
    const item = parseItem(raw);
    // Idempotency: the trigger stays "Post Now!", so skip anything already sent
    // (Live!) OR already errored. A Post-Now item in Error must be re-armed
    // manually rather than auto-resent — this is what prevents a status-write
    // failure after a successful Buffer send from causing a duplicate publish.
    if (item.status === STATUS.live || item.status === STATUS.error) continue;
    try {
      if (await postNowItem(item)) posted++;
    } catch (err) {
      await reportError(item.id, 'Flow 3 (post now) failed', err);
    }
  }
  return posted;
}

/** Validate + immediately publish a single item. Returns true if it was sent. */
export async function postNowItem(item: MondayItem): Promise<boolean> {
  const check = validateForSend(item, false);
  if (!check.ok) {
    await reportValidationFailure(item.id, check.missing);
    return false;
  }
  const { voice, platform, contentText } = item;
  if (!voice || !platform || !contentText) {
    await reportValidationFailure(item.id, check.missing);
    return false;
  }

  const channelId = resolveChannelId(voice, platform);
  if (!channelId) {
    await reportError(
      item.id,
      'Flow 3 aborted',
      new Error(`No Buffer channel mapped for voice "${voice}" on ${platform}`),
    );
    return false;
  }

  const imageUrl = await prepareImageUrl(item);

  // Compare-and-act: bail if a concurrent run already sent or errored this item.
  const fresh = await currentStatus(item.id);
  if (fresh === STATUS.live || fresh === STATUS.error) {
    log.info('Flow 3 skip — item already sent/errored', { itemId: item.id, status: fresh });
    return false;
  }

  const postId = await createPost({ channelId, text: contentText, platform, imageUrl });

  // Mark Live! AND clear the trigger in one write so the item can never re-match
  // the "Post Now!" poll. If this write fails, reportError sets Status=Error,
  // which the poll guard now excludes — so no duplicate publish. Audit is best-effort.
  await monday.updateColumns(item.id, {
    [COLUMNS.status]: cv.status(STATUS.live),
    [COLUMNS.postTrigger]: cv.status(''),
  });
  try {
    await recordBufferPostId(item.id, channelId, postId, null);
  } catch (auditErr) {
    log.warn('Flow 3 audit update failed (post was published)', {
      itemId: item.id,
      auditErr: auditErr instanceof Error ? auditErr.message : String(auditErr),
    });
  }
  log.info('Flow 3 posted now', { itemId: item.id, platform, postId });
  return true;
}
