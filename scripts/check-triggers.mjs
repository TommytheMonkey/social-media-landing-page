// Read-only: lists which items the poll (/api/cron/poll) WOULD process right now,
// so we know the blast radius before triggering. Usage: node scripts/check-triggers.mjs
import { readFileSync, existsSync } from 'node:fs';

const env = {};
if (existsSync('.env')) {
  for (const line of readFileSync('.env', 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/);
    if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
}
const token = env.MONDAY_API_TOKEN;
const BOARD = '18411954205';
const COLS = ['color_mm4mbf7j', 'color_mm4meks3', 'status']; // creation trigger, post trigger, status

async function gql(query, variables) {
  const res = await fetch('https://api.monday.com/v2', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: token, 'API-Version': '2026-04' },
    body: JSON.stringify({ query, variables }),
  });
  const body = await res.json();
  if (body.errors) throw new Error(JSON.stringify(body.errors));
  return body.data;
}

const items = [];
let data = await gql(
  `query ($b: [ID!], $c: [String!]) { boards(ids: $b) { items_page(limit: 200) { cursor items { id name column_values(ids: $c) { id text } } } } }`,
  { b: [BOARD], c: COLS },
);
let page = data.boards[0].items_page;
items.push(...page.items);
let cursor = page.cursor;
while (cursor) {
  data = await gql(
    `query ($c: [String!], $cur: String!) { next_items_page(limit: 200, cursor: $cur) { cursor items { id name column_values(ids: $c) { id text } } } }`,
    { c: COLS, cur: cursor },
  );
  items.push(...data.next_items_page.items);
  cursor = data.next_items_page.cursor;
}

const col = (it, id) => it.column_values.find((c) => c.id === id)?.text || '';
const flow1 = items.filter((it) => col(it, 'color_mm4mbf7j') === 'Create Post!');
const flow2 = items.filter((it) => col(it, 'color_mm4meks3') === 'Clear!' && col(it, 'status') === 'Raw Draft');
const flow3 = items.filter((it) => col(it, 'color_mm4meks3') === 'Post Now!' && col(it, 'status') !== 'Live!');

console.log(`Scanned ${items.length} items on the board.\n`);
const show = (label, arr) => {
  console.log(`${label}: ${arr.length}`);
  for (const it of arr) console.log(`   • ${it.name} (${it.id})`);
};
show('Flow 1 — Create Post! (would generate content)', flow1);
show('Flow 2 — Clear! + Raw Draft (would schedule to Buffer)', flow2);
show('Flow 3 — Post Now! (would publish immediately)', flow3);
