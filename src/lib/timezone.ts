// Timezone helpers. Buffer's `dueAt` requires UTC and has no timezone field,
// so we convert "05:00 America/New_York on <postDate>" to a UTC instant here.
// luxon resolves the EST/EDT offset for that specific date automatically.

import { DateTime } from 'luxon';
import { POST_LOCAL_TIME, POST_TIMEZONE } from '../config/schedule';

/**
 * Given an ISO date 'YYYY-MM-DD', return the UTC ISO-8601 instant for the
 * configured post time (05:00 ET) on that date, e.g.
 *   '2026-06-25' -> '2026-06-25T09:00:00.000Z' (EDT)
 *   '2026-01-15' -> '2026-01-15T10:00:00.000Z' (EST)
 */
export function scheduledUtcISO(postDate: string): string {
  const local = DateTime.fromISO(postDate, { zone: POST_TIMEZONE }).set({
    hour: POST_LOCAL_TIME.hour,
    minute: POST_LOCAL_TIME.minute,
    second: POST_LOCAL_TIME.second,
    millisecond: 0,
  });
  if (!local.isValid) {
    throw new Error(`Invalid post date "${postDate}": ${local.invalidReason ?? 'unknown'}`);
  }
  const iso = local.toUTC().toISO({ suppressMilliseconds: false });
  if (!iso) throw new Error(`Could not convert "${postDate}" to UTC ISO`);
  return iso;
}

/**
 * True if the configured send time (05:00 ET) on `postDate` is at or before now.
 * Used to skip reconciling posts Buffer can't possibly have published yet — a
 * future-dated post is always still "pending", so a Buffer status read is wasted.
 */
export function sendTimePassed(postDate: string): boolean {
  const send = DateTime.fromISO(scheduledUtcISO(postDate), { zone: 'utc' });
  return send.toMillis() <= DateTime.utc().toMillis();
}

/** Today's date 'YYYY-MM-DD' in ET (for the nightly past-due / reconcile sweep). */
export function todayInEastern(): string {
  const d = DateTime.now().setZone(POST_TIMEZONE).toISODate();
  if (!d) throw new Error('Could not compute current ET date');
  return d;
}

/** True if `postDate` (YYYY-MM-DD) is strictly before today in ET. */
export function isBeforeTodayEastern(postDate: string): boolean {
  return postDate < todayInEastern();
}

/** Date 'YYYY-MM-DD' `days` days before today in ET (for the metrics-sync window). */
export function daysAgoInEastern(days: number): string {
  const d = DateTime.now().setZone(POST_TIMEZONE).minus({ days }).toISODate();
  if (!d) throw new Error('Could not compute a past ET date');
  return d;
}

/** Date 'YYYY-MM-DD' of the upcoming Monday in ET (next Monday if today is Monday). */
export function upcomingMonday(): string {
  const now = DateTime.now().setZone(POST_TIMEZONE);
  const add = ((1 - now.weekday + 7) % 7) || 7; // luxon: Monday=1 .. Sunday=7
  const d = now.plus({ days: add }).toISODate();
  if (!d) throw new Error('Could not compute the upcoming Monday');
  return d;
}

/**
 * Date 'YYYY-MM-DD' of the Friday in the CURRENT ISO week in ET (Mon–Sun week).
 * Names the newsletter folder ("week of {this}"), e.g. run on Wed 2026-07-01 ->
 * '2026-07-03'. On Sat/Sun this returns that week's Friday (already passed).
 */
export function thisWeeksFriday(): string {
  const now = DateTime.now().setZone(POST_TIMEZONE);
  const d = now.plus({ days: 5 - now.weekday }).toISODate(); // luxon: Friday=5
  if (!d) throw new Error('Could not compute this week\'s Friday');
  return d;
}
