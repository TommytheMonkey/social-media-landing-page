// Live test of the provided-assets feature (Flow 1). Seeds two items:
//  A) auto-copy + a provided image + an attachment PDF
//  B) "Use My Copy" verbatim + an attachment PDF, no image (text-only)
// Then triggers /api/cron/poll and asserts: provided image is used (not generated),
// the branded letsgo.takeo.co/downloads/... link is saved + actually fetchable,
// the copy carries the link, and B's Doc is the verbatim copy. Cleans up after.
// Usage: node scripts/test-provided-assets.mjs <sha>
import { readFileSync, existsSync } from 'node:fs';
import { google } from 'googleapis';
import sharp from 'sharp';

const env = {};
if (existsSync('.env')) for (const line of readFileSync('.env', 'utf8').split('\n')) { const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/); if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, ''); }
const vToken = env.VERCEL_TOKEN, mToken = env.MONDAY_API_TOKEN, secret = env.CRON_SECRET;
const SHA = process.argv[2] || '';
const BOARD = '18411954205';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const C = { status: 'status', platform: 'dropdown_mm33c63g', voice: 'color_mm4m94nw', desc: 'text_mm4mvtmr', contentText: 'long_text_mm4mh8gr',
  creationTrigger: 'color_mm4mbf7j', contentImage: 'file_mm33j0pd', attachment: 'file_mm4n5f04', useMyCopy: 'boolean_mm4nakr6', downloadLink: 'link_mm4nm382', folder: 'link_mm4j5agh' };

const PNG = await sharp({ create: { width: 64, height: 64, channels: 3, background: { r: 200, g: 120, b: 80 } } }).png().toBuffer();
const PDF = Buffer.from('%PDF-1.4\n% LetsGo test attachment — hosting smoke test\n1 0 obj<</Type/Catalog>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n');
const MY_COPY = 'Here is my exact, human-written post. Do not change a single word of this. — Tommy, TakeoffMonkey';

async function vapi(p) { return (await fetch('https://api.vercel.com' + p, { headers: { Authorization: `Bearer ${vToken}` } })).json(); }
async function mgql(q, v) { const r = await fetch('https://api.monday.com/v2', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: mToken, 'API-Version': '2026-04' }, body: JSON.stringify({ query: q, variables: v }) }); const b = await r.json(); if (b.errors) throw new Error(JSON.stringify(b.errors)); return b.data; }
async function createItem(name, vals) { const d = await mgql(`mutation($b:ID!,$n:String!,$v:JSON!){create_item(board_id:$b,item_name:$n,column_values:$v,create_labels_if_missing:true){id}}`, { b: BOARD, n: name, v: JSON.stringify(vals) }); return d.create_item.id; }
async function setCols(id, vals) { await mgql(`mutation($b:ID!,$i:ID!,$v:JSON!){change_multiple_column_values(board_id:$b,item_id:$i,column_values:$v,create_labels_if_missing:true){id}}`, { b: BOARD, i: id, v: JSON.stringify(vals) }); }
async function uploadFile(itemId, columnId, bytes, filename, contentType) {
  const query = `mutation ($file: File!) { add_file_to_column(item_id: ${itemId}, column_id: "${columnId}", file: $file) { id } }`;
  const form = new FormData();
  form.append('query', query); form.append('map', JSON.stringify({ image: ['variables.file'] }));
  form.append('image', new Blob([new Uint8Array(bytes)], { type: contentType }), filename);
  const res = await fetch('https://api.monday.com/v2/file', { method: 'POST', headers: { Authorization: mToken, 'API-Version': '2026-04' }, body: form });
  const t = await res.text(); if (!res.ok) throw new Error(t.slice(0, 300)); const j = JSON.parse(t); if (j.errors) throw new Error(JSON.stringify(j.errors)); return j.data.add_file_to_column.id;
}
async function readCols(ids, cols) { const d = await mgql(`query($ids:[ID!],$c:[String!]){items(ids:$ids){id name column_values(ids:$c){id text value}}}`, { ids, c: cols }); return d.items; }
const col = (it, id) => it.column_values.find((c) => c.id === id)?.text ?? '';
const colVal = (it, id) => { try { return JSON.parse(it.column_values.find((c) => c.id === id)?.value || 'null'); } catch { return null; } };
const fileCount = (it, id) => { const v = colVal(it, id); return Array.isArray(v?.files) ? v.files.length : 0; };
const driveClient = () => { const creds = (() => { const raw = env.GOOGLE_SERVICE_ACCOUNT_JSON; return JSON.parse(raw.trim().startsWith('{') ? raw : Buffer.from(raw, 'base64').toString('utf8')); })(); const auth = new google.auth.JWT({ email: creds.client_email, key: creds.private_key, scopes: ['https://www.googleapis.com/auth/drive', 'https://www.googleapis.com/auth/documents'] }); return google.drive({ version: 'v3', auth }); };
async function docTextOf(it) {
  const fid = colVal(it, C.folder)?.url?.match(/folders\/([a-zA-Z0-9_-]+)/)?.[1]; if (!fid) return '';
  const d = driveClient();
  const docs = (await d.files.list({ q: `'${fid}' in parents and mimeType='application/vnd.google-apps.document' and trashed=false`, fields: 'files(id)', supportsAllDrives: true, includeItemsFromAllDrives: true })).data.files || [];
  if (!docs[0]) return '';
  return (await d.files.export({ fileId: docs[0].id, mimeType: 'text/plain' }, { responseType: 'text' })).data;
}
const results = [];
const check = (name, pass, extra = '') => { results.push({ name, pass }); console.log(`  ${pass ? '✅' : '❌'} ${name}${extra ? ' — ' + extra : ''}`); };

