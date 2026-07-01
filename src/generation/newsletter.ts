// Newsletter generation: assembles the week's already-written posts into one
// newsletter (Tommy's voice). Does NOT regenerate post copy — uses it as source
// material. Returns PLAIN TEXT with [IMG - img_n] placeholders where the curated
// images should sit; the branded HTML build (at "Clear!") swaps those in.

import { completeJSON } from '../clients/anthropic';
import { tryLoadAssetText } from '../lib/assets';

const STYLE_GUIDE =
  tryLoadAssetText('assets/brand/style-guide.md') ??
  'Talk to a smart, busy sitework contractor like a foreman who knows tech. Plain words, ' +
    'short sentences, honest about limits, no hype. Sign off "— Tommy, Takeoff Monkey".';

export interface NewsletterSource {
  title: string;
  text: string;
  backlink?: string | null;
}

/** A curated image available to the newsletter, keyed by its imgs/ filename. */
export interface NewsletterImage {
  /** e.g. "img_1" — the placeholder token is [IMG - img_1]. */
  filename: string;
  /** The source post this image came from (helps the writer place it well). */
  sourceTitle: string;
}

export interface GeneratedNewsletter {
  title: string;
  /** Full plain-text body with [IMG - img_n] placeholders where images belong. */
  text: string;
  /** 3–5 sentence summary of the newsletter (for the Monday Description column). */
  summary: string;
}

const NEWSLETTER_SCHEMA = {
  type: 'object',
  properties: {
    title: { type: 'string', description: "The newsletter's subject line / title." },
    text: {
      type: 'string',
      description:
        'The full plain-text newsletter body, ready to review. Insert image placeholders on their own line, exactly [IMG - img_1] etc., using only the provided image filenames.',
    },
    summary: {
      type: 'string',
      description: 'A 3-5 sentence plain summary of what this newsletter covers (for an internal Description field).',
    },
  },
  required: ['title', 'text', 'summary'],
};

function systemPrompt(images: NewsletterImage[]): string {
  const imageLines = images.length
    ? images.map((im) => `- ${im.filename}  (from: ${im.sourceTitle})`).join('\n')
    : '(none)';
  return [
    'You are the Takeoff Monkey weekly newsletter writer. Voice = Tommy (always).',
    '',
    '=== STYLE GUIDE ===',
    STYLE_GUIDE,
    '=== END STYLE GUIDE ===',
    '',
    'Assemble the provided posts into ONE cohesive weekly newsletter:',
    '- A short, warm intro (a sentence or two — what this week is about).',
    "- Each post becomes its own short section: keep the tip's substance and any real link.",
    '- A closing nudge to keep using the tips, then the sign-off "— Tommy, Takeoff Monkey".',
    '',
    'IMAGES — available to place in the body (use each at most once, only where it fits;',
    'you do NOT have to use them all):',
    imageLines,
    'To place an image, put its placeholder ON ITS OWN LINE exactly like: [IMG - img_1]',
    'Never invent an image filename that is not in the list above.',
    '',
    'Keep the brand voice: plain, jobsite-direct, honest about limits, no hype, no guilt.',
    'NEVER invent links, tools, prices, or features — only use links provided. If you',
    'reference the newsletter signup, use the literal "[SUBSCRIBE LINK]" placeholder.',
    '',
    'Also return a 3-5 sentence plain "summary" of the newsletter for an internal field.',
    'Return your result by calling the submit_result tool with title, text, and summary.',
  ].join('\n');
}

function userPrompt(sources: NewsletterSource[]): string {
  const blocks = sources.map((s, i) => {
    const lines = [`--- Source ${i + 1}: ${s.title} ---`, s.text];
    if (s.backlink) lines.push(`Link: ${s.backlink}`);
    return lines.join('\n');
  });
  return `Assemble these ${sources.length} post(s) into this week's newsletter:\n\n${blocks.join('\n\n')}`;
}

export async function generateNewsletter(
  sources: NewsletterSource[],
  images: NewsletterImage[] = [],
): Promise<GeneratedNewsletter> {
  const raw = await completeJSON<{ title?: unknown; text?: unknown; summary?: unknown }>(
    systemPrompt(images),
    userPrompt(sources),
    NEWSLETTER_SCHEMA,
  );
  const text = typeof raw.text === 'string' ? raw.text.trim() : '';
  if (text.length === 0) throw new Error('Newsletter generation returned no text');
  const title = typeof raw.title === 'string' && raw.title.trim().length > 0
    ? raw.title.trim()
    : "Takeoff Monkey — This Week's Tips";
  const summary = typeof raw.summary === 'string' ? raw.summary.trim() : '';
  return { title, text, summary };
}
