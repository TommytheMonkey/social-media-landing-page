// Debug: dump exactly what completeJSON returns for the real post prompt.
// Usage: npx tsx scripts/debug-gen.ts
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
  const { completeJSON } = await import('../src/clients/anthropic');
  const { systemPrompt, userPrompt } = await import('../src/generation/post');
  const schema = {
    type: 'object',
    properties: { parts: { type: 'array', minItems: 1, maxItems: 6, items: { type: 'object', properties: { text: { type: 'string' }, imagePrompt: { type: 'string' } }, required: ['text', 'imagePrompt'] } } },
    required: ['parts'],
  };
  const item = { name: 'Redline a plan sheet from your phone', description: 'Mark up a PDF plan sheet on your phone.', backlink: null, voice: 'Takeoff Monkey' } as any;

  const result: any = await completeJSON(systemPrompt('LinkedIn'), userPrompt(item), schema);
  console.log('top-level keys:', Object.keys(result));
  console.log('typeof result.parts:', typeof result.parts, 'isArray:', Array.isArray(result.parts));
  console.log('result.parts (raw):', JSON.stringify(result.parts).slice(0, 600));
}

main().catch((e) => { console.error('ERR:', e instanceof Error ? e.message : e); process.exit(1); });
