// FLOW 4 — Nightly safety sweep (runs just after ET midnight). Idempotent reconciliation only:
//  1. Catch any "Clear!" + "Raw Draft" that the poll missed -> schedule them.
//  2. Past Due: Post Date < today and never cleared -> Status "Past Due!".
//  3. Reconcile: "Scheduled!" items whose Post Date has passed -> "Live!".
//  4. Junk: Post Trigger == "Junk" -> move to the Garbage group; never send.

import * as monday from '../clients/monday';
import { COLUMNS, STATUS, POST_TRIGGER, GARBAGE_GROUP_TITLE } from '../config/board';
import { cv } from '../domain/columnValues';
import { parseItem, READ_COLUMN_IDS } from '../domain/item';
import { reportError } from '../domain/errors';
import { isBeforeTodayEastern } from '../lib/timezone';
import { pollAndSchedule } from './scheduleToBuffer';
import { pollAndCancel } from './cancelPost';
import { log } from '../lib/logger';

export interface NightlySummary {
  missedScheduled: number;
  cancelled: number;
  pastDue: number;
  reconciled: number;
  junked: number;
}

export async function runNightly(): Promise<NightlySummary> {
  const summary: NightlySummary = { missedScheduled: 0, cancelled: 0, pastDue: 0, reconciled: 0, junked: 0 };

  // 1. Safety net for anything the 5-minute poll missed.
  summary.missedScheduled = await pollAndSchedule();
  summary.cancelled = await pollAndCancel();

  // 2. Past Due — candidates are not-yet-scheduled items (ideation / Raw Draft).
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

  // 3. Reconcile scheduled posts whose date has passed.
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

  // 4. Junk -> Garbage group.
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
        try {
          await monday.moveItemToGroup(raw.id, groupId);
          summary.junked++;
        } catch (err) {
          await reportError(raw.id, 'Flow 4 junk move failed', err);
        }
      }
    }
  }

  log.info('Flow 4 nightly sweep complete', { ...summary });
  return summary;
}
