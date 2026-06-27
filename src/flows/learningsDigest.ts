// FLOW 7 — Weekly learnings digest (ADVISORY, machine-owned). Runs weekly (see
// api/cron/learnings.ts). Reads Flow 6's metrics + structured post attributes off
// the Monday board, compares cohorts per dimension (POV, Post Type, Day of Week,
// Holiday proximity), and writes a plain-language "what's working" digest to a
// single rolling Google Doc (newest week prepended) under /Learnings.
//
// HARD GUARDS:
//  - Read-only against Monday — never modifies posts, statuses, triggers, content.
//  - NEVER touches the style guide / voice profile / branding. The only write is the
//    digest doc, which is machine-owned and explicitly advisory.
//  - All numbers + every `n` are computed HERE (deterministic); the model only
//    narrates them and must hedge any cohort below MIN_COHORT_N as directional.

import { DateTime } from 'luxon';
import * as monday from '../clients/monday';
import type { RawItem } from '../clients/monday';
import * as google from '../clients/google';
import { generateLearnings, type LearningsProse } from '../generation/learnings';
import {
  buildReportHtml,
  type ReportData,
  type WeeklyPoint,
  type DimensionChart,
  type CohortBar,
  type TopPost,
} from '../generation/reportEmail';
import { COLUMNS, STATUS, BOARD_ID } from '../config/board';
import { REPORT_RECIPIENTS, REPORT_SENDER, REPORT_FROM_NAME, TREND_WEEKS } from '../config/report';
import {
  SOCIAL_ROOT_FOLDER_ID,
  LEARNINGS_FOLDER_SEGMENTS,
  LEARNINGS_DOC_NAME,
  MIN_COHORT_N,
  HOLIDAY_WINDOW_DAYS,
  WEEK_WINDOW_DAYS,
  PRIOR_EXCERPT_CHARS,
  METRIC_FIELDS,
} from '../config/learnings';
import { parseItem, READ_COLUMN_IDS } from '../domain/item';
import { nearHoliday } from '../lib/holidays';
import { mean, median, round1 } from '../lib/stats';
import { todayInEastern, daysAgoInEastern } from '../lib/timezone';
import { log } from '../lib/logger';

type Pov = 'Personal' | 'Brand' | 'Hybrid';

interface PostRow {
  id: string;
  name: string;
  platform: string;
  voice: string | null;
  pov: Pov | null;
  postType: string | null;
  postDate: string;
  dayOfWeek: string | null;
  nearHoliday: boolean;
  holiday: string | null;
  thisWeek: boolean;
  metrics: Record<string, number | null>;
}

interface MetricStat {
  n: number;
  mean: number | null;
  median: number | null;
  /** True when the metric has data but n is below the threshold — hedge as directional. */
  directional: boolean;
}
interface Cohort {
  cohort: string;
  posts: number;
  metrics: Record<string, MetricStat>;
  confounds: string[];
}
interface Dimension {
  dimension: string;
  cohorts: Cohort[];
}

export interface LearningsSummary {
  livePosts: number;
  thisWeek: number;
  dimensions: Array<{ dimension: string; cohorts: number }>;
  docUrl: string;
  /** Whether the weekly marketing-report email was sent this run. */
  emailSent: boolean;
}

/** Collapse Voice -> POV cohort. TBD/Other/unknown -> null (excluded from POV). */
function toPov(voice: string | null): Pov | null {
  switch (voice) {
    case 'Tommy':
    case 'Heidi':
      return 'Personal';
    case 'Takeoff Monkey':
      return 'Brand';
    case 'Tommy + TOM':
    case 'Heidi + TOM':
      return 'Hybrid';
    default:
      return null;
  }
}

/** Read a Monday numbers column as a number, or null when empty/non-numeric. */
function numAt(raw: RawItem, colId: string): number | null {
  const t = raw.column_values.find((c) => c.id === colId)?.text;
  if (!t) return null;
  const n = parseFloat(t.replace(/,/g, ''));
  return Number.isFinite(n) ? n : null;
}

