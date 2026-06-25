// FLOW 2 — Schedule-ahead to Buffer. Triggered by Post Trigger == "Clear!"
// AND Status == "Raw Draft". Posts go to Buffer's queue immediately on clearing
// (not gated on Post Date); Buffer publishes them at the scheduled time.

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
import { scheduledUtcISO } from '../lib/timezone';
import { prepareImageUrl, resolvePostTextFromDoc, wordCount } from './sendShared';
import { log } from '../lib/logger';

/** Poll for cleared raw drafts and schedule each to Buffer. */
export async function pollAndSchedule(): Promise<number> {
  const raws = await monday.findItemsByStatus(
    [
      { columnId: COLUMNS.postTrigger, label: POST_TRIGGER.clear },
      { columnId: COLUMNS.status, label: STATUS.rawDraft },
    ],
    READ_COLUMN_IDS,
  );
  let scheduled = 0;
  for (const raw of raws) {
    const item = parseItem(raw);
    try {
      if (await scheduleItem(item)) scheduled++;
    } catch (err) {
      await reportError(item.id, 'Flow 2 (schedule to Buffer) failed', err);
    }
  }
  return scheduled;
}

/** Validate + schedule a single item. Returns true if it was sent. */
export async function scheduleItem(item: MondayItem): Promise<boolean> {
  const check = validateForSend(item, true);
  if (!check.ok) {
    await reportValidationFailure(item.id, check.missing);
    return false;
  }
  // Narrowed by validation, but help the compiler:
  const { voice, platform, postDate } = item;
  if (!voice || !platform || !postDate) {
    await reportValidationFailure(item.id, check.missing);
    return false;
  }

  const channelId = resolveChannelId(voice, platform);
  if (!channelId) {
    await reportError(
      item.id,
      'Flow 2 aborted',
      new Error(`No Buffer channel mapped for voice "${voice}" on ${platform}`),
    );
    return false;
  }

  // Snapshot the (possibly edited) Google Doc text into long-text + word-count,
  // and use it as the post body. Throws (-> reportError) if the Doc is missing/empty.
  const text = await resolvePostTextFromDoc(item);
  await monday.updateColumns(item.id, {
    [COLUMNS.contentText]: cv.longText(text),
    [COLUMNS.postWordCount]: cv.number(wordCount(text)),
  });

  const imageUrl = await prepareImageUrl(item);
  const dueAtUtc = scheduledUtcISO(postDate);

  // Compare-and-act, then CLAIM: bail if no longer Raw Draft, then flip to
  // Scheduled! BEFORE the non-idempotent send. A re-run now sees Scheduled! (not
  // Raw Draft) and skips, even if the audit write later fails — no double-schedule.
  if ((await currentStatus(item.id)) !== STATUS.rawDraft) {
    log.info('Flow 2 skip — item no longer Raw Draft', { itemId: item.id });
    return false;
  }
  await monday.updateColumns(item.id, { [COLUMNS.status]: cv.status(STATUS.scheduled) });

  let postId: string;
  try {
    postId = await createPost({ channelId, text, platform, imageUrl, dueAtUtc });
  } catch (err) {
    // Roll the claim back so a send failure is visible, not stuck as Scheduled!.
    await monday.updateColumns(item.id, { [COLUMNS.status]: cv.status(STATUS.error) }).catch(() => undefined);
    throw err;
  }

  try {
    await recordBufferPostId(item.id, channelId, postId, postDate);
  } catch (auditErr) {
    log.warn('Flow 2 audit update failed (post was scheduled)', {
      itemId: item.id,
      auditErr: auditErr instanceof Error ? auditErr.message : String(auditErr),
    });
  }
  log.info('Flow 2 scheduled post', { itemId: item.id, platform, dueAtUtc, postId });
  return true;
}
