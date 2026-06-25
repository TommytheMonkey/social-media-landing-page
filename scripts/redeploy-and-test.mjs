// Waits for the production deploy of a given commit SHA to be READY (Vercel API),
// resets the test item to Raw Draft, triggers Flow 2, and prints the result.
// Usage: node scripts/redeploy-and-test.mjs <commitSha>
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
const SHA = process.argv[2] || '';
const ITEM = '12368112898';
const BOARD = '18411954205';
const PROD = 'https://letsgo.takeo.co/api/cron/poll';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function vapi(path) {
  const res = await fetch('https://api.vercel.com' + path, { headers: { Authorization: `Bearer ${vToken}` } });
  return res.json();
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

// 1. Wait for the new production deploy (matching SHA) to be READY.
let ready = false;
for (let i = 0; i < 30; i++) {
  const data = await vapi(`/v6/deployments?app=social-media-landing-page&target=production&limit=10&teamId=${teamId}`);
  const list = data.deployments || [];
  const d = SHA ? list.find((x) => x.meta?.githubCommitSha === SHA) : list[0];
  const state = d?.readyState || d?.state || 'none';
  console.log(`deploy poll ${i + 1}: ${state}`);
  if (state === 'READY') { ready = true; break; }
  if (state === 'ERROR') { console.log('DEPLOY FAILED'); process.exit(1); }
  await sleep(10000);
}
if (!ready) { console.log('Deploy not READY in time'); process.exit(1); }

// 2. Reset the test item to Raw Draft (the prior error flipped it).
await mgql(
  `mutation ($b: ID!, $i: ID!, $v: JSON!) { change_multiple_column_values(board_id: $b, item_id: $i, column_values: $v) { id } }`,
  { b: BOARD, i: ITEM, v: JSON.stringify({ status: { label: 'Raw Draft' } }) },
);
console.log('reset item Status -> Raw Draft');

// 3. Trigger Flow 2 on production.
const ctrl = new AbortController();
const t = setTimeout(() => ctrl.abort(), 90000);
const resp = await fetch(PROD, { headers: { Authorization: `Bearer ${secret}` }, signal: ctrl.signal });
clearTimeout(t);
console.log('trigger response:', await resp.text());

// 4. Read the item back.
const data = await mgql(
  `query ($ids: [ID!]) { items(ids: $ids) { name column_values(ids: ["status","color_mm4meks3","long_text_mm4mh8gr","numeric_mm4nh9r1"]) { id text } } }`,
  { ids: [ITEM] },
);
const it = data.items[0];
console.log(`\n=== ${it.name} ===`);
const label = { status: 'Status', color_mm4meks3: 'Post Trigger', long_text_mm4mh8gr: 'Content Text', numeric_mm4nh9r1: 'Word Ct.' };
for (const c of it.column_values) {
  const v = c.id === 'long_text_mm4mh8gr' ? `${(c.text || '').length} chars` : c.text || '(empty)';
  console.log(`  ${label[c.id]}: ${v}`);
}
