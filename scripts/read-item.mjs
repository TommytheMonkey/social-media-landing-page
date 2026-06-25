// Reads a Monday item and prints the fields Flow 1 should have populated.
// Usage: node scripts/read-item.mjs <itemId>
import { readFileSync, existsSync } from 'node:fs';

const env = {};
if (existsSync('.env')) {
  for (const line of readFileSync('.env', 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/);
    if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
}
const token = env.MONDAY_API_TOKEN;
const id = process.argv[2];
if (!id) { console.error('usage: node scripts/read-item.mjs <itemId>'); process.exit(1); }

const COLS = {
  'color_mm4mbf7j': 'Creation Trigger',
  'status': 'Status',
  'color_mm4meks3': 'Post Trigger',
  'dropdown_mm33c63g': 'Platform',
  'color_mm4m94nw': 'Voice',
  'date_mm33qjbw': 'Post Date',
  'long_text_mm4mh8gr': 'Content Text',
  'numeric_mm4nh9r1': 'Post Word Ct.',
  'link_mm4j5agh': 'Content folder',
  'file_mm33j0pd': 'Content Image',
  'boolean_mm4mxfvy': 'Post checkbox',
};

const res = await fetch('https://api.monday.com/v2', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', Authorization: token, 'API-Version': '2026-04' },
  body: JSON.stringify({
    query: `query ($ids: [ID!]) { items(ids: $ids) { name column_values(ids: ${JSON.stringify(Object.keys(COLS))}) { id text value } } }`,
    variables: { ids: [id] },
  }),
});
const body = await res.json();
if (body.errors) { console.error(JSON.stringify(body.errors, null, 2)); process.exit(1); }
const item = body.data.items[0];
if (!item) { console.error('item not found'); process.exit(1); }

console.log(`Item: ${item.name}\n`);
const map = new Map(item.column_values.map((c) => [c.id, c]));
for (const [colId, label] of Object.entries(COLS)) {
  const cv = map.get(colId) || {};
  if (colId === 'file_mm33j0pd') {
    let files = [];
    try { files = JSON.parse(cv.value || '{}').files || []; } catch {}
    console.log(`${label}: ${files.length} file(s)` + (files[0]?.name ? ` — ${files[0].name}` : ''));
  } else if (colId === 'link_mm4j5agh') {
    let url = '';
    try { url = JSON.parse(cv.value || '{}').url || ''; } catch {}
    console.log(`${label}: ${url || '(empty)'}`);
  } else if (colId === 'long_text_mm4mh8gr') {
    const t = cv.text || '';
    console.log(`${label}: ${t.length} chars\n----------\n${t}\n----------`);
  } else {
    console.log(`${label}: ${cv.text || '(empty)'}`);
  }
}
