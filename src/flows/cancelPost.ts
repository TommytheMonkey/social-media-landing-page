// FLOW 5 — Cancel. Triggered by Post Trigger == "CANCEL!".
//  - Status "Scheduled!"  -> delete the post from Buffer's queue, Status -> "Cancelled".
//  - Status "Live!"       -> can't unpublish via Buffer; Status -> "Error - Check
//                            Updates" + a note to delete it manually on the platform.
//  - Status ideation / Raw Draft / Error / Past Due -> nothing to cancel (no-op).

import type { MondayItem } from '../types';
import * as monday from '../clients/monday';
import { deletePost } from '../clients/buffer';
import { COLUMNS, STATUS, POST_TRIGGER } from '../config/board';
import { cv } from '../domain/columnValues';
import { parseItem, READ_COLUMN_IDS } from '../domain/item';
import { reportError } from '../domain/errors';
import { findBufferPostId, currentStatus } from '../lib/idempotency';
import { log } from '../lib/logger';

/** Poll for "CANCEL!" items and process each. */
export async function pollAndCancel(): Promise<number> {
  let raws;
  try {
    raws = await monday.findItemsByStatus(
      [{ columnId: COLUMNS.postTrigger, label: POST_TRIGGER.cancel }],
      READ_COLUMN_IDS,
    );
  } catch (err) {
    // The "CANCEL!" label may not exist on the board yet — don't break the whole poll.
    log.warn('Cancel poll skipped (CANCEL! label not found?)', {
      err: err instanceof Error ? err.message : String(err),
    });
    return 0;
  }

  let count = 0;
  for (const raw of raws) {
    const item = parseItem(raw);
    try {
      if (await cancelItem(item)) count++;
    } catch (err) {
      await reportError(item.id, 'Flow 5 (cancel) failed', err);
    }
  }
  return count;
}

export async function cancelItem(item: MondayItem): Promise<boolean> {
  const status = item.status;

  // Nothing was scheduled/published in these states — do nothing.
  if (
    status === STATUS.ideation ||
    status === STATUS.rawDraft ||
    status === STATUS.error ||
    status === STATUS.pastDue ||
    status === STATUS.cancelled
  ) {
    log.info('Cancel: nothing to cancel', { itemId: item.id, status });
    return false;
  }

  // Already published — Buffer can't unpublish it; flag for manual deletion.
  if (status === STATUS.live) {
    await monday.updateColumns(item.id, { [COLUMNS.status]: cv.status(STATUS.error) });
    await monday.createUpdate(
      item.id,
      `⚠️ This post is already LIVE — it can't be unpublished automatically. ` +
        `Please manually delete it from ${item.platform ?? 'the platform'} ` +
        `(${item.voice ?? 'the'} account), then update this item.`,
    );
    log.info('Cancel: live post flagged for manual delete', { itemId: item.id });
    return false;
  }

  // Scheduled — remove it from Buffer's queue before it publishes.
  if (status === STATUS.scheduled) {
    const postId = await findBufferPostId(item.id);
    if (!postId) {
      await reportError(
        item.id,
        'Cancel failed',
        new Error('No Buffer post id found on this item — check/cancel it in Buffer manually.'),
      );
      return false;
    }

    // Compare-and-act: skip if a concurrent run already moved it off Scheduled!.
    if ((await currentStatus(item.id)) !== STATUS.scheduled) {
      log.info('Cancel skip — item no longer Scheduled!', { itemId: item.id });
      return false;
    }

    await deletePost(postId);
    await monday.updateColumns(item.id, {
      [COLUMNS.status]: cv.status(STATUS.cancelled),
      [COLUMNS.postTrigger]: cv.status(''), // clear so it doesn't re-match CANCEL!
    });
    await monday.createUpdate(
      item.id,
      `✅ Canceled the scheduled Buffer post (id ${postId}) — removed from the queue before it published.`,
    );
    log.info('Cancel: scheduled post canceled', { itemId: item.id, postId });
    return true;
  }

  log.info('Cancel: unhandled status, no-op', { itemId: item.id, status });
  return false;
}
