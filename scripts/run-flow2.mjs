// Sets an item to Clear! + a far-future Post Date, triggers Flow 2, reads result.
// Usage: node scripts/run-flow2.mjs <itemId> [YYYY-MM-DD]
import { readFileSync, existsSync } from 'node:fs';

const env = {};
if (existsSync('.env')) {
  for (const line of readFileSync('.env', 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/);
    if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
}
const mToken = env.MONDAY_API_TOKEN;
const secret = env.CRON_SECRET;
const ITEM = process.argv[2] || '12368705026';
const DATE = process.argv[3] || '2026-12-31';
const BOARD = '18411954205';
const PROD = 'https://letsgo.takeo.co/api/cron/poll';

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

await mgql(
  `mutation ($b: ID!, $i: ID!, $v: JSON!) { change_multiple_column_values(board_id: $b, item_id: $i, column_values: $v) { id } }`,
  { b: BOARD, i: ITEM, v: JSON.stringify({ date_mm33qjbw: { date: DATE }, color_mm4meks3: { label: 'Clear!' } }) },
);
console.log(`set Post Date ${DATE} + Post Trigger: Clear!`);

const ctrl = new AbortController();
const t = setTimeout(() => ctrl.abort(), 110000);
const resp = await fetch(PROD, { headers: { Authorization: `Bearer ${secret}` }, signal: ctrl.signal });
clearTimeout(t);
console.log('trigger response:', await resp.text());

const data = await mgql(
  `query ($ids: [ID!]) { items(ids: $ids) { name column_values(ids: ["status","color_mm4meks3","long_text_mm4mh8gr","numeric_mm4nh9r1"]) { id text } } }`,
  { ids: [ITEM] },
);
const it = data.items[0];
const col = (cid) => it.column_values.find((c) => c.id === cid);
console.log(`\n=== ${it.name} ===`);
console.log(`  Status: ${col('status')?.text}`);
console.log(`  Post Trigger: ${col('color_mm4meks3')?.text}`);
console.log(`  Content Text: ${(col('long_text_mm4mh8gr')?.text || '').length} chars`);
console.log(`  Post Word Ct.: ${col('numeric_mm4nh9r1')?.text || '(empty)'}`);