/** Per-metric n/mean/median over a cohort. A metric absent on a post is excluded
 *  (missing != zero) so each metric carries its own honest n. */
function statsFor(posts: PostRow[]): Record<string, MetricStat> {
  const out: Record<string, MetricStat> = {};
  for (const f of METRIC_FIELDS) {
    const vals = posts.map((p) => p.metrics[f.key]).filter((v): v is number => v != null);
    out[f.key] = {
      n: vals.length,
      mean: vals.length ? round1(mean(vals)!) : null,
      median: vals.length ? round1(median(vals)!) : null,
      directional: vals.length > 0 && vals.length < MIN_COHORT_N,
    };
  }
  return out;
}

function groupBy(posts: PostRow[], keyFn: (p: PostRow) => string | null): Map<string, PostRow[]> {
  const m = new Map<string, PostRow[]>();
  for (const p of posts) {
    const k = keyFn(p);
    if (k == null) continue;
    const arr = m.get(k);
    if (arr) arr.push(p);
    else m.set(k, [p]);
  }
  return m;
}

/** Composite engagement = reactions + comments + shares + saves (present only). */
const ENGAGEMENT_KEYS = ['reactions', 'comments', 'shares', 'saves'] as const;
function engagementOf(m: Record<string, number | null>): { value: number; has: boolean } {
  let value = 0;
  let has = false;
  for (const k of ENGAGEMENT_KEYS) {
    const v = m[k];
    if (v != null) {
      value += v;
      has = true;
    }
  }
  return { value, has };
}

/** Aggregate engagement + reach per ISO week (Mon-start), trailing `weeks`. */
function buildWeekly(posts: PostRow[], weeks: number): WeeklyPoint[] {
  const byWeek = new Map<string, { iso: string; label: string; eng: number; reach: number; posts: number }>();
  for (const p of posts) {
    const dt = DateTime.fromISO(p.postDate);
    if (!dt.isValid) continue;
    const start = dt.startOf('week');
    const iso = start.toISODate()!;
    const b = byWeek.get(iso) ?? { iso, label: start.toFormat('MMM d'), eng: 0, reach: 0, posts: 0 };
    const e = engagementOf(p.metrics);
    if (e.has) b.eng += e.value;
    if (p.metrics.reach != null) b.reach += p.metrics.reach;
    b.posts += 1;
    byWeek.set(iso, b);
  }
  return [...byWeek.values()]
    .sort((a, b) => a.iso.localeCompare(b.iso))
    .slice(-weeks)
    .map((b) => ({ week: b.label, engagement: Math.round(b.eng), reach: Math.round(b.reach), posts: b.posts }));
}

const OTHER_ATTRS: Array<{ label: string; fn: (p: PostRow) => string | null }> = [
  { label: 'Post Type', fn: (p) => p.postType },
  { label: 'POV', fn: (p) => p.pov },
  { label: 'Day of Week', fn: (p) => p.dayOfWeek },
  { label: 'Holiday proximity', fn: (p) => (p.nearHoliday ? 'Near holiday' : 'Normal') },
];

/** Flag when a cohort is dominated (>=80%) by a single value of ANOTHER dimension. */
function confoundsFor(posts: PostRow[], selfLabel: string): string[] {
  const notes: string[] = [];
  if (posts.length < 2) return notes;
  for (const attr of OTHER_ATTRS) {
    if (attr.label === selfLabel) continue;
    const counts = new Map<string, number>();
    let known = 0;
    for (const p of posts) {
      const v = attr.fn(p);
      if (v == null) continue;
      counts.set(v, (counts.get(v) ?? 0) + 1);
      known++;
    }
    if (known < 2) continue;
    let topVal = '';
    let topN = 0;
    for (const [v, n] of counts) if (n > topN) ((topN = n), (topVal = v));
    if (topN / known >= 0.8) {
      notes.push(`${Math.round((topN / known) * 100)}% of these are "${topVal}" (${attr.label}) — possible confound`);
    }
  }
  return notes;
}