// --- wait for deploy ---
const teams = (await vapi('/v2/teams')).teams || [];
const teamId = (teams.find((t) => t.slug === 'takeoff-monkey') || teams[0])?.id;
let ready = false;
for (let i = 0; i < 30; i++) { const list = (await vapi(`/v6/deployments?app=social-media-landing-page&target=production&limit=10&teamId=${teamId}`)).deployments || []; const d = SHA ? list.find((x) => x.meta?.githubCommitSha === SHA) : list[0]; const st = d?.readyState || d?.state || 'none'; console.log(`deploy poll ${i + 1}: ${st}`); if (st === 'READY') { ready = true; break; } if (st === 'ERROR') { console.log('DEPLOY FAILED'); process.exit(1); } await sleep(10000); }
if (!ready) { console.log('deploy not ready'); process.exit(1); }

// Sweep any leftover PROV-* items from a previous failed run.
const stale = ((await mgql(`query($b:ID!){boards(ids:[$b]){items_page(limit:100){items{id name}}}}`, { b: BOARD })).boards[0].items_page.items || []).filter((i) => /^PROV-[AB]/.test(i.name));
for (const s of stale) { try { await mgql(`mutation($id:ID!){delete_item(item_id:$id){id}}`, { id: s.id }); } catch {} }
if (stale.length) console.log(`swept ${stale.length} leftover PROV item(s)`);

