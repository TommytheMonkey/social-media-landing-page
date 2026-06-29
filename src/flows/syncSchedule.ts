// FLOW 9 — Reschedule sync. Closes the gap where editing a Post Date in Monday
// AFTER a post was scheduled did nothing (Buffer kept the old time). Runs on the
// 5-min poll (and as a nightly backstop) over every "Scheduled!" item:
//
//   - Compares the item's current Post Date (as a UTC send instant) to the instant
//     we last synced it to, recorded on the calendar mirror marker.
//   - UNCHANGED  -> no-op.
//   - CHANGED    -> reschedule: delete the old Buffer post and create a fresh one at
//                   the new time (Buffer has no in-place reschedule), move the
//                   calendar event, and record the new state.
//   - NO MARKER  -> backfill: create the calendar mirror at the current schedule
//                   (e.g. posts scheduled before this flow existed). Buffer is left
//                   alone — we have no prior instant to compare against yet.
//
// REQUIRES the calendar mirror (GOOGLE_CALENDAR_ID): the marker it writes is the
// reschedule baseline, so with the mirror off this flow is inactive by design.
// Only touches posts still QUEUED in Buffer — a post that already sent (or is
// mid-send/errored) is left for Flow 8 to reconcile, never duplicated.

import type { MondayItem } from '../types';
import * as monday from '../clients/monday';
import { createPost, deletePost, getPostStatus } from '../clients/buffer';
import { COLUMNS, STATUS } from '../config/board';
import { resolveChannelId } from '../config/channels';
import { parseItem, READ_COLUMN_IDS } from '../domain/item';
import { reportError } from '../domain/errors';
import { findBufferPostId, findCalendarSync, recordBufferPostId, currentStatus } from '../lib/idempotency';
import { scheduledUtcISO } from '../lib/timezone';
import { resolvePostTextFromDoc, prepareImageUrl } from './sendShared';
import { calendarEnabled, mirrorCreateForItem, mirrorMoveForItem } from './calendarSync';
import { DateTime } from 'luxon';
import { log } from '../lib/logger';

/** Per-item outcome of a reschedule-sync pass. */
export type SyncOutcome =
  | 'inSync' // Post Date unchanged since last sync — nothing to do.
  | 'rescheduled' // Date moved -> Buffer post replaced + calendar moved.
  | 'movedEventOnly' // Date moved but no Buffer post found -> only the calendar event moved.
  | 'backfilled' // No prior marker -> created the calendar mirror at current schedule.
  | 'alreadySent' // Buffer already published it -> leave for Flow 8 (no reschedule).
  | 'skippedBusy' // Buffer is mid-send/errored -> don't touch.
  | 'skippedNoDate' // Item has no Post Date -> can't compute a target.
  | 'skippedNonSocial' // Newsletter/Blog never reach Buffer/the calendar.
  | 'skippedMoved' // Status left Scheduled! mid-run -> bail (don't race cancel/poll).
  | 'undeletable' // Old Buffer post couldn't be removed -> NOT recreated (avoid a dup).
  | 'readError'; // Buffer status read failed -> skip; try again next poll.

export interface SyncSummary {
  /** True when the mirror isn't configured, so the flow did nothing. */
  inactive: boolean;
  candidates: number;
  rescheduled: number;
  backfilled: number;
  movedEventOnly: number;
  inSync: number;
  skipped: number;
  errors: number;
}

/** Two ISO instants describe the same scheduled minute. */
function sameInstant(a: string, b: string): boolean {
  const ta = DateTime.fromISO(a, { zone: 'utc' }).toMillis();
  const tb = DateTime.fromISO(b, { zone: 'utc' }).toMillis();
  return Number.isFinite(ta) && Number.isFinite(tb) && ta === tb;
}

/**
 * Reconcile ONE Scheduled! item's Buffer/calendar schedule with its Monday Post Date.
 * May delete+recreate the Buffer post and move the calendar event. Throws only on an
 * unexpected failure (caller logs + continues); expected "can't act" cases return an
 * outcome instead.
 */
