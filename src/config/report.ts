// Weekly Social Marketing Report (rides Flow 7). Config for the emailed report.

/** Who receives the weekly report. */
export const REPORT_RECIPIENTS = ['tommy@takeoffmonkey.com', 'heidi@takeoffmonkey.com'];

/**
 * Workspace user the report is sent AS (From:). The service account impersonates
 * this address via domain-wide delegation, so it MUST be a real Workspace user on
 * the takeoffmonkey.com domain (must be a real Workspace user, not just an alias).
 * Override with REPORT_FROM to change the sender without a code change.
 */
export const REPORT_SENDER = process.env.REPORT_FROM || 'clyde@takeoffmonkey.com';

/** Display name on the From: header. */
export const REPORT_FROM_NAME = 'Takeoff Monkey Analytics';

/** How many trailing ISO weeks to chart in the week-over-week trend. */
export const TREND_WEEKS = 8;

/** Brand palette for charts + email (mirrors the site/style guide). */
export const BRAND = {
  jungle: '#00391F',
  jungleDeep: '#002414',
  banana: '#F5ED60',
  bananaDeep: '#E4DC44',
  concrete: '#F1F2F2',
  black: '#231F20',
  ink: '#41524A',
} as const;
