// Newsletter generation: assembles the week's already-written posts into one
// newsletter (Tommy's voice). Does NOT regenerate post copy — uses it as source
// material. Reuses the shared anthropic client + tool-use (flat schema).

import { completeJSON } from '../clients/anthropic';
import { tryLoadAssetText } from '../lib/assets';

const STYLE_GUIDE =
  tryLoadAssetText('assets/brand/style-guide.md') ??
  'Talk to a smart, busy sitework contractor like a foreman who knows tech. Plain words, ' +
    'short sentences, honest about limits, no hype. Sign off "— Tommy, TakeoffMonkey".';

export interface NewsletterSource {
  title: string;
  text: string;
  backlink?: string | null;
}

export interface GeneratedNewsletter {
  title: string;
  text: string;
}

const NEWSLETTER_SCHEMA = {
  type: 'object',
  properties: {
    title: { type: 'string', description: "The newsletter's subject line / title." },
    text: { type: 'string', description: 'The full newsletter body, ready to review and send.' },
  },
  required: ['title', 'text'],
};

function systemPrompt(): string {
  return [
    'You are the TakeoffMonkey weekly newsletter writer. Voice = Tommy (always).',
    '',
    '=== STYLE GUIDE ===',
    STYLE_GUIDE,
    '=== END STYLE GUIDE ===',
    '',
    'Assemble the provided posts into ONE cohesive weekly newsletter:',
    '- A short, warm intro (a sentence or two — what this week is about).',
    "- Each post becomes its own short section: keep the tip's substance and any real link.",
    '- A closing nudge to keep using the tips, then the sign-off "— Tommy, TakeoffMonkey".',
    '',
    'Keep the brand voice: plain, jobsite-direct, honest about limits, no hype, no guilt.',
    'NEVER invent links, tools, prices, or features — only use links provided. If you',
    'reference the newsletter signup, use the literal "[SUBSCRIBE LINK]" placeholder.',
    '',
    'Return your result by calling the submit_result tool with the title and text.',
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

export async function generateNewsletter(sources: NewsletterSource[]): Promise<GeneratedNewsletter> {
  const raw = await completeJSON<{ title?: unknown; text?: unknown }>(
    systemPrompt(),
    userPrompt(sources),
    NEWSLETTER_SCHEMA,
  );
  const text = typeof raw.text === 'string' ? raw.text.trim() : '';
  if (text.length === 0) throw new Error('Newsletter generation returned no text');
  const title = typeof raw.title === 'string' && raw.title.trim().length > 0
    ? raw.title.trim()
    : "TakeoffMonkey — This Week's Tips";
  return { title, text };
}
