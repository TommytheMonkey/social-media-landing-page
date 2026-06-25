// Anthropic (Claude) — post-copy generation. Kept generic; prompt construction
// lives in generation/post.ts so newsletter/blog can reuse this client later.

import Anthropic from '@anthropic-ai/sdk';

// Sonnet is plenty for social copy and cheaper than Opus. Adjust if desired.
const MODEL = 'claude-sonnet-4-6';
const MAX_TOKENS = 4096;

let client: Anthropic | null = null;
function anthropic(): Anthropic {
  if (!process.env.ANTHROPIC_API_KEY) throw new Error('ANTHROPIC_API_KEY is not set');
  client ??= new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  return client;
}

/** Run a single-turn completion and return the concatenated text output. */
export async function complete(system: string, user: string): Promise<string> {
  const msg = await anthropic().messages.create({
    model: MODEL,
    max_tokens: MAX_TOKENS,
    system,
    messages: [{ role: 'user', content: user }],
  });
  return msg.content
    .filter((b): b is Anthropic.TextBlock => b.type === 'text')
    .map((b) => b.text)
    .join('');
}

/**
 * Run a completion expected to return a single JSON object and parse it.
 * Tolerates ```json fences and leading/trailing prose by extracting the first
 * balanced {...} block.
 */
export async function completeJSON<T>(system: string, user: string): Promise<T> {
  const raw = await complete(system, user);
  return parseJsonObject<T>(raw);
}

function parseJsonObject<T>(raw: string): T {
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced ? fenced[1]! : raw;
  const start = candidate.indexOf('{');
  const end = candidate.lastIndexOf('}');
  if (start === -1 || end === -1 || end < start) {
    throw new Error(`Model did not return JSON: ${raw.slice(0, 300)}`);
  }
  return JSON.parse(candidate.slice(start, end + 1)) as T;
}
