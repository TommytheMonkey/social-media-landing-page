// Waits for a production deploy (SHA) to be READY, resets an item's Creation
// Trigger to "Create Post!", triggers Flow 1, and reads the result.
// Usage: node scripts/redeploy-flow1.mjs <commitSha> <itemId>
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
const ITEM = process.argv[3] || '12368705026';
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

// Reset the item to re-trigger Flow 1.
await mgql(
  `mutation ($b: ID!, $i: ID!, $v: JSON!) { change_multiple_column_values(board_id: $b, item_id: $i, column_values: $v, create_labels_if_missing: true) { id } }`,
  { b: BOARD, i: ITEM, v: JSON.stringify({ color_mm4mbf7j: { label: 'Create Post!' }, status: { label: 'ideation' } }) },
);
console.log('reset item -> Creation Trigger: Create Post!, Status: ideation');

const ctrl = new AbortController();
const t = setTimeout(() => ctrl.abort(), 110000);
const resp = await fetch(PROD, { headers: { Authorization: `Bearer ${secret}` }, signal: ctrl.signal });
clearTimeout(t);
console.log('trigger response:', await resp.text());

const data = await mgql(
  `query ($ids: [ID!]) { items(ids: $ids) { name column_values(ids: ["color_mm4mbf7j","status","color_mm4meks3","long_text_mm4mh8gr","link_mm4j5agh","file_mm33j0pd"]) { id text value } } }`,
  { ids: [ITEM] },
);
const it = data.items[0];
const col = (cid) => it.column_values.find((c) => c.id === cid);
const files = (() => { try { return (JSON.parse(col('file_mm33j0pd')?.value || '{}').files || []).length; } catch { return 0; } })();
const folder = (() => { try { return JSON.parse(col('link_mm4j5agh')?.value || '{}').url || ''; } catch { return ''; } })();
console.log(`\n=== ${it.name} ===`);
console.log(`  Creation Trigger: ${col('color_mm4mbf7j')?.text || '(empty)'}`);
console.log(`  Status: ${col('status')?.text}`);
console.log(`  Post Trigger: ${col('color_mm4meks3')?.text}`);
console.log(`  Content Text (should be empty): ${(col('long_text_mm4mh8gr')?.text || '').length} chars`);
console.log(`  Image files: ${files}`);
console.log(`  Content folder: ${folder || '(empty)'}`);
