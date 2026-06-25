// Live test of Flow 6 (post-metrics sync). Waits for the deploy, points a Monday
// test item at a REAL Buffer post that has metrics, triggers /api/cron/metrics, and
// asserts: present metrics are written; ABSENT metrics (shares/saves) are left
// untouched (MISSING != ZERO, incl. a pre-seeded saves=99 that must survive);
// metricsSyncedAt is recorded; an out-of-window item is ignored; and a second run
// skips on the freshness guard. Cleans up after. Usage: node scripts/test-metrics.mjs <sha>
import { readFileSync, existsSync } from 'node:fs';

const env = {};
if (existsSync('.env')) {
  for (const line of readFileSync('.env', 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/);
    if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
}
const vToken = env.VERCEL_TOKEN, mToken = env.MONDAY_API_TOKEN, secret = env.CRON_SECRET, bKey = env.BUFFER_API_KEY;
const SHA = process.argv[2] || '';
const BOARD = '18411954205';
// A real sent post with rich, non-zero metrics on the connected LinkedIn channel.
const BUFFER_POST_ID = process.argv[3] || '6a3bea6017e8f55b2a2d1f89';

// Column ids (mirror src/config/board.ts).
const C = {
  status: 'status', platform: 'dropdown_mm33c63g', voice: 'color_mm4m94nw', postDate: 'date_mm33qjbw',
  reach: 'numeric_mm4nx20v', comments: 'numeric_mm4n1bnd', reactions: 'numeric_mm4nfqmk',
  shares: 'numeric_mm4n3xx3', saves: 'numeric_mm4ny7ja', impressions: 'numeric_mm4nbe6q', syncedAt: 'text_mm4nmp17',
};
const METRIC_COLS = [C.reach, C.comments, C.reactions, C.shares, C.saves, C.impressions, C.syncedAt];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const fmtET = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' });
const todayET = fmtET.format(new Date());
const oldET = fmtET.format(new Date(Date.now() - 30 * 86400000));

async function vapi(p) { return (await fetch('https://api.vercel.com' + p, { headers: { Authorization: `Bearer ${vToken}` } })).json(); }
async function mgql(query, variables) {
  const res = await fetch('https://api.monday.com/v2', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: mToken, 'API-Version': '2026-04' }, body: JSON.stringify({ query, variables }) });
  const b = await res.json(); if (b.errors) throw new Error(JSON.stringify(b.errors)); return b.data;
}
async function bgql(query, variables) {
  const res = await fetch('https://api.buffer.com', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${bKey}` }, body: JSON.stringify({ query, variables }) });
  const b = await res.json(); if (b.errors) throw new Error(JSON.stringify(b.errors)); return b.data;
}
async function createItem(name, vals) {
  const d = await mgql(`mutation ($b: ID!, $n: String!, $v: JSON!) { create_item(board_id: $b, item_name: $n, column_values: $v, create_labels_if_missing: true) { id } }`, { b: BOARD, n: name, v: JSON.stringify(vals) });
  return d.create_item.id;
}
async function addMarker(itemId, postId) {
  await mgql(`mutation ($id: ID!, $body: String!) { create_update(item_id: $id, body: $body) { id } }`, { id: itemId, body: `✅ Sent to Buffer\nbuffer-post-id:${postId} (channel test)` });
}
async function readCols(ids, cols) {
  const d = await mgql(`query ($ids: [ID!], $c: [String!]) { items(ids: $ids) { id name column_values(ids: $c) { id text } } }`, { ids, c: cols });
  return d.items;
}
const col = (it, id) => it.column_values.find((c) => c.id === id)?.text ?? '';
const num = (it, id) => { const t = col(it, id); return t === '' ? null : parseFloat(t.replace(/,/g, '')); };

async function trigger() {
  const ctrl = new AbortController(); const t = setTimeout(() => ctrl.abort(), 110000);
  const resp = await fetch('https://letsgo.takeo.co/api/cron/metrics', { headers: { Authorization: `Bearer ${secret}` }, signal: ctrl.signal });
  clearTimeout(t); return JSON.parse(await resp.text());
}

const results = [];
const check = (name, pass, extra = '') => { results.push({ name, pass }); console.log(`  ${pass ? '✅' : '❌'} ${name}${extra ? ' — ' + extra : ''}`); };

// --- wait for deploy ---
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

// --- expected metrics straight from Buffer ---
const bp = (await bgql(`query ($input: PostInput!) { post(input: $input) { id metricsUpdatedAt metrics { type value unit } } }`, { input: { id: BUFFER_POST_ID } })).post;
const expected = {}; for (const m of bp.metrics || []) expected[m.type] = m.value;
console.log(`\nBuffer post ${BUFFER_POST_ID}: metricsUpdatedAt=${bp.metricsUpdatedAt}`);
console.log(`  metrics: ${(bp.metrics || []).map((m) => m.type + '=' + m.value).join(', ')}`);
const present = (t) => Object.prototype.hasOwnProperty.call(expected, t);

const cleanup = [];
try {
  // in-window Live LinkedIn item, with saves pre-seeded to 99 (must survive — absent metric).
  const inWin = await createItem('METRICS-TEST in-window', {
    [C.status]: { label: 'Live!' }, [C.platform]: { labels: ['LinkedIn'] }, [C.voice]: { label: 'Tommy' },
    [C.postDate]: { date: todayET }, [C.saves]: '99',
  });
  // out-of-window Live LinkedIn item (Post Date 30d ago) — must be ignored entirely.
  const outWin = await createItem('METRICS-TEST out-of-window', {
    [C.status]: { label: 'Live!' }, [C.platform]: { labels: ['LinkedIn'] }, [C.voice]: { label: 'Tommy' },
    [C.postDate]: { date: oldET },
  });
  cleanup.push(inWin, outWin);
  await addMarker(inWin, BUFFER_POST_ID);
  await addMarker(outWin, BUFFER_POST_ID);
  console.log(`\ncreated in-window=${inWin} (Post Date ${todayET}), out-of-window=${outWin} (Post Date ${oldET})`);

  console.log('\n=== RUN 1 ===');
  const s1 = await trigger();
  console.log('summary:', JSON.stringify(s1));

  const [iw] = await readCols([inWin], METRIC_COLS);
  console.log('\nin-window columns after run 1:');
  for (const id of METRIC_COLS) console.log(`  ${id} = ${col(iw, id) || '(empty)'}`);

  // Present metrics written & match Buffer.
  for (const [type, cid] of [['reach', C.reach], ['comments', C.comments], ['reactions', C.reactions], ['impressions', C.impressions]]) {
    if (present(type)) check(`${type} written = ${expected[type]}`, num(iw, cid) === expected[type], `got ${col(iw, cid) || '(empty)'}`);
    else check(`${type} present in Buffer (test precondition)`, false, 'absent — pick a richer post');
  }
  // Absent metrics: shares untouched (empty), saves keeps pre-seeded 99 (MISSING != ZERO).
  check('shares absent from Buffer', !present('shares'), present('shares') ? 'unexpectedly present' : '');
  check('shares column left empty (not 0)', col(iw, C.shares) === '', `got ${col(iw, C.shares)}`);
  check('saves absent from Buffer', !present('saves'), present('saves') ? 'unexpectedly present' : '');
  check('saves pre-seed 99 NOT overwritten with 0', num(iw, C.saves) === 99, `got ${col(iw, C.saves)}`);
  // Freshness marker recorded.
  check('metricsSyncedAt == Buffer metricsUpdatedAt', col(iw, C.syncedAt) === bp.metricsUpdatedAt, `got ${col(iw, C.syncedAt)}`);

  // Out-of-window item ignored entirely.
  const [ow] = await readCols([outWin], METRIC_COLS);
  const owTouched = METRIC_COLS.some((id) => col(ow, id) !== '');
  check('out-of-window item left untouched', !owTouched, owTouched ? 'columns were written' : '');

  console.log('\n=== RUN 2 (freshness) ===');
  const s2 = await trigger();
  console.log('summary:', JSON.stringify(s2));
  const [iw2] = await readCols([inWin], METRIC_COLS);
  check('run 2 skips on freshness (skippedUnchanged >= 1)', (s2.skippedUnchanged || 0) >= 1, `skippedUnchanged=${s2.skippedUnchanged}`);
  check('in-window columns unchanged after run 2', METRIC_COLS.every((id) => col(iw2, id) === col(iw, id)));
} finally {
  console.log('\n=== cleanup ===');
  for (const id of cleanup) { try { await mgql(`mutation ($id: ID!) { delete_item(item_id: $id) { id } }`, { id }); } catch {} }
  console.log(`deleted ${cleanup.length} item(s)`);
  const passed = results.filter((r) => r.pass).length;
  console.log(`\n=== RESULT: ${passed}/${results.length} checks passed ===`);
  if (passed !== results.length) process.exitCode = 1;
}
