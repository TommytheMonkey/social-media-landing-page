// Live test: a dual-platform (LinkedIn + Instagram) post must produce two content
// files whose names END in " - LI" and " - IG". Uses "Use My Copy" + a provided image
// so it skips ALL AI generation (fast + free). Cleans up after.
// Usage: node scripts/test-dual-naming.mjs <sha>
import { readFileSync, existsSync } from 'node:fs';
import { google } from 'googleapis';
import sharp from 'sharp';

const env = {};
if (existsSync('.env')) for (const line of readFileSync('.env', 'utf8').split('\n')) { const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/); if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, ''); }
const vToken = env.VERCEL_TOKEN, mToken = env.MONDAY_API_TOKEN, secret = env.CRON_SECRET;
const SHA = process.argv[2] || '';
const BOARD = '18411954205';
const NAME = 'DUAL-NAME test';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const C = { platform: 'dropdown_mm33c63g', voice: 'color_mm4m94nw', contentText: 'long_text_mm4mh8gr', creationTrigger: 'color_mm4mbf7j', contentImage: 'file_mm33j0pd', useMyCopy: 'boolean_mm4nakr6', folder: 'link_mm4j5agh' };
const PNG = await sharp({ create: { width: 64, height: 64, channels: 3, background: { r: 90, g: 140, b: 200 } } }).png().toBuffer();

async function vapi(p) { return (await fetch('https://api.vercel.com' + p, { headers: { Authorization: `Bearer ${vToken}` } })).json(); }
async function mgql(q, v) { const r = await fetch('https://api.monday.com/v2', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: mToken, 'API-Version': '2026-04' }, body: JSON.stringify({ query: q, variables: v }) }); const b = await r.json(); if (b.errors) throw new Error(JSON.stringify(b.errors)); return b.data; }
async function createItem(name, vals) { const d = await mgql(`mutation($b:ID!,$n:String!,$v:JSON!){create_item(board_id:$b,item_name:$n,column_values:$v,create_labels_if_missing:true){id}}`, { b: BOARD, n: name, v: JSON.stringify(vals) }); return d.create_item.id; }
async function setCols(id, vals) { await mgql(`mutation($b:ID!,$i:ID!,$v:JSON!){change_multiple_column_values(board_id:$b,item_id:$i,column_values:$v,create_labels_if_missing:true){id}}`, { b: BOARD, i: id, v: JSON.stringify(vals) }); }
async function uploadFile(itemId, columnId, bytes, filename, contentType) {
  const query = `mutation ($file: File!) { add_file_to_column(item_id: ${itemId}, column_id: "${columnId}", file: $file) { id } }`;
  const form = new FormData(); form.append('query', query); form.append('map', JSON.stringify({ image: ['variables.file'] }));
  form.append('image', new Blob([new Uint8Array(bytes)], { type: contentType }), filename);
  const res = await fetch('https://api.monday.com/v2/file', { method: 'POST', headers: { Authorization: mToken, 'API-Version': '2026-04' }, body: form });
  const t = await res.text(); if (!res.ok) throw new Error(t.slice(0, 300)); const j = JSON.parse(t); if (j.errors) throw new Error(JSON.stringify(j.errors)); return j.data.add_file_to_column.id;
}
async function itemsByName(name) { const its = (await mgql(`query($b:ID!){boards(ids:[$b]){items_page(limit:100){items{id name column_values(ids:["${C.folder}"]){id value}}}}}`, { b: BOARD })).boards[0].items_page.items; return its.filter((i) => i.name === name); }
const folderIdOf = (it) => { try { return JSON.parse(it.column_values.find((c) => c.id === C.folder)?.value || '{}').url?.match(/folders\/([a-zA-Z0-9_-]+)/)?.[1] || null; } catch { return null; } };
const driveClient = () => { const creds = (() => { const raw = env.GOOGLE_SERVICE_ACCOUNT_JSON; return JSON.parse(raw.trim().startsWith('{') ? raw : Buffer.from(raw, 'base64').toString('utf8')); })(); const auth = new google.auth.JWT({ email: creds.client_email, key: creds.private_key, scopes: ['https://www.googleapis.com/auth/drive'] }); return google.drive({ version: 'v3', auth }); };

