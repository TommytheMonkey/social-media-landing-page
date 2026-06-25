// Live test of Flow 7 (weekly learnings digest). Waits for the deploy, seeds ~9
// Live LinkedIn/Instagram items with controlled Voice/Post Type/Post Date + pre-filled
// metric columns, triggers /api/cron/learnings, reads the produced "Performance
// Learnings" Doc and asserts structure (4 dimensions, n's, directional hedges,
// advisory framing, candidate learnings). Cleans up: deletes items + trashes the
// test Doc so the real digest starts fresh. Usage: node scripts/test-learnings.mjs <sha>
import { readFileSync, existsSync } from 'node:fs';
import { google } from 'googleapis';

const env = {};
if (existsSync('.env')) {
  for (const line of readFileSync('.env', 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/);
    if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
}
const vToken = env.VERCEL_TOKEN, mToken = env.MONDAY_API_TOKEN, secret = env.CRON_SECRET;
const SHA = process.argv[2] || '';
const BOARD = '18411954205';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const C = { status: 'status', platform: 'dropdown_mm33c63g', voice: 'color_mm4m94nw', postType: 'dropdown_mm4nwd5y', postDate: 'date_mm33qjbw',
  reach: 'numeric_mm4nx20v', comments: 'numeric_mm4n1bnd', reactions: 'numeric_mm4nfqmk', shares: 'numeric_mm4n3xx3', saves: 'numeric_mm4ny7ja', impressions: 'numeric_mm4nbe6q' };

async function vapi(p) { return (await fetch('https://api.vercel.com' + p, { headers: { Authorization: `Bearer ${vToken}` } })).json(); }
async function mgql(q, v) {
  const r = await fetch('https://api.monday.com/v2', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: mToken, 'API-Version': '2026-04' }, body: JSON.stringify({ query: q, variables: v }) });
  const b = await r.json(); if (b.errors) throw new Error(JSON.stringify(b.errors)); return b.data;
}
async function createItem(name, vals) {
  const d = await mgql(`mutation($b:ID!,$n:String!,$v:JSON!){create_item(board_id:$b,item_name:$n,column_values:$v,create_labels_if_missing:true){id}}`, { b: BOARD, n: name, v: JSON.stringify(vals) });
  return d.create_item.id;
}
const driveClient = () => {
  const creds = (() => { const raw = env.GOOGLE_SERVICE_ACCOUNT_JSON; return JSON.parse(raw.trim().startsWith('{') ? raw : Buffer.from(raw, 'base64').toString('utf8')); })();
  const auth = new google.auth.JWT({ email: creds.client_email, key: creds.private_key, scopes: ['https://www.googleapis.com/auth/drive', 'https://www.googleapis.com/auth/documents'] });
  return google.drive({ version: 'v3', auth });
};

const results = [];
const check = (name, pass, extra = '') => { results.push({ name, pass }); console.log(`  ${pass ? '✅' : '❌'} ${name}${extra ? ' — ' + extra : ''}`); };

// 9 controlled posts: vary POV, Post Type, Day-of-week, holiday proximity. LinkedIn
// items leave saves/shares empty (missing != zero); Instagram items set saves.
const SEED = [
  { n: 'LRN tip tommy',     v: 'Tommy',          p: 'LinkedIn',  t: 'Tip / Trick / Hack',   d: '2026-06-22', reach: 500, react: 20, com: 3, imp: 3000 },
  { n: 'LRN tip heidi',     v: 'Heidi',          p: 'LinkedIn',  t: 'Tip / Trick / Hack',   d: '2026-06-23', reach: 300, react: 10, com: 1, imp: 2000 },
  { n: 'LRN howto brand',   v: 'Takeoff Monkey', p: 'LinkedIn',  t: 'How-to / Playbook',    d: '2026-06-24', reach: 800, react: 5,  com: 0, imp: 5000 },
  { n: 'LRN review hybrid', v: 'Tommy + TOM',    p: 'Instagram', t: 'Product Review',       d: '2026-06-21', reach: 400, react: 30, com: 2, imp: 2500, saves: 15 },
  { n: 'LRN tip brand hol', v: 'Takeoff Monkey', p: 'LinkedIn',  t: 'Tip / Trick / Hack',   d: '2026-06-20', reach: 200, react: 8,  com: 1, imp: 1500 },
  { n: 'LRN howto tommy h', v: 'Tommy',          p: 'LinkedIn',  t: 'How-to / Playbook',    d: '2026-06-19', reach: 600, react: 12, com: 2, imp: 3500 },
  { n: 'LRN review heidi',  v: 'Heidi',          p: 'Instagram', t: 'Product Review',       d: '2026-06-18', reach: 350, react: 25, com: 4, imp: 2200, saves: 20 },
  { n: 'LRN tip tbd',       v: 'TBD',            p: 'LinkedIn',  t: 'Tip / Trick / Hack',   d: '2026-06-24', reach: 100, react: 2,  com: 0, imp: 900 },
  { n: 'LRN howto old',     v: 'Takeoff Monkey', p: 'LinkedIn',  t: 'How-to / Playbook',    d: '2026-06-15', reach: 700, react: 6,  com: 1, imp: 4200 },
];

