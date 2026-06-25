// Idempotency helpers.
//
// Strategy (no external store): Monday Status is the source of truth. Each send
// flow re-reads Status immediately before the non-idempotent Buffer call
// (currentStatus) and flips Status right after success, so a re-run or
// overlapping poll sees the new Status and skips. The Buffer post id is recorded
// as an item update for audit (and for a future Buffer-confirmation reconcile).

import * as monday from '../clients/monday';
import { COLUMNS } from '../config/board';

const BUFFER_MARKER = 'buffer-post-id:';

/** Record a successful Buffer send on the item (for audit + reconciliation). */
export async function recordBufferPostId(
  itemId: string,
  channelId: string,
  postId: string,
  scheduledFor: string | null,
): Promise<void> {
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

/** Recover the Buffer post id recorded by recordBufferPostId (most recent marker). */
export async function findBufferPostId(itemId: string): Promise<string | null> {
  const updates = (await monday.getItemUpdates(itemId, 30)).sort((a, b) =>
    b.created_at.localeCompare(a.created_at),
  );
  for (const u of updates) {
    const m = u.body.match(new RegExp(`${BUFFER_MARKER}([a-zA-Z0-9]+)`));
    if (m) return m[1]!;
  }
  return null;
}