const results = [];
const check = (name, pass, extra = '') => { results.push({ name, pass }); console.log(`  ${pass ? '✅' : '❌'} ${name}${extra ? ' — ' + extra : ''}`); };

// wait for deploy
const teams = (await vapi('/v2/teams')).teams || [];
const teamId = (teams.find((t) => t.slug === 'takeoff-monkey') || teams[0])?.id;
let ready = false;
for (let i = 0; i < 30; i++) { const list = (await vapi(`/v6/deployments?app=social-media-landing-page&target=production&limit=10&teamId=${teamId}`)).deployments || []; const d = SHA ? list.find((x) => x.meta?.githubCommitSha === SHA) : list[0]; const st = d?.readyState || d?.state || 'none'; console.log(`deploy poll ${i + 1}: ${st}`); if (st === 'READY') { ready = true; break; } if (st === 'ERROR') { console.log('DEPLOY FAILED'); process.exit(1); } await sleep(10000); }
if (!ready) { console.log('deploy not ready'); process.exit(1); }

// sweep leftovers
for (const it of await itemsByName(NAME)) { try { await mgql(`mutation($id:ID!){delete_item(item_id:$id){id}}`, { id: it.id }); } catch {} }

const drive = driveClient();
const trashFolders = new Set();
try {
  const id = await createItem(NAME, { [C.contentText]: { text: 'Dual-platform verbatim copy. — Tommy' }, [C.useMyCopy]: { checked: 'true' }, [C.voice]: { label: 'Tommy' }, [C.platform]: { labels: ['LinkedIn', 'Instagram'] } });
  await uploadFile(id, C.contentImage, PNG, 'shared.png', 'image/png');
  await setCols(id, { [C.creationTrigger]: { label: 'Create Post!' } });
  console.log(`created dual-platform item ${id}; triggering /api/cron/poll...`);

  const ctrl = new AbortController(); const t = setTimeout(() => ctrl.abort(), 110000);
  const resp = await fetch('https://letsgo.takeo.co/api/cron/poll', { headers: { Authorization: `Bearer ${secret}` }, signal: ctrl.signal });
  clearTimeout(t);
  console.log('poll:', await resp.text());

  const items = await itemsByName(NAME);
  check('two items created (one per platform)', items.length === 2, `count=${items.length}`);

  const docNames = [];
  for (const it of items) {
    const fid = folderIdOf(it); if (!fid) continue;
    // record the leaf + its parent ("posts/DUAL-NAME test") for cleanup
    trashFolders.add(fid);
    try { const meta = await drive.files.get({ fileId: fid, fields: 'parents', supportsAllDrives: true }); for (const p of meta.data.parents || []) trashFolders.add(p); } catch {}
    const files = (await drive.files.list({ q: `'${fid}' in parents and trashed=false`, fields: 'files(name,mimeType)', supportsAllDrives: true, includeItemsFromAllDrives: true })).data.files || [];
    for (const f of files) { console.log(`   ${fid.slice(0, 6)}…  ${f.name}  (${f.mimeType.includes('document') ? 'doc' : 'img'})`); if (f.mimeType.includes('document')) docNames.push(f.name); }
  }
  check('a content file ends with " - LI"', docNames.some((n) => n.endsWith(' - LI')), docNames.join(' | '));
  check('a content file ends with " - IG"', docNames.some((n) => n.endsWith(' - IG')), docNames.join(' | '));
  check('no leftover full-name " - LinkedIn"/" - Instagram" in filenames', !docNames.some((n) => / - (LinkedIn|Instagram) /.test(n) || n.includes(' - LinkedIn -') || n.includes(' - Instagram -')));

  // delete items
  for (const it of items) { try { await mgql(`mutation($id:ID!){delete_item(item_id:$id){id}}`, { id: it.id }); } catch {} }
  console.log(`\ndeleted ${items.length} item(s)`);
} finally {
  for (const f of trashFolders) { try { await drive.files.update({ fileId: f, requestBody: { trashed: true }, supportsAllDrives: true }); } catch {} }
  if (trashFolders.size) console.log(`trashed ${trashFolders.size} folder(s)`);
  const passed = results.filter((r) => r.pass).length;
  console.log(`\n=== RESULT: ${passed}/${results.length} checks passed ===`);
  if (passed !== results.length || results.length === 0) process.exitCode = 1;
}