// --- wait for deploy ---
const teams = (await vapi('/v2/teams')).teams || [];
const teamId = (teams.find((t) => t.slug === 'takeoff-monkey') || teams[0])?.id;
let ready = false;
for (let i = 0; i < 30; i++) {
  const list = (await vapi(`/v6/deployments?app=social-media-landing-page&target=production&limit=10&teamId=${teamId}`)).deployments || [];
  const d = SHA ? list.find((x) => x.meta?.githubCommitSha === SHA) : list[0];
  const st = d?.readyState || d?.state || 'none';
  console.log(`deploy poll ${i + 1}: ${st}`);
  if (st === 'READY') { ready = true; break; }
  if (st === 'ERROR') { console.log('DEPLOY FAILED'); process.exit(1); }
  await sleep(10000);
}
if (!ready) { console.log('deploy not ready'); process.exit(1); }

const cleanup = [];
let docId;
try {
  for (const s of SEED) {
    const vals = { [C.status]: { label: 'Live!' }, [C.platform]: { labels: [s.p] }, [C.voice]: { label: s.v }, [C.postType]: { labels: [s.t] }, [C.postDate]: { date: s.d },
      [C.reach]: String(s.reach), [C.reactions]: String(s.react), [C.comments]: String(s.com), [C.impressions]: String(s.imp) };
    if (s.saves != null) vals[C.saves] = String(s.saves);
    cleanup.push(await createItem(s.n, vals));
  }
  console.log(`created ${cleanup.length} seed items; triggering /api/cron/learnings...`);

  const ctrl = new AbortController(); const t = setTimeout(() => ctrl.abort(), 115000);
  const resp = await fetch('https://letsgo.takeo.co/api/cron/learnings', { headers: { Authorization: `Bearer ${secret}` }, signal: ctrl.signal });
  clearTimeout(t);
  const summary = JSON.parse(await resp.text());
  console.log('summary:', JSON.stringify(summary));
  docId = (summary.docUrl || '').match(/document\/d\/([^/]+)/)?.[1];

  check('summary.livePosts >= 9', (summary.livePosts || 0) >= 9, `livePosts=${summary.livePosts}`);
  check('summary has 4 dimensions', (summary.dimensions || []).length === 4, JSON.stringify(summary.dimensions));
  check('got a doc id', Boolean(docId), summary.docUrl);

  if (docId) {
    const txt = (await driveClient().files.export({ fileId: docId, mimeType: 'text/plain' }, { responseType: 'text' })).data;
    const has = (s) => txt.includes(s);
    console.log(`\n--- digest doc (${txt.length}c), top 1800 chars ---\n${txt.slice(0, 1800)}\n...`);
    check('header present', has('Performance Learnings — week ending'));
    check('ADVISORY framing present', has('ADVISORY'));
    check("dimension: POV", has('### POV'));
    check('dimension: Post Type', has('### Post Type'));
    check('dimension: Day of Week', has('### Day of Week'));
    check('dimension: Holiday proximity', has('### Holiday proximity'));
    check('POV cohorts present', has('Personal') && has('Brand') && has('Hybrid'));
    check('near-holiday cohort present', has('Near holiday'));
    check('n= counts present', /n=\d+/.test(txt));
    check('directional hedge present (all cohorts < 8)', has('directional'));
    check('candidate learnings section', has('Candidate learnings'));
    check('multi-week patterns section', has('Multi-week patterns'));
    check("this week's posts section", has("This week's posts"));
  }
} finally {
  console.log('\n=== cleanup ===');
  for (const id of cleanup) { try { await mgql(`mutation($id:ID!){delete_item(item_id:$id){id}}`, { id }); } catch {} }
  console.log(`deleted ${cleanup.length} item(s)`);
  if (docId) { try { await driveClient().files.update({ fileId: docId, requestBody: { trashed: true }, supportsAllDrives: true }); console.log('trashed test digest doc'); } catch (e) { console.log('doc trash failed:', e.message); } }
  const passed = results.filter((r) => r.pass).length;
  console.log(`\n=== RESULT: ${passed}/${results.length} checks passed ===`);
  if (passed !== results.length) process.exitCode = 1;
}
