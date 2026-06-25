// One-shot helper: replace a broken/multi-line GOOGLE_SERVICE_ACCOUNT_JSON in
// .env with a single-line base64 of the creds file, and strip orphan JSON
// fragment lines left by a multi-line paste. Backs up .env first. No secrets printed.
//   node scripts/fix-google-env.mjs [credsPath=google-creds.json] [envPath=.env]
import { readFileSync, writeFileSync, existsSync, copyFileSync } from 'node:fs';

const credsPath = process.argv[2] || 'google-creds.json';
const envPath = process.argv[3] || '.env';

for (const [label, p] of [['creds', credsPath], ['.env', envPath]]) {
  if (!existsSync(p)) {
    console.error(`✗ ${label} not found: ${p}`);
    process.exit(1);
  }
}

const credsRaw = readFileSync(credsPath, 'utf8');
let creds;
try {
  creds = JSON.parse(credsRaw);
} catch {
  console.error('✗ creds file is not valid JSON');
  process.exit(1);
}
if (!creds.client_email || !creds.private_key) {
  console.error('✗ creds missing client_email/private_key');
  process.exit(1);
}
const b64 = Buffer.from(credsRaw, 'utf8').toString('base64');

const backup = process.env.BACKUP_PATH || `${envPath}.bak`;
copyFileSync(envPath, backup);

const kept = [];
let replaced = false;
let dropped = 0;
for (const line of readFileSync(envPath, 'utf8').split('\n')) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=/);
  if (m && m[1] === 'GOOGLE_SERVICE_ACCOUNT_JSON') {
    kept.push(`GOOGLE_SERVICE_ACCOUNT_JSON=${b64}`);
    replaced = true;
    continue;
  }
  if (m) { kept.push(line); continue; } // other KEY=VALUE line
  if (line.trim() === '' || line.trimStart().startsWith('#')) { kept.push(line); continue; }
  dropped++; // orphan JSON fragment from the broken paste
}
if (!replaced) kept.push(`GOOGLE_SERVICE_ACCOUNT_JSON=${b64}`);

writeFileSync(envPath, kept.join('\n').replace(/\n*$/, '\n'));
console.log(`✓ wrote single-line base64 GOOGLE_SERVICE_ACCOUNT_JSON (${b64.length} chars)`);
console.log(`✓ client_email: ${creds.client_email}`);
console.log(`✓ backup of original .env -> ${backup}`);
console.log(`✓ removed ${dropped} orphan JSON fragment line(s)`);