function buildDimension(label: string, posts: PostRow[], keyFn: (p: PostRow) => string | null): Dimension {
  const groups = groupBy(posts, keyFn);
  const cohorts: Cohort[] = [];
  for (const [cohort, ps] of groups) {
    cohorts.push({ cohort, posts: ps.length, metrics: statsFor(ps), confounds: confoundsFor(ps, label) });
  }
  cohorts.sort((a, b) => b.posts - a.posts);
  return { dimension: label, cohorts };
}

// --- rendering (deterministic; numbers never come from the model) ------------

const fmt = (v: number | null | undefined): string => (v == null ? '—' : String(v));

function renderThisWeek(posts: PostRow[]): string {
  const tw = posts.filter((p) => p.thisWeek);
  if (tw.length === 0) return "This week's posts: none with a Post Date in the last 7 days.\n";
  const lines = tw.map((p) => {
    const m = p.metrics;
    return (
      `  • ${p.name} [${p.postType ?? 'no type'} | ${p.pov ?? p.voice ?? 'no voice'} | ${p.dayOfWeek ?? '?'} | ${p.nearHoliday ? 'near ' + p.holiday : 'normal'}]\n` +
      `      reach ${fmt(m.reach)} · impressions ${fmt(m.impressions)} · reactions ${fmt(m.reactions)} · comments ${fmt(m.comments)} · shares ${fmt(m.shares)} · saves ${fmt(m.saves)}`
    );
  });
  return `This week's posts (${tw.length}):\n${lines.join('\n')}\n`;
}

function renderDimension(dim: Dimension): string {
  if (dim.cohorts.length === 0) return `### ${dim.dimension}\n  (no posts with this attribute yet)\n`;
  const out: string[] = [`### ${dim.dimension}`];
  for (const c of dim.cohorts) {
    const bits = METRIC_FIELDS.map((f) => {
      const s = c.metrics[f.key]!;
      if (s.n === 0) return null;
      const flag = s.directional ? ' ⚠directional' : '';
      return `${f.label} μ=${fmt(s.mean)} (med ${fmt(s.median)}, n=${s.n}${flag})`;
    }).filter(Boolean);
    out.push(`  ${c.cohort} — ${c.posts} post(s): ${bits.join(' · ')}`);
    for (const cf of c.confounds) out.push(`      ⚑ ${cf}`);
  }
  return out.join('\n') + '\n';
}

