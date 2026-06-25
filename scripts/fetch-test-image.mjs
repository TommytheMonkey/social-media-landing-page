// Downloads the first PNG in a Drive folder so we can eyeball the generated image.
// Usage: node scripts/fetch-test-image.mjs <folderId> <outPath>
import { readFileSync, existsSync, writeFileSync } from 'node:fs';
import { google } from 'googleapis';

const env = {};
if (existsSync('.env')) {
  for (const line of readFileSync('.env', 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/);
    if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
}
function loadCreds() {
  const raw = env.GOOGLE_SERVICE_ACCOUNT_JSON;
  if (raw && raw.length > 2) {
    try { return JSON.parse(raw.trim().startsWith('{') ? raw : Buffer.from(raw, 'base64').toString('utf8')); } catch {}
  }
  for (const f of ['google-creds.json', 'google_creds.json']) if (existsSync(f)) return JSON.parse(readFileSync(f, 'utf8'));
  throw new Error('no creds');
}
const folderId = process.argv[2];
const outPath = process.argv[3] || 'test-image.png';
const c = loadCreds();
const auth = new google.auth.JWT({ email: c.client_email, key: c.private_key, scopes: ['https://www.googleapis.com/auth/drive'] });
const drive = google.drive({ version: 'v3', auth });

const list = await drive.files.list({
  q: `'${folderId}' in parents and mimeType contains 'image/' and trashed = false`,
  fields: 'files(id,name)',
  supportsAllDrives: true,
  includeItemsFromAllDrives: true,
});
const file = (list.data.files || [])[0];
if (!file) { console.error('no image found in folder'); process.exit(1); }
const resp = await drive.files.get({ fileId: file.id, alt: 'media', supportsAllDrives: true }, { responseType: 'arraybuffer' });
writeFileSync(outPath, Buffer.from(resp.data));
console.log(`saved "${file.name}" -> ${outPath}`);
