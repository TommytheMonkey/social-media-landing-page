// Creates a fresh "Create Post!" item via the Monday API, triggers Flow 1 on
// production, and reads the result. Usage: node scripts/create-and-run-flow1.mjs
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

const NAME = 'Redline a plan sheet from your phone — no laptop on the tailgate';
const DESC =
  'Show sitework crews they can mark up a PDF plan sheet right on their phone — circle a conflict, drop a dimension note, and send it back to the GC in the same minute using the built-in Markup tool. Be honest: great for quick redlines and RFIs, not a replacement for real plan-management software, and big sheets are clunky to navigate on a small screen.';
const vals = {
  text_mm4mvtmr: DESC,
  color_mm4m94nw: { label: 'Takeoff Monkey' },
  dropdown_mm33c63g: { labels: ['LinkedIn'] },
  color_mm4mbf7j: { label: 'Create Post!' },
};

const created = await mgql(
  `mutation ($b: ID!, $n: String!, $v: JSON!) { create_item(board_id: $b, item_name: $n, column_values: $v) { id } }`,
  { b: BOARD, n: NAME, v: JSON.stringify(vals) },
);
const id = created.create_item.id;
console.log(`created item ${id}: "${NAME}"`);

// Trigger Flow 1 (give generation time: Claude + gpt-image + Drive).
console.log('triggering Flow 1…');
const ctrl = new AbortController();
const t = setTimeout(() => ctrl.abort(), 120000);
const resp = await fetch(PROD, { headers: { Authorization: `Bearer ${secret}` }, signal: ctrl.signal });
clearTimeout(t);
console.log('trigger response:', await resp.text());

// Read back.
const data = await mgql(
  `query ($ids: [ID!]) { items(ids: $ids) { name column_values(ids: ["color_mm4mbf7j","status","color_mm4meks3","dropdown_mm33c63g","color_mm4m94nw","long_text_mm4mh8gr","link_mm4j5agh","file_mm33j0pd"]) { id text value } } }`,
  { ids: [id] },
);
const it = data.items[0];
const col = (cid) => it.column_values.find((c) => c.id === cid);
const fileCount = (() => { try { return (JSON.parse(col('file_mm33j0pd')?.value || '{}').files || []).length; } catch { return 0; } })();
const folderUrl = (() => { try { return JSON.parse(col('link_mm4j5agh')?.value || '{}').url || ''; } catch { return ''; } })();
console.log(`\n=== ${it.name} ===`);
console.log(`  Creation Trigger: ${col('color_mm4mbf7j')?.text || '(empty)'}`);
console.log(`  Status: ${col('status')?.text}`);
console.log(`  Post Trigger: ${col('color_mm4meks3')?.text}`);
console.log(`  Platform: ${col('dropdown_mm33c63g')?.text}   Voice: ${col('color_mm4m94nw')?.text}`);
console.log(`  Content Text (should be EMPTY now): ${(col('long_text_mm4mh8gr')?.text || '').length} chars`);
console.log(`  Image files: ${fileCount}`);
console.log(`  Content folder: ${folderUrl || '(empty)'}`);
console.log(`\nITEM_ID=${id}`);
