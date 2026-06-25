// Deletes the test Monday items and trashes their Drive folders.
// Usage: node scripts/cleanup-test-data.mjs
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
function loadCreds() {
  const raw = env.GOOGLE_SERVICE_ACCOUNT_JSON;
  if (raw && raw.length > 2) {
    try { return JSON.parse(raw.trim().startsWith('{') ? raw : Buffer.from(raw, 'base64').toString('utf8')); } catch {}
  }
  for (const f of ['google-creds.json', 'google_creds.json']) if (existsSync(f)) return JSON.parse(readFileSync(f, 'utf8'));
  throw new Error('no google creds');
}

const ITEMS = ['12368112898', '12368705026'];
const FOLDERS = ['13JjONtC8JFFShiB9pORDGe1tSCvgrc27', '14SiftyVdzbWFZKRfkQ75tVnkP9kHU5RD'];

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

console.log('=== Monday items ===');
for (const id of ITEMS) {
  try {
    await mgql(`mutation ($id: ID!) { delete_item(item_id: $id) { id } }`, { id });
    console.log(`✓ deleted Monday item ${id}`);
  } catch (e) {
    console.log(`! could not delete item ${id}: ${e.message}`);
  }
}

const creds = loadCreds();
const auth = new google.auth.JWT({ email: creds.client_email, key: creds.private_key, scopes: ['https://www.googleapis.com/auth/drive'] });
const drive = google.drive({ version: 'v3', auth });

console.log('\n=== Drive folders (trash) ===');
for (const id of FOLDERS) {
  try {
    const meta = await drive.files.get({ fileId: id, fields: 'name', supportsAllDrives: true });
    await drive.files.update({ fileId: id, requestBody: { trashed: true }, supportsAllDrives: true });
    console.log(`✓ trashed folder "${meta.data.name}" (${id})`);
  } catch (e) {
    console.log(`! could not trash folder ${id}: ${e.message}`);
  }
}
console.log('\nCleanup done.');
