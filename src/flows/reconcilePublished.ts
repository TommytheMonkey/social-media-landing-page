// FLOW 8 — Reconcile published. Runs on the 5-min poll (see api/cron/poll.ts) and
// as a nightly backstop (see nightlySweep.ts). Confirms whether Buffer has actually
// published each "Scheduled!" post and moves Monday to match REALITY (not a guess):
//   Buffer status "sent"  -> Status "Live!"  (+ note with sentAt & live link)
//   Buffer status "error" -> Status "Error - Check Updates" (+ Buffer's message)
//   draft/needs_approval/scheduled/sending -> not published yet; left untouched.
//
// READ-ONLY against Buffer (getPostStatus only; never create/delete here). A status-
// read hiccup must NEVER look like a publish failure: per-item read errors are logged
// and skipped with Status left untouched (same rule as Flow 6 metrics). This replaces
// the OLD nightly "optimistic" flip — we now confirm against Buffer's real status.

import type { MondayItem } from '../types';
import * as monday from '../clients/monday';
import { getPostStatus } from '../clients/buffer';
import { COLUMNS, STATUS } from '../config/board';
import { cv } from '../domain/columnValues';
import { parseItem, READ_COLUMN_IDS } from '../domain/item';
import { findBufferPostId, currentStatus } from '../lib/idempotency';
import { log } from '../lib/logger';

/** Per-item outcome of a reconcile pass. */
export type ReconcileOutcome =
  /** Buffer says published -> flipped Scheduled! to Live!. */
  | 'live'
  /** Buffer says the publish failed -> flipped Scheduled! to Error. */
  | 'failed'
  /** Not published yet (draft/scheduled/sending) -> left as Scheduled!. */
  | 'pending'
  /** Scheduled! item with no recorded Buffer post id -> nothing to check. */
  | 'skippedNoId'
  /** Buffer status read failed -> logged and skipped; Status untouched. */
  | 'readError';

export interface ReconcileSummary {
  /** Scheduled! items considered. */
  candidates: number;
  /** Items flipped to Live! (Buffer confirmed published). */
  wentLive: number;
  /** Items flipped to Error (Buffer reported a publish failure). */
  failed: number;
  /** Items still pending in Buffer — left as Scheduled!. */
  pending: number;
  /** Scheduled! items with no Buffer post id recorded (nothing to check). */
  skippedNoId: number;
  /** Buffer status-read failures (logged, NOT flipped to Error). */
  errors: number;
}

/**
 * Reconcile ONE Scheduled! item against Buffer's real post status. Read-only on
 * Buffer; may write Status on Monday. Throws only if a Monday write fails (the
 * caller logs + continues — a write hiccup is not a publish failure).
 */
export async function reconcilePublishedItem(item: MondayItem): Promise<ReconcileOutcome> {
  // Only social items ever reach Buffer (Newsletter/Blog never get a Buffer post).
  if (!item.platform) {
    log.info('Flow 8 skip — non-social item in Scheduled!', { itemId: item.id });
    return 'pending';
  }

  const postId = await findBufferPostId(item.id, item.bufferPostId);
  if (!postId) {
    log.info('Flow 8: no Buffer post id on Scheduled! item — skipping', {
      itemId: item.id,
      name: item.name,
    });
    return 'skippedNoId';
  }

  // A status-read failure is NOT a publish failure: log + skip, never touch Status.
  const result = await getPostStatus(postId).catch((err) => {
    log.warn('Flow 8: Buffer status read failed — skipping item', {
      itemId: item.id,
      postId,
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  });
  if (!result) return 'readError';

  if (result.status === 'sent') {
    // Compare-and-act: only flip if still Scheduled! (don't race the cancel flow or
    // a concurrent poll). Once Live! it no longer matches the Scheduled! filter.
    if ((await currentStatus(item.id)) !== STATUS.scheduled) {
      log.info('Flow 8 skip — item no longer Scheduled!', { itemId: item.id });
      return 'pending';
    }
    await monday.updateColumns(item.id, { [COLUMNS.status]: cv.status(STATUS.live) });
    const when = result.sentAt ? ` at ${result.sentAt}` : '';
    const link = result.externalLink ? `\n🔗 ${result.externalLink}` : '';
    await monday.createUpdate(
      item.id,
      `✅ Buffer published this post${when} — marked Live! (confirmed via Buffer status).${link}`,
    );
    log.info('Flow 8: marked Live! from Buffer status', {
      itemId: item.id,
      postId,
      sentAt: result.sentAt,
    });
    return 'live';
  }

  if (result.status === 'error') {
    if ((await currentStatus(item.id)) !== STATUS.scheduled) {
      log.info('Flow 8 skip — item no longer Scheduled!', { itemId: item.id });
      return 'pending';
    }
    await monday.updateColumns(item.id, { [COLUMNS.status]: cv.status(STATUS.error) });
    await monday.createUpdate(
      item.id,
      `❌ Buffer failed to publish this post: ${result.error ?? 'unknown error'}\n\n` +
        `Fix the issue, then re-arm it (set Post Trigger back to "Clear!") to reschedule.`,
    );
    log.warn('Flow 8: Buffer publish error — flagged for review', {
      itemId: item.id,
      postId,
      error: result.error,
    });
    return 'failed';
  }

  // draft | needs_approval | scheduled | sending | <unknown> -> not published yet.
  log.info('Flow 8: still pending in Buffer — left as Scheduled!', {
    itemId: item.id,
    postId,
    status: result.status,
  });
  return 'pending';
}

/** Poll all "Scheduled!" items and reconcile each against Buffer's real status. */
export async function pollAndReconcilePublished(): Promise<ReconcileSummary> {
  const summary: ReconcileSummary = {
    candidates: 0,
    wentLive: 0,
    failed: 0,
    pending: 0,
    skippedNoId: 0,
    errors: 0,
  };

  const scheduled = await monday.findItemsByStatus(
    [{ columnId: COLUMNS.status, label: STATUS.scheduled }],
    READ_COLUMN_IDS,
  );

  for (const raw of scheduled) {
    const item = parseItem(raw);
    summary.candidates++;
    let outcome: ReconcileOutcome;
    try {
      outcome = await reconcilePublishedItem(item);
    } catch (err) {
      // A Monday write failure here is NOT a publish failure — log + continue so a
      // single stuck item can't abort the sweep or get mislabeled as a send failure.
      summary.errors++;
      log.warn('Flow 8: reconcile item failed — skipping', {
        itemId: item.id,
        error: err instanceof Error ? err.message : String(err),
      });
      continue;
    }
    switch (outcome) {
      case 'live':
        summary.wentLive++;
        break;
      case 'failed':
        summary.failed++;
        break;
      case 'skippedNoId':
        summary.skippedNoId++;
        break;
      case 'readError':
        summary.errors++;
        break;
      case 'pending':
        summary.pending++;
        break;
    }
  }

  log.info('Flow 8 reconcile complete', { ...summary });
  return summary;
}
