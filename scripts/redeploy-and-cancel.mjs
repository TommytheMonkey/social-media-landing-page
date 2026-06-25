// Waits for a deploy (SHA) to be READY, sets Post Trigger="CANCEL!" on the given
// items (creating the label if needed), triggers the poll, and reports results.
// Usage: node scripts/redeploy-and-cancel.mjs <sha> <itemId> [itemId ...]
import { readFileSync, existsSync } from 'node:fs';

const env = {};
if (existsSync('.env')) {
  for (const line of readFileSync('.env', 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/);
    if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
}
const vToken = env.VERCEL_TOKEN;
const mToken = env.MONDAY_API_TOKEN;
const secret = env.CRON_SECRET;
const SHA = process.argv[2];
const ITEMS = process.argv.slice(3);
const BOARD = '18411954205';
const PROD = 'https://letsgo.takeo.co/api/cron/poll';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function vapi(p) {
  return (await fetch('https://api.vercel.com' + p, { headers: { Authorization: `Bearer ${vToken}` } })).json();
}
async function mgql(query, variables) {
  const res = await fetch('https://api.monday.com/v2', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: mToken, 'API-Version': '2026-04' },
    body: JSON.stringify({ query, variables }),
  });
  const b = await res.json();
  if (b.errors) throw new Error(JSON.stringify(b.errors));
  return b.data;
}

const teams = (await vapi('/v2/teams')).teams || [];
const teamId = (teams.find((t) => t.slug === 'takeoff-monkey') || teams[0])?.id;

let ready = false;
for (let i = 0; i < 30; i++) {
  const list = (await vapi(`/v6/deployments?app=social-media-landing-page&target=production&limit=10&teamId=${teamId}`)).deployments || [];
  const d = SHA ? list.find((x) => x.meta?.githubCommitSha === SHA) : list[0];
  const state = d?.readyState || d?.state || 'none';
  console.log(`deploy poll ${i + 1}: ${state}`);
  if (state === 'READY') { ready = true; break; }
  if (state === 'ERROR') { console.log('DEPLOY FAILED'); process.exit(1); }
  await sleep(10000);
}
if (!ready) { console.log('deploy not READY in time'); process.exit(1); }

// Set Post Trigger = CANCEL! on each item (create the label if it doesn't exist).
for (const id of ITEMS) {
  await mgql(
    `mutation ($b: ID!, $i: ID!, $v: JSON!) { change_multiple_column_values(board_id: $b, item_id: $i, column_values: $v, create_labels_if_missing: true) { id } }`,
    { b: BOARD, i: id, v: JSON.stringify({ color_mm4meks3: { label: 'CANCEL!' } }) },
  );
}
console.log(`set Post Trigger=CANCEL! on ${ITEMS.length} item(s)`);

const ctrl = new AbortController();
const t = setTimeout(() => ctrl.abort(), 110000);
const resp = await fetch(PROD, { headers: { Authorization: `Bearer ${secret}` }, signal: ctrl.signal });
clearTimeout(t);
console.log('trigger response:', await resp.text());

for (const id of ITEMS) {
  const data = await mgql(
    `query ($ids: [ID!]) { items(ids: $ids) { name column_values(ids: ["status","color_mm4meks3"]) { id text } updates(limit: 1) { body } } }`,
    { ids: [id] },
  );
  const it = data.items[0];
  const col = (cid) => it.column_values.find((c) => c.id === cid)?.text;
  console.log(`\n=== ${it.name} ===`);
  console.log(`  Status: ${col('status')}   Post Trigger: ${col('color_mm4meks3') || '(empty)'}`);
  console.log(`  Latest update: ${(it.updates[0]?.body || '').replace(/<[^>]+>/g, '').slice(0, 120)}`);
}
