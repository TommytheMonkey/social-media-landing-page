// Prints non-secret fingerprints of local env values so you can verify the
// values pasted into Vercel match. Reveals only length + first/last few chars.
// Usage: node scripts/fingerprint-env.mjs
import { readFileSync, existsSync } from 'node:fs';

const env = {};
if (existsSync('.env')) {
  for (const line of readFileSync('.env', 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/);
    if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
}

const KEYS = [
  'MONDAY_API_TOKEN',
  'BUFFER_API_KEY',
  'OPENAI_API_KEY',
  'ANTHROPIC_API_KEY',
  'CRON_SECRET',
  'GOOGLE_SERVICE_ACCOUNT_JSON',
];

console.log('Local env fingerprints (compare each to the value shown in Vercel):\n');
for (const k of KEYS) {
  const v = env[k];
  if (!v) {
    console.log(`${k}: (not set locally)`);
    continue;
  }
  const ws = /\s/.test(v) ? '  ⚠️ CONTAINS WHITESPACE' : '';
  const head = v.slice(0, 8);
  const tail = v.length > 14 ? v.slice(-6) : '';
  console.log(`${k}:`);
  console.log(`   length ${v.length}   starts "${head}…"   ends "…${tail}"${ws}`);
}
