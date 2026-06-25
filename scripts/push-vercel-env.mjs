// Pushes env vars from local .env straight into Vercel (production + preview) via
// the Vercel API — exact bytes, no manual paste, no trailing-newline issues.
// Requires VERCEL_TOKEN in .env. Usage: node scripts/push-vercel-env.mjs
import { readFileSync, existsSync } from 'node:fs';

const env = {};
if (existsSync('.env')) {
  for (const line of readFileSync('.env', 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/);
    if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
}
const token = env.VERCEL_TOKEN;
if (!token) {
  console.error('Add VERCEL_TOKEN=<your token> to .env first (vercel.com/account/tokens).');
  process.exit(1);
}

const PROJECT = 'social-media-landing-page';
const VARS = [
  'MONDAY_API_TOKEN',
  'ANTHROPIC_API_KEY',
  'OPENAI_API_KEY',
  'BUFFER_API_KEY',
  'GOOGLE_SERVICE_ACCOUNT_JSON',
  'CRON_SECRET',
];

async function api(path, opts = {}) {
  const res = await fetch('https://api.vercel.com' + path, {
    ...opts,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...(opts.headers || {}) },
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`${path} -> HTTP ${res.status}: ${JSON.stringify(body).slice(0, 300)}`);
  return body;
}

// Find the team that owns the project (preview URL implied the "takeoff-monkey" team).
const teams = (await api('/v2/teams')).teams || [];
const team = teams.find((t) => t.slug === 'takeoff-monkey') || teams[0];
const teamId = team?.id;
console.log(`team: ${team?.slug ?? '(personal)'} ${teamId ?? ''}`);
const q = teamId ? `?teamId=${teamId}&upsert=true` : '?upsert=true';

for (const key of VARS) {
  const value = env[key];
  if (!value) {
    console.log(`· skip ${key} (not in local .env)`);
    continue;
  }
  await api(`/v10/projects/${PROJECT}/env${q}`, {
    method: 'POST',
    body: JSON.stringify({ key, value, type: 'encrypted', target: ['production', 'preview'] }),
  });
  console.log(`✓ set ${key} (${value.length} chars)`);
}
console.log('\nDone. A fresh deploy is needed for these to take effect.');