export async function syncScheduleItem(item: MondayItem): Promise<SyncOutcome> {
  // Newsletter/Blog never reach Buffer or the calendar.
  if (!item.platform) return 'skippedNonSocial';
  if (!item.postDate) {
    log.info('Flow 9 skip — Scheduled! item has no Post Date', { itemId: item.id });
    return 'skippedNoDate';
  }

  const desiredDueAt = scheduledUtcISO(item.postDate);
  const rec = await findCalendarSync(item.id);

  // No marker yet -> backfill the mirror at the current schedule. We have no prior
  // instant to compare against, so we DON'T touch Buffer (it may or may not match);
  // once the marker exists, a later date edit is detected normally.
  if (!rec) {
    const postId = await findBufferPostId(item.id, item.bufferPostId);
    await mirrorCreateForItem(item, desiredDueAt, postId);
    return 'backfilled';
  }

  // Post Date unchanged since we last synced -> nothing to do.
  if (sameInstant(rec.dueAtUtc, desiredDueAt)) return 'inSync';

  // --- The Post Date moved. Reschedule. ---
  const postId = await findBufferPostId(item.id, item.bufferPostId);
  if (!postId) {
    // Mirror exists but we can't find the Buffer post — just move the calendar event
    // to match Monday (the source of truth) and re-baseline.
    await mirrorMoveForItem(item, rec.eventId, desiredDueAt, null);
    log.warn('Flow 9: moved calendar event but found no Buffer post id', { itemId: item.id });
    return 'movedEventOnly';
  }

  // Only reschedule a post still QUEUED in Buffer. A status read hiccup is not a
  // reason to delete/recreate — skip and retry next poll.
  const status = await getPostStatus(postId).catch((err) => {
    log.warn('Flow 9: Buffer status read failed — skipping item', {
      itemId: item.id,
      postId,
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  });
  if (!status) return 'readError';
  if (status.status === 'sent') return 'alreadySent'; // Flow 8 will flip it to Live!
  if (status.status === 'sending' || status.status === 'error') return 'skippedBusy';

  // Resolve the destination channel BEFORE deleting anything — if we can't map a
  // channel (e.g. voice was cleared), bail without touching the queued post.
  if (!item.voice) {
    log.warn('Flow 9 skip — Scheduled! item has no voice to reschedule against', { itemId: item.id });
    return 'skippedBusy';
  }
  const channelId = resolveChannelId(item.voice, item.platform);
  if (!channelId) {
    log.warn('Flow 9 skip — no Buffer channel mapped; leaving the queued post as-is', {
      itemId: item.id,
      voice: item.voice,
      platform: item.platform,
    });
    return 'skippedBusy';
  }

  // Compare-and-act: bail if the item left Scheduled! mid-run (cancel / concurrent poll).
  if ((await currentStatus(item.id)) !== STATUS.scheduled) {
    log.info('Flow 9 skip — item no longer Scheduled!', { itemId: item.id });
    return 'skippedMoved';
  }

  // Remove the old queued post BEFORE creating the new one. If Buffer can't delete it
  // (it likely just published), do NOT create a replacement — that would duplicate.
  const del = await deletePost(postId);
  if (!del.deleted) {
    await monday.createUpdate(
      item.id,
      `⚠️ Tried to reschedule to ${item.postDate}, but the old Buffer post (${postId}) ` +
        `couldn't be removed (${del.message ?? 'unknown'}) — it may have already published. ` +
        `Did NOT create a replacement to avoid a duplicate. Verify in Buffer.`,
    );
    log.warn('Flow 9: old post undeletable — not recreating', { itemId: item.id, postId });
    return 'undeletable';
  }

  // Reuse the snapshot copy taken at Clear! time; fall back to the Doc if it's empty.
  const text =
    item.contentText && item.contentText.trim().length > 0
      ? item.contentText
      : await resolvePostTextFromDoc(item);
  const imageUrl = await prepareImageUrl(item);

  const newPostId = await createPost({
    channelId,
    text,
    platform: item.platform,
    imageUrl,
    dueAtUtc: desiredDueAt,
  });

  // Record the new Buffer id (audit + column), move the calendar event, re-baseline.
  await recordBufferPostId(item.id, channelId, newPostId, item.postDate);
  await mirrorMoveForItem(item, rec.eventId, desiredDueAt, newPostId);
  await monday.createUpdate(
    item.id,
    `🔁 Rescheduled to ${item.postDate}: removed old Buffer post ${postId} and queued a new one ` +
      `(${newPostId}) for the new time; calendar event moved to match.`,
  );
  log.info('Flow 9 rescheduled post', { itemId: item.id, oldPostId: postId, newPostId, desiredDueAt });
  return 'rescheduled';
}

/** Poll all "Scheduled!" items and reconcile each item's schedule. */
export async function pollAndSyncSchedule(): Promise<SyncSummary> {
  const summary: SyncSummary = {
    inactive: false,
    candidates: 0,
    rescheduled: 0,
    backfilled: 0,
    movedEventOnly: 0,
    inSync: 0,
    skipped: 0,
    errors: 0,
  };

  // The calendar marker is the reschedule baseline — without the mirror there's
  // nothing to compare against, so the flow is inactive by design.
  if (!calendarEnabled()) {
    summary.inactive = true;
    log.info('Flow 9 inactive — GOOGLE_CALENDAR_ID not set (reschedule sync needs the calendar mirror)');
    return summary;
  }

  const scheduled = await monday.findItemsByStatus(
    [{ columnId: COLUMNS.status, label: STATUS.scheduled }],
    READ_COLUMN_IDS,
  );

  for (const raw of scheduled) {
    const item = parseItem(raw);
    summary.candidates++;
    let outcome: SyncOutcome;
    try {
      outcome = await syncScheduleItem(item);
    } catch (err) {
      summary.errors++;
      await reportError(item.id, 'Flow 9 (reschedule sync) failed', err);
      continue;
    }
    switch (outcome) {
      case 'rescheduled':
        summary.rescheduled++;
        break;
      case 'backfilled':
        summary.backfilled++;
        break;
      case 'movedEventOnly':
        summary.movedEventOnly++;
        break;
      case 'inSync':
        summary.inSync++;
        break;
      case 'readError':
        summary.errors++;
        break;
      default:
        summary.skipped++;
        break;
    }
  }

  log.info('Flow 9 reschedule sync complete', { ...summary });
  return summary;
}
