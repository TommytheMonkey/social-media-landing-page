// FLOW 4 — Nightly sweep (runs ~05:07 UTC, off the 5-min poll grid). Idempotent
// reconciliation only. The 5-min poll owns the send/cancel flows; the sweep does
// NOT re-invoke them (that previously collided with the poll), it only:
//  1. Past Due: Post Date < today and never cleared -> Status "Past Due!".
//  2. Reconcile: "Scheduled!" items whose Post Date has passed -> "Live!".
//  3. Junk: Post Trigger == "Junk" -> (cancel any queued post, then) move to Garbage.

import * as monday from '../clients/monday';
import { deletePost } from '../clients/buffer';
import { COLUMNS, STATUS, POST_TRIGGER, GARBAGE_GROUP_TITLE } from '../config/board';
import { cv } from '../domain/columnValues';
import { parseItem, READ_COLUMN_IDS } from '../domain/item';
import { reportError } from '../domain/errors';
import { findBufferPostId } from '../lib/idempotency';
import { isBeforeTodayEastern } from '../lib/timezone';
import { log } from '../lib/logger';

export interface NightlySummary {
  pastDue: number;
  reconciled: number;
  junked: number;
}

export async function runNightly(): Promise<NightlySummary> {
  const summary: NightlySummary = { pastDue: 0, reconciled: 0, junked: 0 };

  // 1. Past Due — candidates are not-yet-scheduled items (ideation / Raw Draft).
  const candidates = [
    ...(await monday.findItemsByStatus([{ columnId: COLUMNS.status, label: STATUS.ideation }], READ_COLUMN_IDS)),
    ...(await monday.findItemsByStatus([{ columnId: COLUMNS.status, label: STATUS.rawDraft }], READ_COLUMN_IDS)),
  ];
  for (const raw of candidates) {
    const item = parseItem(raw);
    const neverCleared =
      item.postTrigger !== POST_TRIGGER.clear && item.postTrigger !== POST_TRIGGER.postNow;
    if (item.postDate && isBeforeTodayEastern(item.postDate) && neverCleared) {
      try {
        await monday.updateColumns(item.id, { [COLUMNS.status]: cv.status(STATUS.pastDue) });
        summary.pastDue++;
      } catch (err) {
        await reportError(item.id, 'Flow 4 past-due update failed', err);
      }
    }
  }

  // 2. Reconcile scheduled posts whose date has passed.
  // NOTE: Buffer has no verified "get post status" query yet, so we mark Live!
  // optimistically (Buffer accepted the scheduled post). Wire a real confirmation
  // here once the Buffer read query is verified.
  const scheduled = await monday.findItemsByStatus(
    [{ columnId: COLUMNS.status, label: STATUS.scheduled }],
    READ_COLUMN_IDS,
  );
  for (const raw of scheduled) {
    const item = parseItem(raw);
    if (item.postDate && isBeforeTodayEastern(item.postDate)) {
      try {
        await monday.updateColumns(item.id, { [COLUMNS.status]: cv.status(STATUS.live) });
        await monday.createUpdate(
          item.id,
          'ℹ️ Marked Live! by nightly reconcile (Post Date passed; Buffer confirmation not yet wired).',
        );
        summary.reconciled++;
      } catch (err) {
        await reportError(item.id, 'Flow 4 reconcile failed', err);
      }
    }
  }

  // 3. Junk -> Garbage group. If the item is still Scheduled! in Buffer, cancel that
  // first so we don't leave an orphaned live post; then clear the trigger so it
  // stops re-matching every night.
  const junk = await monday.findItemsByStatus(
    [{ columnId: COLUMNS.postTrigger, label: POST_TRIGGER.junk }],
    READ_COLUMN_IDS,
  );
  if (junk.length > 0) {
    const groupId = await monday.getGroupIdByTitle(GARBAGE_GROUP_TITLE);
    if (!groupId) {
      log.warn('Garbage group not found — skipping junk move', { title: GARBAGE_GROUP_TITLE });
    } else {
      for (const raw of junk) {
        const item = parseItem(raw);
        try {
          if (item.status === STATUS.scheduled) {
            const postId = await findBufferPostId(item.id);
            if (postId) {
              const res = await deletePost(postId);
              log.info('Flow 4 junk: removed queued Buffer post', { itemId: item.id, postId, deleted: res.deleted });
            }
          }
          await monday.moveItemToGroup(item.id, groupId);
          await monday.updateColumns(item.id, { [COLUMNS.postTrigger]: cv.status('') });
          summary.junked++;
        } catch (err) {
          await reportError(item.id, 'Flow 4 junk move failed', err);
        }
      }
    }
  }

  log.info('Flow 4 nightly sweep complete', { ...summary });
  return summary;
}
