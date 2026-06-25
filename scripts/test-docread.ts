// Validates the new Doc-read path (resolvePostTextFromDoc + wordCount) against a
// real Monday item, using the actual code. Usage: npx tsx scripts/test-docread.ts <itemId>
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
  const id = process.argv[2] || '12368112898';
  const monday = await import('../src/clients/monday');
  const { parseItem, READ_COLUMN_IDS } = await import('../src/domain/item');
  const { resolvePostTextFromDoc, wordCount } = await import('../src/flows/sendShared');

  const [raw] = await monday.getItems([id], READ_COLUMN_IDS);
  if (!raw) throw new Error('item not found');
  const item = parseItem(raw);
  console.log('folder:', item.folder?.url);

  const text = await resolvePostTextFromDoc(item);
  console.log(`\nword count: ${wordCount(text)}\n--- doc text ---\n${text}\n----------------`);
}

main().catch((e) => {
  console.error('ERROR:', e instanceof Error ? e.message : e);
  process.exit(1);
});
