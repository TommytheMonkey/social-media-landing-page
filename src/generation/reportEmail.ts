// Build the weekly Social Marketing Report as an email-safe HTML document.
// Numbers come pre-computed from Flow 7; prose comes from generation/learnings.
// Charts are QuickChart <img> URLs. Styling is inline (email clients strip <style>).

import type { LearningsProse } from './learnings';
import { barChartUrl, lineChartUrl } from '../lib/charts';
import { BRAND } from '../config/report';

export interface ReportKpis {
  weekEnding: string;
  posts: number;
  reach: number;
  impressions: number;
  engagement: number;
  /** % change vs the prior week, or null when there's no prior week. */
  deltas: { reach: number | null; impressions: number | null; engagement: number | null };
}
export interface WeeklyPoint {
  week: string;
  engagement: number;
  reach: number;
  posts: number;
}
export interface CohortBar {
  name: string;
  n: number;
  avgEngagement: number;
}
export interface DimensionChart {
  label: string;
  cohorts: CohortBar[];
}
export interface TopPost {
  name: string;
  platform: string;
  engagement: number;
  reach: number | null;
}
export interface ReportData {
  kpis: ReportKpis;
  weekly: WeeklyPoint[];
  dimensionCharts: DimensionChart[];
  topPosts: TopPost[];
  bottomPosts: TopPost[];
  docUrl: string;
  boardUrl: string;
}

const FONT = "Arial, Helvetica, 'Segoe UI', sans-serif";

function esc(s: string): string {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}
function nfmt(n: number): string {
  return Math.round(n).toLocaleString('en-US');
}
function deltaBadge(pct: number | null): string {
  if (pct == null) return `<span style="color:#7e8c84;font-size:12px">— vs last wk</span>`;
  const up = pct >= 0;
  const arrow = up ? '▲' : '▼';
  const color = up ? '#1c7a45' : '#b23b2e';
  return `<span style="color:${color};font-size:12px;font-weight:700">${arrow} ${Math.abs(Math.round(pct))}% vs last wk</span>`;
}

function kpiCard(label: string, value: string, delta: string): string {
  return `<td style="padding:6px;width:25%;vertical-align:top">
    <div style="background:${BRAND.concrete};border-radius:10px;padding:14px 12px;text-align:center">
      <div style="font-size:11px;letter-spacing:.08em;text-transform:uppercase;color:#7e8c84;font-weight:700">${esc(label)}</div>
      <div style="font-size:26px;font-weight:800;color:${BRAND.jungle};margin:4px 0">${esc(value)}</div>
      <div>${delta}</div>
    </div></td>`;
}

function sectionHeading(text: string): string {
  return `<h2 style="font-size:18px;font-weight:800;color:${BRAND.jungle};text-transform:uppercase;letter-spacing:-.01em;margin:30px 0 10px">${esc(text)}</h2>`;
}
function paragraphs(text: string): string {
  return esc(text)
    .split(/\n{2,}/)
    .map((p) => `<p style="font-size:14px;line-height:1.6;color:${BRAND.ink};margin:0 0 10px">${p.replace(/\n/g, '<br/>')}</p>`)
    .join('');
}
function chartImg(url: string): string {
  return `<div style="margin:10px 0 4px"><img src="${esc(url)}" width="600" alt="chart" style="width:100%;max-width:600px;height:auto;border-radius:10px;border:1px solid #e2e6e4"/></div>`;
}

function postsTable(title: string, posts: TopPost[]): string {
  if (!posts.length) return '';
  const rows = posts
    .map(
      (p) => `<tr>
        <td style="padding:8px 10px;font-size:13px;color:${BRAND.black};border-bottom:1px solid #eef0ef">${esc(p.name)}<span style="color:#7e8c84"> · ${esc(p.platform)}</span></td>
        <td style="padding:8px 10px;font-size:13px;color:${BRAND.black};border-bottom:1px solid #eef0ef;text-align:right;white-space:nowrap">${nfmt(p.engagement)} eng${p.reach != null ? ` · ${nfmt(p.reach)} reach` : ''}</td>
      </tr>`,
    )
    .join('');
  return `<div style="font-size:13px;font-weight:700;color:${BRAND.ink};margin:8px 0 4px">${esc(title)}</div>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;background:#fff;border:1px solid #eef0ef;border-radius:8px">${rows}</table>`;
}

