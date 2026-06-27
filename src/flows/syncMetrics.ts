// FLOW 6 — Post-metrics sync. Runs DAILY (see api/cron/metrics.ts). Pulls
// normalized performance metrics from Buffer for recently-published posts and
// writes them back to the Monday board so the team can sort/filter by performance.
//
// READ-ONLY against Buffer (never createPost/deletePost here). Writes ONLY the six
// metric numeric columns + the metricsSyncedAt tracking column — never Status,
// triggers, content, or dates. A metrics-read hiccup must NEVER look like a publish
// failure, so per-item errors are logged and skipped (Status is left untouched).
//
// Selection (ALL must hold): Status == "Live!", Platform in (LinkedIn|Instagram),
// a stored Buffer post id exists (from Flow 2/3), and Post Date is within the last
// 7 days. Older Live posts age out and stop being refreshed — the stop condition.
//
// MISSING != ZERO: a metric type absent from Buffer's array is unknown, not zero —
// its column is left as-is. FRESHNESS: metrics lag ~24h and climb over the window;
// skip the write entirely when metricsUpdatedAt hasn't advanced since the last sync.

import * as monday from '../clients/monday';
import { getPostMetrics } from '../clients/buffer';
import { COLUMNS, STATUS, METRIC_COLUMNS } from '../config/board';
import { cv } from '../domain/columnValues';
import { parseItem, READ_COLUMN_IDS } from '../domain/item';
import { findBufferPostId } from '../lib/idempotency';
import { daysAgoInEastern } from '../lib/timezone';
import { log } from '../lib/logger';

/** Posts older than this (by Post Date) age out of the refresh window. */
const WINDOW_DAYS = 7;

/** Columns to read for selection — board fields + the freshness marker. */
const COLS = [...READ_COLUMN_IDS, COLUMNS.metricsSyncedAt];

export interface MetricsSyncSummary {
  /** Live, social, in-window items considered. */
  candidates: number;
  /** Items we wrote columns to (fresh metrics). */
  written: number;
  /** In-window items with no recorded Buffer post id (nothing to read). */
  skippedNoId: number;
  /** Posts Buffer hasn't ingested metrics for yet (metricsUpdatedAt null). */
  skippedNoMetrics: number;
  /** Posts whose metrics haven't changed since the last sync. */
  skippedUnchanged: number;
  /** Per-item Buffer/Monday failures (logged, NOT flipped to Error status). */
  errors: number;
}

export async function runMetricsSync(): Promise<MetricsSyncSummary> {
  const summary: MetricsSyncSummary = {
    candidates: 0,
    written: 0,
    skippedNoId: 0,
    skippedNoMetrics: 0,
    skippedUnchanged: 0,
    errors: 0,
  };

  // Window cutoff (inclusive). ISO 'YYYY-MM-DD' strings sort lexicographically.
  const cutoff = daysAgoInEastern(WINDOW_DAYS);

  // All Live! items; the platform + window filters are applied in code below so we
  // never call Buffer for posts that have aged out (consistent with the nightly sweep).
  const live = await monday.findItemsByStatus(
    [{ columnId: COLUMNS.status, label: STATUS.live }],
    COLS,
  );

  for (const raw of live) {
    const item = parseItem(raw);

    // Social only — Newsletter/Blog never reach Buffer, so they have no metrics.
    if (!item.platform) continue;
    // 7-day window — older posts age out (stop condition).
    if (!item.postDate || item.postDate < cutoff) continue;

    summary.candidates++;

    const postId = await findBufferPostId(item.id);
    if (!postId) {
      summary.skippedNoId++;
      log.info('Flow 6: no Buffer post id on item — skipping', { itemId: item.id, name: item.name });
      continue;
    }

    // Metrics-read failure is NOT a publish failure: log + skip, never touch Status.
    const result = await getPostMetrics(postId).catch((err) => {
      summary.errors++;
      log.warn('Flow 6: Buffer metrics read failed — skipping item', {
        itemId: item.id,
        postId,
        error: err instanceof Error ? err.message : String(err),
      });
      return null;
    });
    if (!result) continue;

    // No metrics ingested yet (can lag ~24h after publish) — leave columns as-is.
    if (!result.metricsUpdatedAt) {
      summary.skippedNoMetrics++;
      continue;
    }

    // Freshness guard: nothing new since last sync -> skip the write entirely.
    const lastSynced = raw.column_values.find((c) => c.id === COLUMNS.metricsSyncedAt)?.text || null;
    if (lastSynced && lastSynced === result.metricsUpdatedAt) {
      summary.skippedUnchanged++;
      continue;
    }

    // Build the write: only metric types PRESENT in Buffer's array. Absent => untouched.
    const values: Record<string, unknown> = {};
    const wrote: string[] = [];
    for (const m of result.metrics) {
      if (!Object.prototype.hasOwnProperty.call(METRIC_COLUMNS, m.type)) continue; // untracked (engagementRate/follows/clicks/etc.)
      const col = METRIC_COLUMNS[m.type];
      if (!col) {
        // Configured-but-blank column id: honor "log a clear error and skip; never guess."
        log.error('Flow 6: tracked metric has no Monday column id configured — skipping metric', {
          itemId: item.id,
          type: m.type,
        });
        continue;
      }
      values[col] = cv.number(m.value);
      wrote.push(m.type);
    }

    // Always advance the freshness marker (even if no tracked metric was present this
    // round) so the same snapshot isn't re-fetched and re-evaluated every day.
    values[COLUMNS.metricsSyncedAt] = cv.text(result.metricsUpdatedAt);

    try {
      await monday.updateColumns(item.id, values);
      summary.written++;
      log.info('Flow 6: synced metrics', {
        itemId: item.id,
        name: item.name,
        platform: item.platform,
        metricsUpdatedAt: result.metricsUpdatedAt,
        wrote,
      });
    } catch (err) {
      // Monday write failure is also not a publish failure — log + continue.
      summary.errors++;
      log.warn('Flow 6: Monday metric write failed — skipping item', {
        itemId: item.id,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  log.info('Flow 6 metrics sync complete', { ...summary, cutoff });
  return summary;
}
