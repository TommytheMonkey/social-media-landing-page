// Chart images for the emailed report, via QuickChart (renders a Chart.js config
// to a PNG URL). Embedding <img src="quickchart.io/chart?c=..."> works in every
// email client — no client-side JS, no binary attachments, no heavy deps.

import { BRAND } from '../config/report';

const QC_BASE = 'https://quickchart.io/chart';

export interface ChartDataset {
  label: string;
  data: Array<number | null>;
  color?: string;
}

/** Build a QuickChart image URL from a Chart.js config object. */
export function quickChartUrl(
  config: Record<string, unknown>,
  opts: { width?: number; height?: number; bkg?: string } = {},
): string {
  const params = new URLSearchParams({
    c: JSON.stringify(config),
    w: String(opts.width ?? 600),
    h: String(opts.height ?? 300),
    bkg: opts.bkg ?? 'white',
    devicePixelRatio: '2', // crisp on retina mail clients
  });
  return `${QC_BASE}?${params.toString()}`;
}

const PALETTE = [BRAND.jungle, BRAND.bananaDeep, '#1c6b40', '#8aa597', BRAND.black, '#b9a800'];

const baseOptions = (title: string) => ({
  title: { display: Boolean(title), text: title, fontColor: BRAND.black, fontSize: 15, fontStyle: '700' },
  legend: { position: 'bottom', labels: { fontColor: BRAND.ink, fontSize: 11 } },
  scales: {
    xAxes: [{ gridLines: { display: false }, ticks: { fontColor: BRAND.ink, fontSize: 11 } }],
    yAxes: [{ ticks: { beginAtZero: true, fontColor: BRAND.ink, fontSize: 11 } }],
  },
});

/** Bar chart — single or grouped (one dataset per metric). */
export function barChartUrl(title: string, labels: string[], datasets: ChartDataset[], width = 600): string {
  const config = {
    type: 'bar',
    data: {
      labels,
      datasets: datasets.map((d, i) => ({
        label: d.label,
        data: d.data,
        backgroundColor: d.color ?? PALETTE[i % PALETTE.length],
        borderWidth: 0,
      })),
    },
    options: { ...baseOptions(title), legend: { display: datasets.length > 1, position: 'bottom', labels: { fontColor: BRAND.ink, fontSize: 11 } } },
  };
  return quickChartUrl(config, { width, height: 300 });
}

/** Line chart for week-over-week trends (one line per metric). */
export function lineChartUrl(title: string, labels: string[], datasets: ChartDataset[], width = 600): string {
  const config = {
    type: 'line',
    data: {
      labels,
      datasets: datasets.map((d, i) => {
        const c = d.color ?? PALETTE[i % PALETTE.length];
        return { label: d.label, data: d.data, borderColor: c, backgroundColor: c, fill: false, lineTension: 0.3, pointRadius: 3, borderWidth: 2 };
      }),
    },
    options: baseOptions(title),
  };
  return quickChartUrl(config, { width, height: 300 });
}
