// Read-only Google connectivity check: confirms the service account authenticates
// and can SEE the given Drive folder IDs (validates creds + Drive API + sharing).
// No files are created. Usage: node scripts/test-google.mjs [folderId ...]
import { readFileSync, existsSync } from 'node:fs';
import { google } from 'googleapis';

const env = {};
if (existsSync('.env')) {
  for (const line of readFileSync('.env', 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/);
    if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
}

function loadCreds() {
  const raw = env.GOOGLE_SERVICE_ACCOUNT_JSON || process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  if (raw && raw.length > 2) {
    try {
      return JSON.parse(raw.trim().startsWith('{') ? raw : Buffer.from(raw, 'base64').toString('utf8'));
    } catch {
      /* fall through to file */
    }
  }
  for (const f of ['google-creds.json', 'google_creds.json']) {
    if (existsSync(f)) return JSON.parse(readFileSync(f, 'utf8'));
  }
  throw new Error('No Google credentials found in .env or creds file');
}

const c = loadCreds();
const auth = new google.auth.JWT({
  email: c.client_email,
  key: c.private_key,
  scopes: ['https://www.googleapis.com/auth/drive', 'https://www.googleapis.com/auth/documents'],
});
const drive = google.drive({ version: 'v3', auth });

const folders = process.argv.slice(2);
if (folders.length === 0) {
  folders.push('1Wu0FgCbW1qddaispMxVNqdOt-suFJZqe', '1JyTR2SvqHLQDUmHjGZ63KI70qw62cwy9');
}

console.log('service account:', c.client_email);
console.log('checking folder access (read-only)…\n');
let allOk = true;
for (const id of folders) {
  try {
    const r = await drive.files.get({
      fileId: id,
      fields: 'id,name,mimeType,capabilities(canAddChildren)',
      supportsAllDrives: true,
    });
    const canWrite = r.data.capabilities?.canAddChildren;
    console.log(`✓ ${id}`);
    console.log(`    name: "${r.data.name}"  type: ${r.data.mimeType}`);
    console.log(`    can create files inside: ${canWrite ? 'YES' : 'NO (share as Editor)'}`);
    if (!canWrite) allOk = false;
  } catch (e) {
    allOk = false;
    const msg = e?.errors?.[0]?.message || e?.message || String(e);
    console.log(`✗ ${id} -> ${msg}`);
  }
}
process.exit(allOk ? 0 : 1);