const cleanup = [];
const folders = [];
try {
  // Item A: auto copy + provided image + attachment
  const a = await createItem('PROV-A image+pdf', { [C.desc]: 'A quick tip about checking grade with a laser level before the concrete truck shows up.', [C.voice]: { label: 'Tommy' }, [C.platform]: { labels: ['LinkedIn'] } });
  cleanup.push(a);
  await uploadFile(a, C.contentImage, PNG, 'my-photo.png', 'image/png');
  await uploadFile(a, C.attachment, PDF, 'lets-go-guide.pdf', 'application/pdf');
  await setCols(a, { [C.creationTrigger]: { label: 'Create Post!' } });
  // Item B: use my copy + attachment, no image
  const b = await createItem('PROV-B usemycopy+pdf', { [C.contentText]: { text: MY_COPY }, [C.useMyCopy]: { checked: 'true' }, [C.voice]: { label: 'Tommy' }, [C.platform]: { labels: ['LinkedIn'] } });
  cleanup.push(b);
  await uploadFile(b, C.attachment, PDF, 'lets-go-guide.pdf', 'application/pdf');
  await setCols(b, { [C.creationTrigger]: { label: 'Create Post!' } });
  console.log(`created A=${a} (image+pdf), B=${b} (usemycopy+pdf); triggering /api/cron/poll...`);

  const ctrl = new AbortController(); const t = setTimeout(() => ctrl.abort(), 150000);
  const resp = await fetch('https://letsgo.takeo.co/api/cron/poll', { headers: { Authorization: `Bearer ${secret}` }, signal: ctrl.signal });
  clearTimeout(t);
  console.log('poll:', await resp.text());

  // Monday returns items() in id order, not argument order — map by id, don't destructure.
  const fetched = await readCols([a, b], [C.status, C.contentImage, C.downloadLink, C.folder]);
  const byId = Object.fromEntries(fetched.map((it) => [it.id, it]));
  const ia = byId[a], ib = byId[b];
  for (const it of [ia, ib]) { const f = colVal(it, C.folder)?.url?.match(/folders\/([a-zA-Z0-9_-]+)/)?.[1]; if (f) folders.push(f); }

  // --- Item A assertions ---
  console.log(`\n=== A (${a}) ===`);
  check('A status Raw Draft', col(ia, C.status) === 'Raw Draft', col(ia, C.status));
  check('A keeps exactly 1 image (provided, not generated)', fileCount(ia, C.contentImage) === 1, `count=${fileCount(ia, C.contentImage)}`);
  const aLink = colVal(ia, C.downloadLink)?.url || '';
  check('A Download Link is branded', aLink.startsWith(`https://letsgo.takeo.co/downloads/${a}/`), aLink);
  if (aLink) { const r = await fetch(aLink); const body = Buffer.from(await r.arrayBuffer()); check('A branded link serves the PDF bytes', r.ok && body.equals(PDF), `HTTP ${r.status}, ${body.length}b vs ${PDF.length}b`); }
  const aDoc = await docTextOf(ia);
  check('A copy contains the download link', aDoc.includes(aLink) && aLink.length > 0, aLink ? '' : 'no link');

  // --- Item B assertions ---
  console.log(`\n=== B (${b}) ===`);
  check('B status Raw Draft', col(ib, C.status) === 'Raw Draft', col(ib, C.status));
  check('B is text-only (no image)', fileCount(ib, C.contentImage) === 0, `count=${fileCount(ib, C.contentImage)}`);
  const bLink = colVal(ib, C.downloadLink)?.url || '';
  check('B Download Link is branded', bLink.startsWith(`https://letsgo.takeo.co/downloads/${b}/`), bLink);
  if (bLink) { const r = await fetch(bLink); check('B branded link serves the PDF', r.ok, `HTTP ${r.status}`); }
  const bDoc = (await docTextOf(ib)).trim();
  check('B Doc is my copy verbatim (starts with it)', bDoc.startsWith(MY_COPY), bDoc.slice(0, 80));
  check('B Doc appends the download CTA', bDoc.includes(bLink) && bLink.length > 0);
} finally {
  console.log('\n=== cleanup ===');
  for (const id of cleanup) { try { await mgql(`mutation($id:ID!){delete_item(item_id:$id){id}}`, { id }); } catch {} }
  console.log(`deleted ${cleanup.length} item(s)`);
  if (folders.length) { const d = driveClient(); for (const f of folders) { try { await d.files.update({ fileId: f, requestBody: { trashed: true }, supportsAllDrives: true }); } catch {} } console.log(`trashed ${folders.length} folder(s)`); }
  console.log('(note: hosted Blob test files under content-engine/downloads/<id>/ persist — harmless)');
  const passed = results.filter((r) => r.pass).length;
  console.log(`\n=== RESULT: ${passed}/${results.length} checks passed ===`);
  if (passed !== results.length) process.exitCode = 1;
}
