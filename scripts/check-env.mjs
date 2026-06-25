// Validates .env for the content-engine automation WITHOUT printing any secret
// values. Run: node scripts/check-env.mjs   (optionally: node scripts/check-env.mjs path/to/.env)
import { readFileSync, existsSync } from 'node:fs';

const path = process.argv[2] || '.env';
if (!existsSync(path)) {
  console.error(`No env file at ${path}`);
  process.exit(1);
}

// Minimal parser: KEY=value per line. Multi-line/unquoted values won't parse —
// which is exactly what we want to detect for the Google JSON.
const env = {};
for (const line of readFileSync(path, 'utf8').split('\n')) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/);
  if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, '');
}

const required = [
  'MONDAY_API_TOKEN',
  'ANTHROPIC_API_KEY',
  'BUFFER_API_KEY',
  'OPENAI_API_KEY',
  'GOOGLE_SERVICE_ACCOUNT_JSON',
];
const operational = ['BLOB_READ_WRITE_TOKEN', 'CRON_SECRET'];

const mask = (v) => (v && v.length ? `set (${v.length} chars)` : 'MISSING');
let ok = true;

console.log('— Required to run —');
for (const k of required) {
  const present = !!env[k] && env[k].length > 0;
  if (!present) ok = false;
  console.log(`  ${present ? '✓' : '✗'} ${k}: ${mask(env[k])}`);
}

console.log('— Required for full operation —');
for (const k of operational) {
  const present = !!env[k] && env[k].length > 0;
  console.log(`  ${present ? '✓' : '·'} ${k}: ${mask(env[k])}`);
}
console.log('  (BLOB_READ_WRITE_TOKEN is optional on Vercel — OIDC via BLOB_STORE_ID');
console.log('   + VERCEL_OIDC_TOKEN is used automatically there. Store must be PUBLIC.)');

// Deep-check the Google creds without exposing the key.
console.log('— Google service account —');
const g = env['GOOGLE_SERVICE_ACCOUNT_JSON'];
if (!g) {
  console.log('  ✗ GOOGLE_SERVICE_ACCOUNT_JSON not set');
  ok = false;
} else {
  let creds = null;
  try {
    creds = JSON.parse(g.trim().startsWith('{') ? g : Buffer.from(g, 'base64').toString('utf8'));
  } catch {
    /* noop */
  }
  if (creds && creds.client_email && creds.private_key) {
    console.log('  ✓ parses OK');
    console.log(`    client_email: ${creds.client_email}`);
    console.log(`    project_id:   ${creds.project_id || '(none)'}`);
    console.log(`    private_key:  ${creds.private_key.includes('BEGIN PRIVATE KEY') ? 'present' : 'LOOKS WRONG'}`);
  } else {
    console.log('  ✗ does NOT parse as service-account JSON.');
    console.log('    Likely cause: a multi-line paste got truncated by the env loader.');
    console.log('    Fix: store it base64-encoded on ONE line (see instructions).');
    ok = false;
  }
}

console.log(ok ? '\nAll required values present.' : '\nSome required values are missing/invalid.');
process.exit(ok ? 0 : 1);
