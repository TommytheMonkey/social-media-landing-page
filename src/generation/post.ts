// Social post copy generation (phase 1). Reuses the shared anthropic client so
// newsletter/blog generators can sit beside it later.

import type { MondayItem, Platform, GeneratedPost, GeneratedPart } from '../types';
import { completeJSON } from '../clients/anthropic';
import { tryLoadAssetText } from '../lib/assets';

const STYLE_GUIDE = tryLoadAssetText('assets/brand/style-guide.md') ??
  'Talk to a smart, busy sitework contractor like a foreman who knows tech. ' +
  'Solve one real annoyance, show exact steps with real links, be honest about ' +
  'limits, point them to the newsletter. Plain words, short sentences, no hype, ' +
  'no guilt. Sign off "— Tommy, TakeoffMonkey".';

const PLATFORM_RULES: Record<Platform, string> = {
  LinkedIn:
    'LinkedIn: pain-first hook; 2–3 concrete teaching steps with a real named tool; ' +
    'an honest limitation; one engagement question; 3–4 hashtags; newsletter CTA; ' +
    'sign-off "— Tommy, TakeoffMonkey". Medium length, teach-a-peer tone.',
  Instagram:
    'Instagram: tighter and punchier, scroll-stopping; scannable lines (emoji bullets ok); ' +
    'the win in a few lines then the honest limit in one; 1–2 hashtags + 🍌; newsletter CTA; ' +
    'sign-off "— Tommy, TakeoffMonkey". Short.',
};

// Flat schema (top-level string fields). A nested array caused Claude to
// occasionally return it as a malformed JSON string, so we generate ONE post per
// (item, platform). Multi-part splitting can be re-added later via separate calls.
const POST_SCHEMA = {
  type: 'object',
  properties: {
    text: { type: 'string', description: 'The full post copy, ready to publish.' },
    imagePrompt: { type: 'string', description: 'Photoreal, text-free image prompt for the post.' },
  },
  required: ['text', 'imagePrompt'],
};

export function systemPrompt(platform: Platform): string {
  return [
    'You are the TakeoffMonkey social copywriter. Write in the brand voice below.',
    '',
    '=== STYLE GUIDE ===',
    STYLE_GUIDE,
    '=== END STYLE GUIDE ===',
    '',
    `Target platform: ${platform}.`,
    PLATFORM_RULES[platform],
    '',
    'Write ONE post. Never invent links, tool names, prices, or features. Only use a link ' +
      'if it was provided to you. If you reference the newsletter, use the literal ' +
      '"[SUBSCRIBE LINK]" placeholder.',
    'Also write an imagePrompt: a vivid, PHOTOREAL, TEXT-FREE prompt for a real commercial ' +
      'sitework scene relevant to the post (no text, no logos, no words in the image).',
    '',
    'Return your result by calling the submit_result tool with the post text and imagePrompt.',
  ].join('\n');
}

export function userPrompt(item: MondayItem): string {
  const lines = [
    `Topic / title: ${item.name}`,
    `Idea / description: ${item.description ?? '(none)'}`,
  ];
  if (item.backlink?.url) lines.push(`Link to include: ${item.backlink.url}`);
  if (item.voice) lines.push(`Voice / persona: ${item.voice}`);
  return lines.join('\n');
}

export async function generatePost(item: MondayItem, platform: Platform): Promise<GeneratedPost> {
  const raw = await completeJSON<{ text?: unknown; imagePrompt?: unknown }>(
    systemPrompt(platform),
    userPrompt(item),
    POST_SCHEMA,
  );
  const text = typeof raw.text === 'string' ? raw.text.trim() : '';
  const imagePrompt = typeof raw.imagePrompt === 'string' ? raw.imagePrompt.trim() : '';
  if (text.length === 0) throw new Error('Generation returned no post text');

  const part: GeneratedPart = { partNumber: 1, totalParts: 1, text, imagePrompt };
  return { platform, parts: [part] };
}
