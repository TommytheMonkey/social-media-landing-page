// Post-fix regression: waits for the deploy, then exercises the core path AND the
// two scariest fixes. Cleans up after itself. Usage: node scripts/regression-test.mjs <sha>
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
const PROD = 'https://letsgo.takeo.co/api/cron/poll';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function vapi(p) { return (await fetch('https://api.vercel.com' + p, { headers: { Authorization: `Bearer ${vToken}` } })).json(); }
async function mgql(query, variables) {
  const res = await fetch('https://api.monday.com/v2', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: mToken, 'API-Version': '2026-04' }, body: JSON.stringify({ query, variables }) });
  const b = await res.json(); if (b.errors) throw new Error(JSON.stringify(b.errors)); return b.data;
}
async function trigger() {
  const ctrl = new AbortController(); const t = setTimeout(() => ctrl.abort(), 110000);
  const r = await fetch(PROD, { headers: { Authorization: `Bearer ${secret}` }, signal: ctrl.signal }); clearTimeout(t);
  return r.text();
}
async function createItem(name, vals) {
  const d = await mgql(`mutation ($b: ID!, $n: String!, $v: JSON!) { create_item(board_id: $b, item_name: $n, column_values: $v) { id } }`, { b: BOARD, n: name, v: JSON.stringify(vals) });
  return d.create_item.id;
}
async function setCols(id, vals) {
  await mgql(`mutation ($b: ID!, $i: ID!, $v: JSON!) { change_multiple_column_values(board_id: $b, item_id: $i, column_values: $v, create_labels_if_missing: true) { id } }`, { b: BOARD, i: id, v: JSON.stringify(vals) });
}
async function readCols(ids, cols) {
  const d = await mgql(`query ($ids: [ID!], $c: [String!]) { items(ids: $ids) { id name column_values(ids: $c) { id text value } } }`, { ids, c: cols });
  return d.items;
}
function fileCount(item) { try { return (JSON.parse(item.column_values.find(c => c.id === 'file_mm33j0pd')?.value || '{}').files || []).length; } catch { return 0; } }
function col(item, id) { return item.column_values.find(c => c.id === id)?.text; }

// wait for deploy
const teams = (await vapi('/v2/teams')).teams || [];
const teamId = (teams.find(t => t.slug === 'takeoff-monkey') || teams[0])?.id;
let ready = false;
for (let i = 0; i < 30; i++) {
  const list = (await vapi(`/v6/deployments?app=social-media-landing-page&target=production&limit=10&teamId=${teamId}`)).deployments || [];
  const d = SHA ? list.find(x => x.meta?.githubCommitSha === SHA) : list[0];
  const st = d?.readyState || d?.state || 'none';
  console.log(`deploy poll ${i + 1}: ${st}`);
  if (st === 'READY') { ready = true; break; }
  if (st === 'ERROR') { console.log('DEPLOY FAILED'); process.exit(1); }
  await sleep(10000);
}
if (!ready) { console.log('deploy not ready'); process.exit(1); }

const cleanup = { items: [], folders: [] };
const RCOLS = ['status', 'color_mm4meks3', 'color_mm4mbf7j', 'dropdown_mm33c63g', 'long_text_mm4mh8gr', 'numeric_mm4nh9r1', 'link_mm4j5agh', 'file_mm33j0pd'];

