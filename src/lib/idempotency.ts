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
