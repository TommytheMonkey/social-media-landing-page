// Validates generatePost (Anthropic tool-use) locally — no Drive/Monday writes.
// Usage: npx tsx scripts/test-gen.ts
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
  const { generatePost } = await import('../src/generation/post');
  const item = {
    id: 'test',
    name: 'Redline a plan sheet from your phone — no laptop on the tailgate',
    description:
      'Show sitework crews they can mark up a PDF plan sheet right on their phone — circle a conflict, drop a dimension note, send it back to the GC in the same minute using the built-in Markup tool. Honest limits: not a replacement for real plan software, big sheets clunky on a small screen.',
    backlink: null,
    platforms: ['LinkedIn'],
    platform: 'LinkedIn',
    voice: 'Takeoff Monkey',
    creationTrigger: 'Create Post!',
    postTrigger: null,
    status: null,
    postDate: null,
    contentText: null,
    hasImage: false,
    imageAssetIds: [],
    folder: null,
    postChecked: false,
  } as any;

  const result = await generatePost(item, 'LinkedIn');
  console.log(`✓ parts: ${result.parts.length}`);
  for (const p of result.parts) {
    console.log(`\n--- part ${p.partNumber}/${p.totalParts} (${p.text.length} chars) ---`);
    console.log(p.text.slice(0, 280));
    console.log(`[imagePrompt] ${p.imagePrompt.slice(0, 140)}`);
  }
}

main().catch((e) => {
  console.error('GEN ERROR:', e instanceof Error ? e.message : e);
  process.exit(1);
});
