// Idempotency helpers.
//
// Strategy (no external store): Monday Status is the source of truth. Each send
// flow re-reads Status immediately before the non-idempotent Buffer call
// (currentStatus) and flips Status right after success, so a re-run or
// overlapping poll sees the new Status and skips. The Buffer post id is recorded
// as an item update for audit (and for a future Buffer-confirmation reconcile).

import * as monday from '../clients/monday';
import { COLUMNS } from '../config/board';
import { cv } from '../domain/columnValues';

const BUFFER_MARKER = 'buffer-post-id:';
// Calendar mirror marker. Like the Buffer marker, we record the Google Calendar
// event id (and the UTC instant we last synced it to) in the item's update trail
// rather than a dedicated board column — recoverable by scanning updates, and the
// newest marker wins. The recorded `due` doubles as the reschedule-detection
// baseline: if the item's Post Date no longer maps to this instant, it moved.
const CALENDAR_MARKER = 'calendar-event-id:';
// Event id stops at whitespace or a `<` (Monday may return update bodies wrapped in
// HTML); the due instant is matched as a strict ISO-8601 UTC value ending in Z.
const CALENDAR_MARKER_RE = /calendar-event-id:([^\s<]+)\s+due:(\d{4}-\d{2}-\d{2}T[\d:.]+Z)/;

/**
 * Record a successful Buffer send on the item. Writes the post id to the
 * Buffer Post ID column (the primary, structured lookup) AND posts an audit
 * update (human-readable history; also the fallback for pre-column items). The
 * column write is best-effort: a failure there must not undo the send, so it's
 * logged and swallowed — findBufferPostId still recovers the id from the update.
 */
export async function recordBufferPostId(
  itemId: string,
  channelId: string,
  postId: string,
  scheduledFor: string | null,
): Promise<void> {
  await monday
    .updateColumns(itemId, { [COLUMNS.bufferPostId]: cv.text(postId) })
    .catch(() => undefined);
  const when = scheduledFor ? `scheduled for ${scheduledFor}` : 'posted now';
  await monday.createUpdate(
    itemId,
    `✅ Sent to Buffer (${when})\n${BUFFER_MARKER}${postId} (channel ${channelId})`,
  );
}

/** A recovered calendar-mirror record: the event id + the UTC instant last synced. */
export interface CalendarSyncRecord {
  eventId: string;
  /** ISO-8601 UTC instant this event was last scheduled to (reschedule baseline). */
  dueAtUtc: string;
}

/**
 * Record (or re-record) the calendar mirror for an item: the Google Calendar
 * event id and the UTC instant it now points at. Posted as an item update so the
 * newest one reflects the current state — no dedicated board column required.
 */
export async function recordCalendarSync(
  itemId: string,
  eventId: string,
  dueAtUtc: string,
): Promise<void> {
  await monday.createUpdate(
    itemId,
    `📅 Calendar mirror synced (event for ${dueAtUtc})\n${CALENDAR_MARKER}${eventId} due:${dueAtUtc}`,
  );
}

/**
 * Recover the most-recent calendar mirror record for an item by scanning its
 * updates (newest first). Returns null if the post was never mirrored — callers
 * treat that as "needs a backfill". Same scan strategy as findBufferPostId.
 */
export async function findCalendarSync(itemId: string): Promise<CalendarSyncRecord | null> {
  const PAGE = 50;
  for (let page = 1; page <= 10; page++) {
    const updates = await monday.getItemUpdates(itemId, PAGE, page);
    if (updates.length === 0) break;
    for (const u of updates) {
      const m = u.body.match(CALENDAR_MARKER_RE);
      if (m) return { eventId: m[1]!, dueAtUtc: m[2]! };
    }
    if (updates.length < PAGE) break;
  }
  return null;
}

/**
 * Re-read an item's CURRENT status label (fresh from Monday), for a
 * compare-and-act guard immediately before a non-idempotent send. Narrows the
 * double-send window against overlapping polls and stale snapshots.
 */
export async function currentStatus(itemId: string): Promise<string | null> {
  const [fresh] = await monday.getItems([itemId], [COLUMNS.status]);
  if (!fresh) return null;
  return fresh.column_values.find((c) => c.id === COLUMNS.status)?.text ?? null;
}

/**
 * Recover the Buffer post id for an item. Prefers the structured Buffer Post ID
 * column (pass it in via `fromColumn` — flows already fetch it on the parsed item,
 * so this costs no extra read). Falls back to scanning the item's updates for the
 * marker, which keeps items posted before the column existed resolvable.
 */
export async function findBufferPostId(
  itemId: string,
  fromColumn?: string | null,
): Promise<string | null> {
  if (fromColumn && fromColumn.length > 0) return fromColumn;

  const re = new RegExp(`${BUFFER_MARKER}([^\\s)]+)`);
  const PAGE = 50;
  for (let page = 1; page <= 10; page++) {
    const updates = await monday.getItemUpdates(itemId, PAGE, page);
    if (updates.length === 0) break;
    for (const u of updates) {
      const m = u.body.match(re);
      if (m) return m[1]!;
    }
    if (updates.length < PAGE) break;
  }
  return null;
}
