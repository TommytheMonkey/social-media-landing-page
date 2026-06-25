// Flow 7 — weekly learnings digest config. All advisory, machine-owned.

import { COLUMNS } from './board';

/** Social Media Drive root (same root Flow 1 uses for post folders). */
export const SOCIAL_ROOT_FOLDER_ID = '1Wu0FgCbW1qddaispMxVNqdOt-suFJZqe';
/** Subfolder (under the root) holding the digest. */
export const LEARNINGS_FOLDER_SEGMENTS = ['Learnings'];
/** The single rolling digest doc — a new dated section is prepended each week. */
export const LEARNINGS_DOC_NAME = 'Performance Learnings';

/**
 * Minimum posts in a cohort before a comparative claim may be stated without a
 * "directional only / too early to trust" hedge. Below this, NEVER a conclusion.
 */
export const MIN_COHORT_N = 8;

/** A post is "near-holiday" if its Post Date is within this many days of a holiday. */
export const HOLIDAY_WINDOW_DAYS = 3;

/** Posts with a Post Date within this many days count as "this week". */
export const WEEK_WINDOW_DAYS = 7;

/** How much of the prior (rolling) doc to feed the model for multi-week patterns. */
export const PRIOR_EXCERPT_CHARS = 6000;

/** The six performance metrics: label + the Monday numeric column they live in. */
export const METRIC_FIELDS = [
  { key: 'reach', label: 'Reach', col: COLUMNS.metricReach },
  { key: 'comments', label: 'Comments', col: COLUMNS.metricComments },
  { key: 'reactions', label: 'Reactions', col: COLUMNS.metricReactions },
  { key: 'shares', label: 'Shares', col: COLUMNS.metricShares },
  { key: 'saves', label: 'Saves', col: COLUMNS.metricSaves },
  { key: 'impressions', label: 'Impressions', col: COLUMNS.metricImpressions },
] as const;

export type MetricKey = (typeof METRIC_FIELDS)[number]['key'];
