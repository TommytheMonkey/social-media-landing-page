// Prints the most recent updates (comments) on a Monday item — our error channel.
// Usage: node scripts/read-updates.mjs <itemId> [count]
import { readFileSync, existsSync } from 'node:fs';

const env = {};
if (existsSync('.env')) {
  for (const line of readFileSync('.env', 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/);
    if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
}
const token = env.MONDAY_API_TOKEN;
const id = process.argv[2] || '12368112898';
const count = Number(process.argv[3] || 2);

const res = await fetch('https://api.monday.com/v2', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', Authorization: token, 'API-Version': '2026-04' },
  body: JSON.stringify({
    query: `query ($ids: [ID!]) { items(ids: $ids) { updates(limit: ${count}) { created_at body } } }`,
    variables: { ids: [id] },
  }),
});
const body = await res.json();
if (body.errors) { console.error(JSON.stringify(body.errors)); process.exit(1); }
const updates = body.data.items[0]?.updates || [];
for (const u of updates) {
  console.log(`--- ${u.created_at} ---`);
  console.log(u.body.replace(/<[^>]+>/g, '')); // strip HTML
  console.log('');
}
