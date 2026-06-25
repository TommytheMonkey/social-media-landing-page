// Hardcoded US holiday calendar for Flow 7's holiday-proximity dimension.
// Computed in code (no external calendar API), per the spec. Floating holidays
// (nth/last weekday of a month) are resolved with luxon. Edit the list in
// holidaysForYear() to add/remove holidays.

import { DateTime } from 'luxon';

export interface Holiday {
  name: string;
  /** ISO date 'YYYY-MM-DD'. */
  date: string;
}

/** The nth occurrence (1-based) of a weekday (luxon: Mon=1..Sun=7) in a month. */
function nthWeekday(year: number, month: number, weekday: number, n: number): DateTime {
  const first = DateTime.fromObject({ year, month, day: 1 });
  const offset = (weekday - first.weekday + 7) % 7;
  return first.plus({ days: offset + (n - 1) * 7 });
}

/** The last occurrence of a weekday (Mon=1..Sun=7) in a month. */
function lastWeekday(year: number, month: number, weekday: number): DateTime {
  const last = DateTime.fromObject({ year, month, day: 1 }).endOf('month').startOf('day');
  const offset = (last.weekday - weekday + 7) % 7;
  return last.minus({ days: offset });
}

/** US holidays observed for `year`, as ISO dates. */
export function holidaysForYear(year: number): Holiday[] {
  const iso = (dt: DateTime): string => dt.toISODate()!;
  return [
    { name: "New Year's Day", date: `${year}-01-01` },
    { name: 'MLK Day', date: iso(nthWeekday(year, 1, 1, 3)) },
    { name: "Presidents' Day", date: iso(nthWeekday(year, 2, 1, 3)) },
    { name: 'Memorial Day', date: iso(lastWeekday(year, 5, 1)) },
    { name: 'Juneteenth', date: `${year}-06-19` },
    { name: 'Independence Day', date: `${year}-07-04` },
    { name: 'Labor Day', date: iso(nthWeekday(year, 9, 1, 1)) },
    { name: 'Veterans Day', date: `${year}-11-11` },
    { name: 'Thanksgiving', date: iso(nthWeekday(year, 11, 4, 4)) },
    { name: 'Christmas', date: `${year}-12-25` },
  ];
}

export interface HolidayProximity {
  near: boolean;
  holiday: string | null;
  /** Absolute day distance to the nearest holiday within the window, or null. */
  days: number | null;
}

/**
 * Whether `dateISO` falls within `windowDays` of a US holiday. Checks the prior,
 * current, and next year so dates near the Jan-1 / Dec-25 boundaries resolve.
 */
export function nearHoliday(dateISO: string, windowDays: number): HolidayProximity {
  const d = DateTime.fromISO(dateISO);
  if (!d.isValid) return { near: false, holiday: null, days: null };
  const candidates = [d.year - 1, d.year, d.year + 1].flatMap(holidaysForYear);
  let best: { holiday: string; days: number } | null = null;
  for (const h of candidates) {
    const days = Math.abs(DateTime.fromISO(h.date).diff(d, 'days').days);
    if (days <= windowDays && (best === null || days < best.days)) {
      best = { holiday: h.name, days };
    }
  }
  return best ? { near: true, holiday: best.holiday, days: best.days } : { near: false, holiday: null, days: null };
}
