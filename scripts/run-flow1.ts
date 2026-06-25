// Local runner for the Flow 1 smoke test: loads .env then runs pollAndCreate().
// Usage: npx tsx scripts/run-flow1.ts
import { readFileSync, existsSync } from 'node:fs';

function loadEnv(): void {
  if (!existsSync('.env')) return;
  for (const line of readFileSync('.env', 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/);
    if (m && !(m[1]! in process.env)) process.env[m[1]!] = m[2]!.replace(/^["']|["']$/g, '');
  }
}

async function main(): Promise<void> {
  loadEnv();
  const { pollAndCreate } = await import('../src/flows/createContent');
  console.log('running Flow 1 (pollAndCreate)…\n');
  const n = await pollAndCreate();
  console.log(`\n✓ Flow 1 finished — handled ${n} "Create Post!" item(s)`);
}

main().catch((e) => {
  console.error('RUN ERROR:', e);
  process.exit(1);
});
