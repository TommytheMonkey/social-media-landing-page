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
 * Get a schema-valid structured object from the model using tool-use. Forcing a
 * tool call makes the API return well-formed JSON matching `schema` — far more
 * robust than parsing free-text JSON (which breaks on unescaped newlines/quotes).
 */
export async function completeJSON<T>(
  system: string,
  user: string,
  schema: Record<string, unknown>,
): Promise<T> {
  const msg = await anthropic().messages.create({
    model: MODEL,
    max_tokens: MAX_TOKENS,
    system,
    messages: [{ role: 'user', content: user }],
    tools: [
      {
        name: 'submit_result',
        description: 'Return the structured result for this request.',
        input_schema: schema as Anthropic.Tool.InputSchema,
      },
    ],
    tool_choice: { type: 'tool', name: 'submit_result' },
  });
  const tool = msg.content.find((b): b is Anthropic.ToolUseBlock => b.type === 'tool_use');
  if (!tool) throw new Error('Model did not return a tool_use result');
  return tool.input as T;
}
