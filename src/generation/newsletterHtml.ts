// Build the weekly newsletter as an email-safe HTML document from the edited
// plain-text Google Doc. Deterministic + on-brand: same styling engine as the
// weekly report email (inline CSS, brand palette). [IMG - img_n] placeholders in
// the text are swapped for the curated images (public Blob URLs).

import { BRAND } from '../config/report';

// Montserrat is the brand font; email clients that can't load it fall back to Arial.
const FONT = "'Montserrat', Arial, Helvetica, 'Segoe UI', sans-serif";

const IMG_PLACEHOLDER_RE = /\[IMG\s*-\s*([a-zA-Z0-9_.-]+)\]/g;

export interface NewsletterHtmlOptions {
  title: string;
  /** Real subscribe URL for the CTA button. */
  subscribeUrl: string;
  /** Base-filename ("img_1") -> public image URL for the curated images. */
  imageUrls: Record<string, string>;
  /** Public URL of the white logo (hosted on Blob), or null for a text-only header. */
  logoUrl?: string | null;
  /** Small kicker shown above the title, e.g. "Week of 2026-07-03". */
  dateLabel?: string | null;
}

function esc(s: string): string {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}

/** Base filename without extension, lowercased — used to match placeholders to images. */
function normKey(name: string): string {
  return name.replace(/\.[a-zA-Z0-9]+$/, '').trim().toLowerCase();
}

/** Inline formatting for a run of text: escape, bold, and single newlines -> <br/>. */
function inline(text: string): string {
  return esc(text)
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/\n/g, '<br/>');
}

function imageBlock(url: string): string {
  return `<div style="margin:18px 0"><img src="${esc(url)}" width="584" alt="" style="display:block;width:100%;max-width:584px;height:auto;border-radius:10px;border:1px solid #e2e6e4"/></div>`;
}

/** Render a run of plain text (no image placeholders) into heading/paragraph blocks. */
function renderTextRun(text: string): string {
  const blocks = text.split(/\n{2,}/).map((b) => b.trim()).filter((b) => b.length > 0);
  return blocks
    .map((block) => {
      const heading = block.match(/^(#{1,3})\s+(.*)$/);
      if (heading) {
        return `<h2 style="font-size:18px;font-weight:800;color:${BRAND.jungle};letter-spacing:-.01em;margin:26px 0 10px">${inline(heading[2]!)}</h2>`;
      }
      return `<p style="font-size:15px;line-height:1.65;color:${BRAND.ink};margin:0 0 14px">${inline(block)}</p>`;
    })
    .join('');
}

/** Turn the newsletter body (with [IMG - img_n] tokens) into styled HTML. */
function renderBody(text: string, imageUrls: Record<string, string>): string {
  const urlByKey: Record<string, string> = {};
  for (const [k, v] of Object.entries(imageUrls)) urlByKey[normKey(k)] = v;

  let html = '';
  let last = 0;
  let m: RegExpExecArray | null;
  IMG_PLACEHOLDER_RE.lastIndex = 0;
  while ((m = IMG_PLACEHOLDER_RE.exec(text)) !== null) {
    if (m.index > last) html += renderTextRun(text.slice(last, m.index));
    const url = urlByKey[normKey(m[1]!)];
    if (url) html += imageBlock(url); // unknown placeholder -> silently dropped
    last = IMG_PLACEHOLDER_RE.lastIndex;
  }
  if (last < text.length) html += renderTextRun(text.slice(last));
  return html;
}

export function buildNewsletterHtml(text: string, opts: NewsletterHtmlOptions): string {
  const body = renderBody(text, opts.imageUrls);

  const logo = opts.logoUrl
    ? `<img src="${esc(opts.logoUrl)}" width="150" alt="Takeoff Monkey" style="display:block;width:150px;max-width:60%;height:auto"/>`
    : `<div style="color:#fff;font-size:22px;font-weight:800;text-transform:uppercase">Takeoff Monkey</div>`;

  const kicker = opts.dateLabel
    ? `<div style="color:${BRAND.banana};font-size:12px;letter-spacing:.16em;text-transform:uppercase;font-weight:700;margin-top:14px">${esc(opts.dateLabel)}</div>`
    : '';

  return `<!DOCTYPE html><html><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>${esc(opts.title)}</title></head>
<body style="margin:0;padding:0;background:#eef0ef;font-family:${FONT}">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#eef0ef;padding:20px 0">
    <tr><td align="center">
      <table role="presentation" width="640" cellpadding="0" cellspacing="0" style="width:640px;max-width:96%;background:#fff;border-radius:14px;overflow:hidden">

        <!-- header -->
        <tr><td style="background:${BRAND.jungle};padding:26px 28px">
          ${logo}
          ${kicker}
          <div style="color:#fff;font-size:24px;font-weight:800;margin-top:6px">${esc(opts.title)}</div>
          <div style="height:4px;width:64px;background:${BRAND.banana};border-radius:3px;margin-top:12px"></div>
        </td></tr>

        <!-- body -->
        <tr><td style="padding:24px 28px">
          ${body}

          <div style="text-align:center;margin:26px 0 6px">
            <a href="${esc(opts.subscribeUrl)}" style="display:inline-block;background:${BRAND.banana};color:${BRAND.jungle};font-size:15px;font-weight:800;text-decoration:none;padding:13px 26px;border-radius:8px">Subscribe to the newsletter →</a>
          </div>
        </td></tr>

        <!-- footer -->
        <tr><td style="background:${BRAND.concrete};padding:18px 28px;border-top:1px solid #e2e6e4">
          <div style="font-size:12.5px;color:#6b7a72;line-height:1.6">
            Takeoff Monkey — everyday tech &amp; AI for commercial sitework contractors.<br/>
            <a href="${esc(opts.subscribeUrl)}" style="color:${BRAND.jungle};font-weight:700">${esc(opts.subscribeUrl.replace(/^https?:\/\//, ''))}</a>
          </div>
        </td></tr>

      </table>
    </td></tr>
  </table>
</body></html>`;
}