export async function runLearningsDigest(): Promise<LearningsSummary> {
  const today = todayInEastern();
  // Exactly the last 7 calendar days, capped at today (no future-dated posts).
  const cutoff = daysAgoInEastern(WEEK_WINDOW_DAYS - 1);
  const cols = [...READ_COLUMN_IDS, ...METRIC_FIELDS.map((f) => f.col)];

  const live = await monday.findItemsByStatus([{ columnId: COLUMNS.status, label: STATUS.live }], cols);

  const rows: PostRow[] = [];
  for (const raw of live) {
    const item = parseItem(raw);
    if (!item.platform) continue; // social only — never Newsletter/Blog
    if (!item.postDate) continue; // need a date for the day/holiday dimensions
    const hp = nearHoliday(item.postDate, HOLIDAY_WINDOW_DAYS);
    const metrics: Record<string, number | null> = {};
    for (const f of METRIC_FIELDS) metrics[f.key] = numAt(raw, f.col);
    rows.push({
      id: item.id,
      name: item.name,
      platform: item.platform,
      voice: item.voice,
      pov: toPov(item.voice),
      postType: item.postType,
      postDate: item.postDate,
      dayOfWeek: DateTime.fromISO(item.postDate).weekdayLong,
      nearHoliday: hp.near,
      holiday: hp.holiday,
      thisWeek: item.postDate >= cutoff && item.postDate <= today,
      metrics,
    });
  }

  const dimensions: Dimension[] = [
    buildDimension('POV', rows, (p) => p.pov),
    buildDimension('Post Type', rows, (p) => p.postType),
    buildDimension('Day of Week', rows, (p) => p.dayOfWeek),
    buildDimension('Holiday proximity', rows, (p) => (p.nearHoliday ? 'Near holiday' : 'Normal')),
  ];
  const thisWeekCount = rows.filter((p) => p.thisWeek).length;

  // --- Report data (KPIs, week-over-week, dimension charts, top/bottom) --------
  // "This week" vs the prior 7-day window (adjacent), by Post Date.
  const lastWeekEnd = daysAgoInEastern(WEEK_WINDOW_DAYS); // 7 days ago
  const lastWeekStart = daysAgoInEastern(2 * WEEK_WINDOW_DAYS - 1); // 13 days ago
  const sums = (filter: (p: PostRow) => boolean) => {
    let reach = 0;
    let impressions = 0;
    let engagement = 0;
    let posts = 0;
    for (const p of rows) {
      if (!filter(p)) continue;
      posts++;
      if (p.metrics.reach != null) reach += p.metrics.reach;
      if (p.metrics.impressions != null) impressions += p.metrics.impressions;
      const e = engagementOf(p.metrics);
      if (e.has) engagement += e.value;
    }
    return { reach, impressions, engagement, posts };
  };
  const tw = sums((p) => p.thisWeek);
  const lw = sums((p) => p.postDate >= lastWeekStart && p.postDate <= lastWeekEnd);
  const pct = (cur: number, prev: number): number | null => (prev > 0 ? round1(((cur - prev) / prev) * 100) : null);

  const dimChart = (label: string, keyFn: (p: PostRow) => string | null): DimensionChart => {
    const cohorts: CohortBar[] = [];
    for (const [name, ps] of groupBy(rows, keyFn)) {
      const vals = ps.map((p) => engagementOf(p.metrics)).filter((e) => e.has).map((e) => e.value);
      if (vals.length) cohorts.push({ name, n: vals.length, avgEngagement: round1(mean(vals)!) });
    }
    cohorts.sort((a, b) => b.avgEngagement - a.avgEngagement);
    return { label, cohorts };
  };

  const ranked = rows
    .map((p) => ({ p, e: engagementOf(p.metrics) }))
    .filter((x) => x.e.has)
    .sort((a, b) => b.e.value - a.e.value);
  const toTop = (x: { p: PostRow; e: { value: number } }): TopPost => ({
    name: x.p.name,
    platform: x.p.platform,
    engagement: x.e.value,
    reach: x.p.metrics.reach ?? null,
  });

  const reportData: ReportData = {
    kpis: {
      weekEnding: today,
      posts: tw.posts,
      reach: tw.reach,
      impressions: tw.impressions,
      engagement: tw.engagement,
      deltas: {
        reach: pct(tw.reach, lw.reach),
        impressions: pct(tw.impressions, lw.impressions),
        engagement: pct(tw.engagement, lw.engagement),
      },
    },
    weekly: buildWeekly(rows, TREND_WEEKS),
    dimensionCharts: [
      dimChart('POV', (p) => p.pov),
      dimChart('Post Type', (p) => p.postType),
      dimChart('Day of Week', (p) => p.dayOfWeek),
    ],
    topPosts: ranked.slice(0, 3).map(toTop),
    bottomPosts: ranked.length > 3 ? ranked.slice(-3).reverse().map(toTop) : [],
    docUrl: '', // filled in after the doc is resolved below
    boardUrl: process.env.MONDAY_BOARD_URL || `https://monday.com/boards/${BOARD_ID}`,
  };

  // Ensure the rolling doc exists; read prior content (newest-first) BEFORE writing.
  const folder = await google.ensureFolderPath(SOCIAL_ROOT_FOLDER_ID, LEARNINGS_FOLDER_SEGMENTS);
  let docId = await google.findDocByName(folder.id, LEARNINGS_DOC_NAME);
  let priorExcerpt = '';
  if (docId) {
    priorExcerpt = (await google.readDocText(docId)).slice(0, PRIOR_EXCERPT_CHARS);
  } else {
    docId = (await google.createDoc(folder.id, LEARNINGS_DOC_NAME, '')).id;
  }
  const docUrl = `https://docs.google.com/document/d/${docId}/edit`;
  reportData.docUrl = docUrl;

  // Prose interpretation (the model narrates the computed numbers; it never sources
  // figures). On any failure we still write the deterministic tables.
  let prose: LearningsProse;
  if (rows.length === 0) {
    prose = {
      execSummary: 'No Live LinkedIn/Instagram posts with metrics yet — nothing to analyze.',
      whatsWorking: 'No Live LinkedIn/Instagram posts with metrics yet — nothing to analyze.',
      proposedStyleGuideEdits: [],
      humanDecisions: [],
      multiWeekPatterns: 'Not enough history yet.',
    };
  } else {
    const analysis = {
      weekEnding: today,
      totalLivePosts: rows.length,
      thisWeekCount,
      threshold: MIN_COHORT_N,
      dimensions,
    };
    try {
      prose = await generateLearnings(JSON.stringify(analysis), priorExcerpt);
    } catch (err) {
      log.error('Flow 7: prose generation failed — writing tables only', {
        error: err instanceof Error ? err.message : String(err),
      });
      prose = {
        execSummary: '(Interpretation unavailable this run — see the cohort tables for the raw numbers.)',
        whatsWorking: '(Interpretation unavailable this run — see the cohort tables above for the raw numbers.)',
        proposedStyleGuideEdits: [],
        humanDecisions: [],
        multiWeekPatterns: 'Not enough history yet.',
      };
    }
  }

  const sep = '\n' + '─'.repeat(60) + '\n\n';
  const renderEdits = prose.proposedStyleGuideEdits.length
    ? prose.proposedStyleGuideEdits.map((e) => `  • ${e.title}: "${e.edit}" — ${e.rationale}`).join('\n')
    : '  • (nothing clears even a directional bar yet)';
  const renderDecisions = prose.humanDecisions.length
    ? prose.humanDecisions.map((d) => `  • [${d.area}] ${d.recommendation} — ${d.rationale}`).join('\n')
    : '  • (none this week)';
  const section =
    `=== Performance Learnings — week ending ${today} (generated ${today}) ===\n` +
    `[ADVISORY · machine-generated. Read-only signal for humans. Does NOT modify the style guide, voice profile, or any post. The style guide remains authoritative on voice — treat everything below as suggestions for human review.]\n\n` +
    `Summary: ${prose.execSummary}\n\n` +
    renderThisWeek(rows) +
    '\n' +
    `Cohort comparisons across all ${rows.length} Live LinkedIn/Instagram post(s) — any cohort below n=${MIN_COHORT_N} is directional only, not a conclusion:\n` +
    dimensions.map(renderDimension).join('\n') +
    '\n' +
    `What's working (interpretation):\n${prose.whatsWorking}\n\n` +
    `Proposed style-guide edits (advisory — apply by hand, NOT auto-applied):\n${renderEdits}\n\n` +
    `Founder decisions (out of the system's lane):\n${renderDecisions}\n\n` +
    `Multi-week patterns:\n${prose.multiWeekPatterns}\n` +
    sep;

  await google.prependToDoc(docId, section);

  // Email the marketing report to the founders (best-effort: a send failure must
  // not fail the digest, which is already written to the doc).
  let emailSent = false;
  try {
    const html = buildReportHtml(reportData, prose);
    await google.sendHtmlEmail({
      sender: REPORT_SENDER,
      to: REPORT_RECIPIENTS,
      subject: `📊 Social Marketing Report — week ending ${today}`,
      html,
      fromName: REPORT_FROM_NAME,
    });
    emailSent = true;
    log.info('Flow 7: report email sent', { to: REPORT_RECIPIENTS });
  } catch (err) {
    log.error('Flow 7: report email failed (digest still written)', {
      error: err instanceof Error ? err.message : String(err),
    });
  }

  const summary: LearningsSummary = {
    livePosts: rows.length,
    thisWeek: thisWeekCount,
    dimensions: dimensions.map((d) => ({ dimension: d.dimension, cohorts: d.cohorts.length })),
    docUrl,
    emailSent,
  };
  log.info('Flow 7 learnings digest complete', { ...summary });
  return summary;
}