try {
  // ---- PART A: single-platform create -> schedule -> cancel ----
  console.log('\n===== PART A: single-platform full cycle =====');
  const aId = await createItem('REGRESSION single - timekeeping app tip', {
    text_mm4mvtmr: 'Quick tip on logging field hours from a phone instead of paper timesheets. Honest about sync/offline limits.',
    color_mm4m94nw: { label: 'Takeoff Monkey' }, dropdown_mm33c63g: { labels: ['LinkedIn'] }, color_mm4mbf7j: { label: 'Create Post!' },
  });
  cleanup.items.push(aId);
  console.log(`created ${aId}; triggering Flow 1...`);
  console.log('  Flow1:', await trigger());
  let a = (await readCols([aId], RCOLS))[0];
  const aFolder = (() => { try { return JSON.parse(a.column_values.find(c => c.id === 'link_mm4j5agh')?.value || '{}').url || ''; } catch { return ''; } })();
  if (aFolder) cleanup.folders.push(aFolder.split('/folders/')[1]);
  console.log(`  after Flow1: Status=${col(a, 'status')} Trigger(creation)=${col(a, 'color_mm4mbf7j')} images=${fileCount(a)} folder=${aFolder ? 'yes' : 'NO'}`);

  await setCols(aId, { date_mm33qjbw: { date: '2026-12-28' }, color_mm4meks3: { label: 'Clear!' } });
  console.log('  Flow2:', await trigger());
  a = (await readCols([aId], RCOLS))[0];
  console.log(`  after Flow2: Status=${col(a, 'status')} content=${(col(a, 'long_text_mm4mh8gr') || '').length}c wordct=${col(a, 'numeric_mm4nh9r1')}`);

  await setCols(aId, { color_mm4meks3: { label: 'CANCEL!' } });
  console.log('  Cancel:', await trigger());
  a = (await readCols([aId], RCOLS))[0];
  console.log(`  after Cancel: Status=${col(a, 'status')} PostTrigger=${col(a, 'color_mm4meks3') || '(empty)'}`);

  // ---- PART B: dual-platform Flow 1 -> each cell must have exactly 1 image ----
  console.log('\n===== PART B: dual-platform (image cross-contamination fix) =====');
  const bId = await createItem('REGRESSION dual - tablet plan viewer', {
    text_mm4mvtmr: 'Using a rugged tablet on site to view the latest plan set instead of carrying rolls. Honest about screen-size/markup limits.',
    color_mm4m94nw: { label: 'Takeoff Monkey' }, dropdown_mm33c63g: { labels: ['LinkedIn', 'Instagram'] }, color_mm4mbf7j: { label: 'Create Post!' },
  });
  cleanup.items.push(bId);
  console.log(`created ${bId} (LinkedIn+Instagram); triggering Flow 1...`);
  console.log('  Flow1:', await trigger());
  // find all items with this base title
  const all = await mgql(`query ($b: [ID!]) { boards(ids: $b) { items_page(limit: 200) { items { id name column_values(ids: ["dropdown_mm33c63g","file_mm33j0pd","link_mm4j5agh","status"]) { id text value } } } } }`, { b: [BOARD] });
  const cells = all.boards[0].items_page.items.filter(it => it.name.startsWith('REGRESSION dual - tablet plan viewer'));
  console.log(`  cells created: ${cells.length} (expect 2)`);
  for (const c of cells) {
    if (c.id !== bId) cleanup.items.push(c.id);
    const f = (() => { try { return JSON.parse(c.column_values.find(x => x.id === 'file_mm33j0pd')?.value || '{}').files || []; } catch { return []; } })();
    const folder = (() => { try { return JSON.parse(c.column_values.find(x => x.id === 'link_mm4j5agh')?.value || '{}').url || ''; } catch { return ''; } })();
    if (folder) cleanup.folders.push(folder.split('/folders/')[1]);
    const plat = c.column_values.find(x => x.id === 'dropdown_mm33c63g')?.text;
    console.log(`    [${plat}] images=${f.length} ${f.length === 1 ? 'OK' : 'BUG: expected exactly 1'}`);
  }
} finally {
  console.log('\n===== cleanup =====');
  for (const id of cleanup.items) { try { await mgql(`mutation ($id: ID!) { delete_item(item_id: $id) { id } }`, { id }); } catch {} }
  console.log(`deleted ${cleanup.items.length} item(s)`);
  if (cleanup.folders.length) {
    const creds = (() => { const raw = env.GOOGLE_SERVICE_ACCOUNT_JSON; return JSON.parse(raw.trim().startsWith('{') ? raw : Buffer.from(raw, 'base64').toString('utf8')); })();
    const auth = new google.auth.JWT({ email: creds.client_email, key: creds.private_key, scopes: ['https://www.googleapis.com/auth/drive'] });
    const drive = google.drive({ version: 'v3', auth });
    for (const fid of [...new Set(cleanup.folders)]) { try { await drive.files.update({ fileId: fid, requestBody: { trashed: true }, supportsAllDrives: true }); } catch {} }
    console.log(`trashed ${new Set(cleanup.folders).size} folder(s)`);
  }
}
