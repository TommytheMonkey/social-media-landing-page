// Live test of the newsletter flow: waits for the deploy, creates 2 source posts
// tagged Create Newsletter!, triggers /api/cron/newsletter, verifies the assembled
// item + that sources were marked, then cleans up. Usage: node scripts/test-newsletter.mjs <sha>
import { readFileSync, existsSync } from 'node:fs';
import { google } from 'googleapis';

const env = {};
if (existsSync('.env')) {
  for (const line of readFileSync('.env', 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/);
    if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
}
const vToken = env.VERCEL_TOKEN, mToken = env.MONDAY_API_TOKEN, secret = env.CRON_SECRET;
const SHA = process.argv[2] || '';
const BOARD = '18411954205';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function vapi(p) { return (await fetch('https://api.vercel.com' + p, { headers: { Authorization: `Bearer ${vToken}` } })).json(); }
async function mgql(query, variables) {
  const res = await fetch('https://api.monday.com/v2', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: mToken, 'API-Version': '2026-04' }, body: JSON.stringify({ query, variables }) });
  const b = await res.json(); if (b.errors) throw new Error(JSON.stringify(b.errors)); return b.data;
}
async function createItem(name, vals) {
  const d = await mgql(`mutation ($b: ID!, $n: String!, $v: JSON!) { create_item(board_id: $b, item_name: $n, column_values: $v, create_labels_if_missing: true) { id } }`, { b: BOARD, n: name, v: JSON.stringify(vals) });
  return d.create_item.id;
}
async function readCols(ids, cols) {
  const d = await mgql(`query ($ids: [ID!], $c: [String!]) { items(ids: $ids) { id name column_values(ids: $c) { id text value } } }`, { ids, c: cols });
  return d.items;
}
const col = (it, id) => it.column_values.find((c) => c.id === id)?.text;

const teams = (await vapi('/v2/teams')).teams || [];
const teamId = (teams.find((t) => t.slug === 'takeoff-monkey') || teams[0])?.id;
let ready = false;
for (let i = 0; i < 30; i++) {
  const list = (await vapi(`/v6/deployments?app=social-media-landing-page&target=production&limit=10&teamId=${teamId}`)).deployments || [];
  const d = SHA ? list.find((x) => x.meta?.githubCommitSha === SHA) : list[0];
  const st = d?.readyState || d?.state || 'none';
  console.log(`deploy poll ${i + 1}: ${st}`);
  if (st === 'READY') { ready = true; break; }
  if (st === 'ERROR') { console.log('DEPLOY FAILED'); process.exit(1); }
  await sleep(10000);
}
if (!ready) { console.log('deploy not ready'); process.exit(1); }

const cleanup = [];
let newsletterId, folderId;
try {
  // 2 source posts tagged Create Newsletter! with content pre-filled.
  const s1 = await createItem('NL-SOURCE phone tape measure', {
    text_mm4mvtmr: 'idea', long_text_mm4mh8gr: { text: 'Your iPhone Measure app gives a rough pad width on a graded lot. Fine for "about 40 foot," not a cut list. — Tommy' },
    color_mm4m94nw: { label: 'Tommy' }, dropdown_mm33c63g: { labels: ['LinkedIn'] }, color_mm4mbf7j: { label: 'Create Newsletter!' }, link_mm4mdabt: { url: 'https://support.apple.com', text: 'Measure' },
  });
  const s2 = await createItem('NL-SOURCE redline a plan sheet', {
    text_mm4mvtmr: 'idea', long_text_mm4mh8gr: { text: 'Mark up a PDF plan sheet in Adobe Acrobat Reader from your phone — circle a conflict, send it back. Not a replacement for real plan software. — Tommy' },
    color_mm4m94nw: { label: 'Tommy' }, dropdown_mm33c63g: { labels: ['LinkedIn'] }, color_mm4mbf7j: { label: 'Create Newsletter!' },
  });
  cleanup.push(s1, s2);
  console.log(`created sources ${s1}, ${s2}; triggering newsletter cron...`);

  const ctrl = new AbortController(); const t = setTimeout(() => ctrl.abort(), 110000);
  const resp = await fetch('https://letsgo.takeo.co/api/cron/newsletter', { headers: { Authorization: `Bearer ${secret}` }, signal: ctrl.signal });
  clearTimeout(t);
  const body = await resp.text();
  console.log('trigger response:', body);
  try { newsletterId = JSON.parse(body).itemId; } catch {}

  if (newsletterId) {
    cleanup.push(newsletterId);
    const [nl] = await readCols([newsletterId], ['dropdown_mm33c63g', 'color_mm4m94nw', 'status', 'color_mm4mbf7j', 'color_mm4meks3', 'date_mm33qjbw', 'long_text_mm4mh8gr', 'numeric_mm4n5xpx', 'link_mm4j5agh']);
    try { folderId = JSON.parse(nl.column_values.find((c) => c.id === 'link_mm4j5agh')?.value || '{}').url?.split('/folders/')[1]; } catch {}
    console.log(`\n=== NEWSLETTER ITEM: ${nl.name} ===`);
    console.log(`  Platform=${col(nl, 'dropdown_mm33c63g')} Voice=${col(nl, 'color_mm4m94nw')} Status=${col(nl, 'status')}`);
    console.log(`  CreationTrigger=${col(nl, 'color_mm4mbf7j')} PostTrigger=${col(nl, 'color_mm4meks3')} PostDate=${col(nl, 'date_mm33qjbw')}`);
    console.log(`  Content=${(col(nl, 'long_text_mm4mh8gr') || '').length}c WordCt=${col(nl, 'numeric_mm4n5xpx')} Folder=${folderId ? 'yes' : 'NO'}`);
  }

  const srcs = await readCols([s1, s2], ['boolean_mm4mh94v', 'color_mm4mbf7j']);
  console.log('\n=== SOURCES (expect Newsletter checked + trigger cleared) ===');
  for (const s of srcs) {
    let checked = false; try { checked = JSON.parse(s.column_values.find((c) => c.id === 'boolean_mm4mh94v')?.value || '{}').checked === true; } catch {}
    console.log(`  ${s.name}: NewsletterChecked=${checked} CreationTrigger=${col(s, 'color_mm4mbf7j') || '(empty)'}`);
  }
} finally {
  console.log('\n=== cleanup ===');
  for (const id of cleanup) { try { await mgql(`mutation ($id: ID!) { delete_item(item_id: $id) { id } }`, { id }); } catch {} }
  console.log(`deleted ${cleanup.length} item(s)`);
  if (folderId) {
    const creds = (() => { const raw = env.GOOGLE_SERVICE_ACCOUNT_JSON; return JSON.parse(raw.trim().startsWith('{') ? raw : Buffer.from(raw, 'base64').toString('utf8')); })();
    const auth = new google.auth.JWT({ email: creds.client_email, key: creds.private_key, scopes: ['https://www.googleapis.com/auth/drive'] });
    try { await google.drive({ version: 'v3', auth }).files.update({ fileId: folderId, requestBody: { trashed: true }, supportsAllDrives: true }); console.log('trashed newsletter folder'); } catch {}
  }
}
