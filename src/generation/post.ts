// Social post copy generation (phase 1). Reuses the shared anthropic client so
// newsletter/blog generators can sit beside it later.

import type { MondayItem, Platform, GeneratedPost, GeneratedPart } from '../types';
import { completeJSON } from '../clients/anthropic';
import { tryLoadAssetText } from '../lib/assets';
import { MAX_PARTS } from '../config/schedule';

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

interface RawGen {
  parts: Array<{ text: string; imagePrompt: string }>;
}

function systemPrompt(platform: Platform): string {
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
    'Most posts are a SINGLE part. Only split into multiple parts when the topic is ' +
      `genuinely a multi-part thread/carousel, and never exceed ${MAX_PARTS} parts.`,
    'Never invent links, tool names, prices, or features. Only use a link if it was ' +
      'provided to you. If you reference the newsletter, use the literal "[SUBSCRIBE LINK]" placeholder.',
    'For each part also write an imagePrompt: a vivid, PHOTOREAL, TEXT-FREE prompt for a ' +
      'real commercial sitework scene relevant to the post (no text, no logos, no words in the image).',
    '',
    'Respond with ONLY a JSON object of this exact shape:',
    '{ "parts": [ { "text": "<the post copy>", "imagePrompt": "<image prompt>" } ] }',
  ].join('\n');
}

function userPrompt(item: MondayItem): string {
  const lines = [
    `Topic / title: ${item.name}`,
    `Idea / description: ${item.description ?? '(none)'}`,
  ];
  if (item.backlink?.url) lines.push(`Link to include: ${item.backlink.url}`);
  if (item.voice) lines.push(`Voice / persona: ${item.voice}`);
  return lines.join('\n');
}

export async function generatePost(item: MondayItem, platform: Platform): Promise<GeneratedPost> {
  const raw = await completeJSON<RawGen>(systemPrompt(platform), userPrompt(item));
  const rawParts = Array.isArray(raw.parts) ? raw.parts.slice(0, MAX_PARTS) : [];
  if (rawParts.length === 0) throw new Error('Generation returned no parts');

  const total = rawParts.length;
  const parts: GeneratedPart[] = rawParts.map((p, i) => ({
    partNumber: i + 1,
    totalParts: total,
    text: (p.text ?? '').trim(),
    imagePrompt: (p.imagePrompt ?? '').trim(),
  }));
  return { platform, parts };
}
