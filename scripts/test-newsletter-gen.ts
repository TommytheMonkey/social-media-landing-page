// Validates generateNewsletter (tool-use) locally — no Monday/Drive writes.
// Usage: npx tsx scripts/test-newsletter-gen.ts
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
  const { generateNewsletter } = await import('../src/generation/newsletter');
  const sources = [
    { title: 'Your iPhone is a tape measure', text: 'Use the Measure app for a rough pad width on a graded lot. Fine for "about 40 foot," not for a cut list. — Tommy, TakeoffMonkey', backlink: null },
    { title: 'Redline a plan sheet from your phone', text: 'Mark up a PDF plan sheet in Adobe Acrobat Reader right from your phone — circle a conflict, send it back. Not a replacement for real plan software.', backlink: 'https://acrobat.adobe.com' },
  ];
  const r = await generateNewsletter(sources);
  console.log(`✓ title: ${r.title}`);
  console.log(`✓ text: ${r.text.length} chars\n--- newsletter ---\n${r.text.slice(0, 600)}\n...`);
}

main().catch((e) => { console.error('GEN ERROR:', e instanceof Error ? e.message : e); process.exit(1); });