export function buildReportHtml(data: ReportData, prose: LearningsProse): string {
  const { kpis } = data;

  // --- charts ---
  const trend = data.weekly.length
    ? chartImg(
        lineChartUrl(
          'Weekly engagement & reach',
          data.weekly.map((w) => w.week),
          [
            { label: 'Engagement', data: data.weekly.map((w) => w.engagement) },
            { label: 'Reach', data: data.weekly.map((w) => w.reach) },
          ],
        ),
      )
    : '';
  const dimCharts = data.dimensionCharts
    .filter((d) => d.cohorts.length)
    .map((d) =>
      chartImg(
        barChartUrl(
          `Avg engagement by ${d.label}`,
          d.cohorts.map((c) => `${c.name} (n=${c.n})`),
          [{ label: 'Avg engagement', data: d.cohorts.map((c) => c.avgEngagement) }],
        ),
      ),
    )
    .join('');

  // --- proposed style-guide edits ---
  const edits = prose.proposedStyleGuideEdits.length
    ? prose.proposedStyleGuideEdits
        .map(
          (e) => `<div style="background:${BRAND.concrete};border-left:4px solid ${BRAND.banana};border-radius:6px;padding:12px 14px;margin:0 0 10px">
            <div style="font-size:14px;font-weight:800;color:${BRAND.jungle}">${esc(e.title)}</div>
            <div style="font-size:13.5px;color:${BRAND.black};margin:5px 0 6px"><em>Add to style guide:</em> “${esc(e.edit)}”</div>
            <div style="font-size:12.5px;color:#6b7a72">${esc(e.rationale)}</div>
          </div>`,
        )
        .join('')
    : `<p style="font-size:14px;color:${BRAND.ink}">Nothing clears the bar this week — holding the guide as-is.</p>`;

  // --- human decisions ---
  const decisions = prose.humanDecisions.length
    ? prose.humanDecisions
        .map(
          (d) => `<div style="border:1px solid #e2e6e4;border-radius:8px;padding:12px 14px;margin:0 0 10px">
            <div style="font-size:11px;letter-spacing:.08em;text-transform:uppercase;color:#9a8f00;font-weight:800">${esc(d.area)}</div>
            <div style="font-size:14px;font-weight:700;color:${BRAND.black};margin:3px 0 5px">${esc(d.recommendation)}</div>
            <div style="font-size:12.5px;color:#6b7a72">${esc(d.rationale)}</div>
          </div>`,
        )
        .join('')
    : `<p style="font-size:14px;color:${BRAND.ink}">No founder-level calls flagged this week.</p>`;

  return `<!DOCTYPE html><html><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/></head>
<body style="margin:0;padding:0;background:#eef0ef;font-family:${FONT}">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#eef0ef;padding:20px 0">
    <tr><td align="center">
      <table role="presentation" width="640" cellpadding="0" cellspacing="0" style="width:640px;max-width:96%;background:#fff;border-radius:14px;overflow:hidden">

        <!-- header -->
        <tr><td style="background:${BRAND.jungle};padding:24px 28px">
          <div style="color:${BRAND.banana};font-size:12px;letter-spacing:.16em;text-transform:uppercase;font-weight:700">Takeoff Monkey · Weekly Report</div>
          <div style="color:#fff;font-size:24px;font-weight:800;text-transform:uppercase;margin-top:6px">Social Marketing Report</div>
          <div style="color:#cfe3d6;font-size:13px;margin-top:4px">Week ending ${esc(kpis.weekEnding)}</div>
        </td></tr>

        <tr><td style="padding:22px 28px">

          ${sectionHeading('The week at a glance')}
          ${paragraphs(prose.execSummary)}
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:8px 0 4px"><tr>
            ${kpiCard('Posts', nfmt(kpis.posts), `<span style="color:#7e8c84;font-size:12px">this week</span>`)}
            ${kpiCard('Reach', nfmt(kpis.reach), deltaBadge(kpis.deltas.reach))}
            ${kpiCard('Impressions', nfmt(kpis.impressions), deltaBadge(kpis.deltas.impressions))}
            ${kpiCard('Engagement', nfmt(kpis.engagement), deltaBadge(kpis.deltas.engagement))}
          </tr></table>
          ${trend}

          ${sectionHeading("What's working")}
          ${paragraphs(prose.whatsWorking)}
          ${dimCharts}

          ${data.topPosts.length || data.bottomPosts.length ? sectionHeading('Top & bottom posts') : ''}
          ${postsTable('Top performers', data.topPosts)}
          <div style="height:10px"></div>
          ${postsTable('Lagging', data.bottomPosts)}

          ${sectionHeading("Changes I'm proposing (style guide)")}
          <p style="font-size:12.5px;color:#7e8c84;margin:0 0 10px">In-our-lane execution tweaks. Advisory — apply the ones you agree with to the style guide.</p>
          ${edits}

          ${sectionHeading('Your call (founder decisions)')}
          <p style="font-size:12.5px;color:#7e8c84;margin:0 0 10px">Outside the system's lane — topics, voice, platform, cadence. These are yours to decide.</p>
          ${decisions}

          ${sectionHeading('Multi-week patterns')}
          ${paragraphs(prose.multiWeekPatterns)}

        </td></tr>

        <!-- footer -->
        <tr><td style="background:${BRAND.concrete};padding:18px 28px;border-top:1px solid #e2e6e4">
          <div style="font-size:12.5px;color:#6b7a72;line-height:1.6">
            <a href="${esc(data.docUrl)}" style="color:${BRAND.jungle};font-weight:700">Rolling learnings doc</a> ·
            <a href="${esc(data.boardUrl)}" style="color:${BRAND.jungle};font-weight:700">Content board</a><br/>
            Auto-generated from Buffer metrics on the Monday board. All figures cite their sample size; small-n cohorts are directional only. The style guide stays human-owned — nothing here is auto-applied.
          </div>
        </td></tr>

      </table>
    </td></tr>
  </table>
</body></html>`;
}
