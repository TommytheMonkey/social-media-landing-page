// OpenAI gpt-image-1 — generates the text-free photoreal base image.
// The white logo is composited afterward in generation/image.ts (never let the
// model render text/logos — the style guide forbids it).

import OpenAI from 'openai';

let client: OpenAI | null = null;
function openai(): OpenAI {
  if (!process.env.OPENAI_API_KEY) throw new Error('OPENAI_API_KEY is not set');
  client ??= new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  return client;
}

export interface GeneratedImage {
  bytes: Buffer;
  contentType: string;
}

/** Generate a 1024x1024 base image. gpt-image-1 returns base64 PNG. */
export async function generateBaseImage(prompt: string): Promise<GeneratedImage> {
  const res = await openai().images.generate({
    model: 'gpt-image-1',
    prompt,
    size: '1024x1024',
    n: 1,
  });
  const b64 = res.data?.[0]?.b64_json;
  if (!b64) throw new Error('gpt-image-1 returned no image data');
  return { bytes: Buffer.from(b64, 'base64'), contentType: 'image/png' };
}
