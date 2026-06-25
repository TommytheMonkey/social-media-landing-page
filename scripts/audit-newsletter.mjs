// Verifies the board pieces the newsletter spec references exist before we build.
// Usage: node scripts/audit-newsletter.mjs
import { readFileSync, existsSync } from 'node:fs';
import { google } from 'googleapis';

const env = {};
if (existsSync('.env')) {
  for (const line of readFileSync('.env', 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/);
    if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
}
const mToken = env.MONDAY_API_TOKEN;
const BOARD = '18411954205';
const NEWSLETTER_ROOT = '14qb1gvyrdXCVl41tL83aM6p38T2Epa1O';

async function mgql(query, variables) {
  const res = await fetch('https://api.monday.com/v2', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: mToken, 'API-Version': '2026-04' }, body: JSON.stringify({ query, variables }) });
  const b = await res.json(); if (b.errors) throw new Error(JSON.stringify(b.errors)); return b.data;
}

const COL_IDS = ['boolean_mm4mh94v', 'numeric_mm4n5xpx', 'dropdown_mm33c63g', 'color_mm4m94nw', 'color_mm4mbf7j', 'color_mm4meks3', 'boolean_mm4mxfvy'];
const data = await mgql(`query ($b: [ID!], $c: [String!]) { boards(ids: $b) { columns(ids: $c) { id title type settings_str } groups { id title } } }`, { b: [BOARD], c: COL_IDS });
const board = data.boards[0];

console.log('=== Columns ===');
for (const id of COL_IDS) {
  const c = board.columns.find((x) => x.id === id);
  if (!c) { console.log(`  ✗ ${id}: NOT FOUND`); continue; }
  let labels = '';
  try { const s = JSON.parse(c.settings_str || '{}'); if (s.labels) labels = '  labels=' + JSON.stringify(Object.values(s.labels)); } catch {}
  console.log(`  ✓ ${id}  "${c.title}" (${c.type})${labels}`);
}

console.log('\n=== Groups ===');
for (const g of board.groups) console.log(`  ${g.title}  (${g.id})`);
const prep = board.groups.find((g) => /newsletter prep/i.test(g.title));
console.log(prep ? `\n  ✓ "Newsletter Prep" group id = ${prep.id}` : `\n  ✗ no "Newsletter Prep" group found`);

console.log('\n=== Newsletters Drive folder ===');
const creds = (() => { const raw = env.GOOGLE_SERVICE_ACCOUNT_JSON; return JSON.parse(raw.trim().startsWith('{') ? raw : Buffer.from(raw, 'base64').toString('utf8')); })();
const auth = new google.auth.JWT({ email: creds.client_email, key: creds.private_key, scopes: ['https://www.googleapis.com/auth/drive'] });
const drive = google.drive({ version: 'v3', auth });
try {
  const r = await drive.files.get({ fileId: NEWSLETTER_ROOT, fields: 'id,name,mimeType,capabilities(canAddChildren)', supportsAllDrives: true });
  console.log(`  ✓ "${r.data.name}" (${r.data.mimeType})  canAddChildren=${r.data.capabilities?.canAddChildren}`);
} catch (e) {
  console.log(`  ✗ cannot access ${NEWSLETTER_ROOT}: ${e.errors?.[0]?.message || e.message} — share it with ${creds.client_email}`);
}
