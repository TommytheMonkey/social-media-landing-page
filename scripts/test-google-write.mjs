// Full Flow-1 Google path smoke test (self-cleaning): create folder -> create &
// populate a Google Doc (Docs API) -> upload an image -> delete everything.
// Usage: node scripts/test-google-write.mjs [rootFolderId]
import { readFileSync, existsSync } from 'node:fs';
import { Readable } from 'node:stream';
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
  scopes: ['https://www.googleapis.com/auth/drive', 'https://www.googleapis.com/auth/documents'],
});
const drive = google.drive({ version: 'v3', auth });
const docs = google.docs({ version: 'v1', auth });

// 1x1 transparent PNG
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR4nGNgYAAAAAMAASsJTYQAAAAASUVORK5CYII=',
  'base64',
);

let folderId;
try {
  const stamp = `${Date.now()}`;
  console.log(`root: "${root}"  service account: ${c.client_email}\n`);

  // 1. Create folder
  const folder = await drive.files.create({
    requestBody: { name: `__smoketest__${stamp}`, mimeType: 'application/vnd.google-apps.folder', parents: [root] },
    fields: 'id,webViewLink',
    supportsAllDrives: true,
  });
  folderId = folder.data.id;
  console.log(`✓ created folder (${folderId})`);

  // 2. Create a Google Doc (Drive) + populate it (Docs API)
  const doc = await drive.files.create({
    requestBody: { name: `__smoketest_doc__${stamp}`, mimeType: 'application/vnd.google-apps.document', parents: [folderId] },
    fields: 'id',
    supportsAllDrives: true,
  });
  console.log(`✓ created Google Doc (${doc.data.id})`);
  await docs.documents.batchUpdate({
    documentId: doc.data.id,
    requestBody: { requests: [{ insertText: { location: { index: 1 }, text: 'Smoke test OK\n' } }] },
  });
  console.log('✓ Docs API batchUpdate (insertText) succeeded — Docs API is enabled');

  // 3. Upload an image (media upload path)
  const img = await drive.files.create({
    requestBody: { name: `__smoketest_img__${stamp}.png`, parents: [folderId] },
    media: { mimeType: 'image/png', body: Readable.from(PNG) },
    fields: 'id',
    supportsAllDrives: true,
  });
  console.log(`✓ uploaded image (${img.data.id})`);

  console.log('\nALL GOOD — full Flow-1 Google path works.');
} catch (e) {
  const msg = e?.errors?.[0]?.message || e?.message || String(e);
  console.log(`\n✗ FAILED: ${msg}`);
  if (/Docs API|documents/i.test(msg)) console.log('   → Enable the Google Docs API in the GCP project.');
} finally {
  // 4. Cleanup
  if (folderId) {
    try {
      await drive.files.delete({ fileId: folderId, supportsAllDrives: true });
      console.log(`✓ cleaned up test folder ${folderId}`);
    } catch (e) {
      console.log(`! cleanup failed for ${folderId} — delete it manually: ${e?.message || e}`);
    }
  }
}
