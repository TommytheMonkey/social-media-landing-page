// Google Calendar mirror — keeps a shared calendar in step with what's scheduled
// to Buffer, so the team sees the social plan at a glance. The mirror is OPTIONAL:
// everything here no-ops unless GOOGLE_CALENDAR_ID is set (calendarConfigured()).
//
// Event identity lives in the item's update trail (recordCalendarSync /
// findCalendarSync), not a board column — see lib/idempotency.ts. Create + delete
// are best-effort (a calendar hiccup must never fail or undo a Buffer send); the
// reschedule MOVE is allowed to throw so its caller (Flow 9) can surface it.

import type { MondayItem } from '../types';
import * as google from '../clients/google';
import { CALENDAR_EVENT_DURATION_MIN } from '../config/schedule';
import { recordCalendarSync, findCalendarSync } from '../lib/idempotency';
import { DateTime } from 'luxon';
import { log } from '../lib/logger';

/** True when the calendar mirror is configured (GOOGLE_CALENDAR_ID set). */
export function calendarEnabled(): boolean {
  return google.calendarConfigured();
}

/** End instant = start + the configured event duration. */
function endUtcISO(startUtcISO: string): string {
  const iso = DateTime.fromISO(startUtcISO, { zone: 'utc' })
    .plus({ minutes: CALENDAR_EVENT_DURATION_MIN })
    .toUTC()
    .toISO();
  if (!iso) throw new Error(`Could not compute calendar end time from "${startUtcISO}"`);
  return iso;
}

/** First sentence/clause of `s`, capped to ~80 chars, for a scannable event title. */
function titleSnippet(s: string): string {
  const oneLine = s.replace(/\s+/g, ' ').trim();
  const firstSentence = oneLine.split(/(?<=[.!?])\s/)[0] ?? oneLine;
  const base = firstSentence.length <= 80 ? firstSentence : oneLine;
  if (base.length <= 80) return base;
  return base.slice(0, 79).replace(/\s+\S*$/, '') + '…';
}

/** Build the event title + body for an item at a given send time. */
function eventInput(item: MondayItem, startUtcISO: string, postId: string | null): google.CalendarEventInput {
  const who = item.voice ?? 'TBD';
  const idea = item.description?.trim();
  const what = titleSnippet(idea || item.name);
  const meta = [
    `Account/voice: ${who}`,
    `Platform: ${item.platformLabels.join(', ') || item.platform || '—'}`,
    `Buffer post: ${postId ?? '—'}`,
    `Monday item: ${item.id}`,
    '',
    'Auto-synced from the Monday → Buffer content engine. Change the Post Date in',
    'Monday to reschedule — the post and this event move automatically.',
  ].join('\n');
  return {
    summary: `${item.platform ?? item.platformLabels[0] ?? 'Social'} · ${who}: ${what}`,
    description: idea ? `${idea}\n\n${meta}` : meta,
    startUtcISO,
    endUtcISO: endUtcISO(startUtcISO),
  };
}

/**
 * Create a calendar event mirroring a scheduled post and record the mirror marker.
 * BEST-EFFORT: any failure is logged and swallowed so it can never fail/undo the
 * Buffer send it follows. No-op when the mirror isn't configured.
 */
export async function mirrorCreateForItem(
  item: MondayItem,
  startUtcISO: string,
  postId: string | null,
): Promise<void> {
  if (!calendarEnabled()) return;
  try {
    const eventId = await google.insertCalendarEvent(eventInput(item, startUtcISO, postId));
    try {
      await recordCalendarSync(item.id, eventId, startUtcISO);
    } catch (recErr) {
      // The event exists but we couldn't persist its marker. Delete the orphan so a
      // later backfill (which keys off the marker) can't create a duplicate event.
      await google.deleteCalendarEvent(eventId).catch(() => undefined);
      throw recErr;
    }
    log.info('Calendar mirror created', { itemId: item.id, eventId, startUtcISO });
  } catch (err) {
    log.warn('Calendar mirror create failed (post still scheduled)', {
      itemId: item.id,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

/**
 * Move an existing mirror event to a new time and re-record the marker. NOT
 * best-effort — throws on failure so Flow 9 can report it (the Buffer post has
 * already been moved by the time this runs, so the calendar must follow or be flagged).
 */
export async function mirrorMoveForItem(
  item: MondayItem,
  eventId: string,
  startUtcISO: string,
  postId: string | null,
): Promise<void> {
  await google.patchCalendarEvent(eventId, eventInput(item, startUtcISO, postId));
  await recordCalendarSync(item.id, eventId, startUtcISO);
  log.info('Calendar mirror moved', { itemId: item.id, eventId, startUtcISO });
}

/**
 * Remove an item's mirror event (on cancel/junk). BEST-EFFORT + no-op when the
 * mirror isn't configured or the item was never mirrored.
 */
export async function removeMirrorForItem(itemId: string): Promise<void> {
  if (!calendarEnabled()) return;
  try {
    const rec = await findCalendarSync(itemId);
    if (!rec) return;
    await google.deleteCalendarEvent(rec.eventId);
    log.info('Calendar mirror removed', { itemId, eventId: rec.eventId });
  } catch (err) {
    log.warn('Calendar mirror remove failed', {
      itemId,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}
