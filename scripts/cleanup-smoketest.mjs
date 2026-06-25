// Removes leftover __smoketest__ folders/files created by the Google smoke test.
// Usage: node scripts/cleanup-smoketest.mjs [rootFolderId]
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
    } catch { /* fall through */ }
  }
  for (const f of ['google-creds.json', 'google_creds.json']) {
    if (existsSync(f)) return JSON.parse(readFileSync(f, 'utf8'));
  }
  throw new Error('No Google credentials found');
}

const root = process.argv[2] || '1Wu0FgCbW1qddaispMxVNqdOt-suFJZqe';
const c = loadCreds();
const auth = new google.auth.JWT({
  email: c.client_email,
  key: c.private_key,
  scopes: ['https://www.googleapis.com/auth/drive'],
});
const drive = google.drive({ version: 'v3', auth });

const res = await drive.files.list({
  q: `'${root}' in parents and name contains '__smoketest' and trashed = false`,
  fields: 'files(id,name)',
  supportsAllDrives: true,
  includeItemsFromAllDrives: true,
});
const files = res.data.files || [];
if (files.length === 0) {
  console.log('Nothing to clean up.');
} else {
  for (const f of files) {
    try {
      // Trash rather than hard-delete (more reliable for service-account-owned items).
      await drive.files.update({ fileId: f.id, requestBody: { trashed: true }, supportsAllDrives: true });
      console.log(`✓ trashed "${f.name}" (${f.id})`);
    } catch (e) {
      console.log(`! could not trash "${f.name}" (${f.id}): ${e?.message || e}`);
    }
  }
}
