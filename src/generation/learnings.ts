// Flow 7 — narrative generation for the weekly learnings digest + marketing report.
//
// CRITICAL: all numbers and every `n` are computed in code (flows/learningsDigest)
// and passed in here as ground truth. The model ONLY narrates them — it must not
// invent figures, and it must honor the sample-size hedging rules. The deterministic
// stat tables/charts are built by the flow, not here; this produces the prose.

import { completeJSON } from '../clients/anthropic';
import { MIN_COHORT_N } from '../config/learnings';

/** A copy-paste-ready, in-its-lane change the system proposes to the style guide. */
export interface StyleGuideEdit {
  /** Short label, e.g. "Lead Instagram captions with the pain point". */
  title: string;
  /** The exact wording to add/change in the style guide (a human applies it). */
  edit: string;
  /** Why, with the n behind it (and a directional hedge if n < threshold). */
  rationale: string;
}

/** A call OUTSIDE the system's lane — a human (Tommy/Heidi) decides. */
export interface HumanDecision {
  /** topics | voice | platform | cadence | other. */
  area: string;
  recommendation: string;
  rationale: string;
}

export interface LearningsProse {
  /** 2–4 sentence headline summary of the week, grounded in the numbers. */
  execSummary: string;
  /** Interpretation of the cohort comparisons, with mandatory low-n hedges. */
  whatsWorking: string;
  /** In-lane style-guide changes the system proposes (advisory; human applies). */
  proposedStyleGuideEdits: StyleGuideEdit[];
  /** Out-of-lane calls for the humans: topics, voice, platform, cadence. */
  humanDecisions: HumanDecision[];
  /** Patterns across weeks given the prior excerpt, or a "not enough history" note. */
  multiWeekPatterns: string;
}

const SCHEMA = {
  type: 'object',
  properties: {
    execSummary: {
      type: 'string',
      description:
        '2–4 sentences a busy founder can read first: how the week went, the single clearest signal, and the one thing to do next. Quote only numbers from the analysis JSON; cite n on any comparative claim.',
    },
    whatsWorking: {
      type: 'string',
      description:
        'Plain-language interpretation of the cohort comparisons (a few short paragraphs). Quote ONLY numbers present in the analysis JSON. EVERY comparative claim must state the n behind it. For any cohort whose n is below the threshold, explicitly label it "directional only / too early to trust" and never phrase it as a conclusion or a winner. Where a confound is flagged, name it rather than attributing the effect to one variable.',
    },
    proposedStyleGuideEdits: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          title: { type: 'string' },
          edit: { type: 'string', description: 'Exact copy-paste-ready wording to add/change in the style guide.' },
          rationale: { type: 'string', description: 'Why, citing the n; hedge as directional if n < threshold.' },
        },
        required: ['title', 'edit', 'rationale'],
      },
      description:
        'Changes WITHIN your lane — how posts are executed inside the ALREADY-ESTABLISHED brand voice: format, structure, hook style, length, posting day/time, hashtag use, CTA placement. Each is a copy-paste-ready style-guide edit a human will apply (you never apply them yourself). Empty array if nothing clears even a directional bar.',
    },
    humanDecisions: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          area: { type: 'string', description: 'topics | voice | platform | cadence | other' },
          recommendation: { type: 'string' },
          rationale: { type: 'string' },
        },
        required: ['area', 'recommendation', 'rationale'],
      },
      description:
        'Calls OUTSIDE your lane that only the humans (Tommy/Heidi) should make: what TOPICS/ideas to pursue or drop, whether to shift the brand VOICE itself, which PLATFORM to invest in or pull back, overall CADENCE. Recommend with rationale + n, but frame as their decision, not yours. Empty array if nothing rises to a real decision yet.',
    },
    multiWeekPatterns: {
      type: 'string',
      description:
        'Patterns visible across multiple weeks based on the prior-weeks excerpt. If there is no prior history or it is too thin, return exactly "Not enough history yet."',
    },
  },
  required: ['execSummary', 'whatsWorking', 'proposedStyleGuideEdits', 'humanDecisions', 'multiWeekPatterns'],
};

const SYSTEM = `You are the performance analyst for a construction-tech content brand (Takeoff Monkey). Each week you write a marketing report read by the two founders (Tommy and Heidi). It must be genuinely useful, honest, and concrete — never hype.

You are NOT the authority on brand voice — a human-owned style guide is. Split your recommendations into two clearly separate buckets:
- proposedStyleGuideEdits: things IN your lane — how a post is executed within the established voice (format, structure, hook, length, day/time to post, hashtags, CTA). Write each as a copy-paste-ready style-guide change. These are ADVISORY: a human applies them; never say you applied anything.
- humanDecisions: things OUTSIDE your lane — what topics/ideas to chase, whether to change the voice itself, which platform to lean into or drop, the overall cadence. These are the founders' call; you advise, they decide.

Hard rules:
- Use ONLY the numbers in the provided analysis JSON. Never invent or estimate figures.
- Sample-size honesty is the most important rule. The threshold is n=${MIN_COHORT_N}. Any cohort with fewer than ${MIN_COHORT_N} posts behind a metric must be labeled "directional only / too early to trust" and must NOT be stated as a conclusion or a "winner". Do not declare winners off 1–3 posts.
- Every comparative claim must cite its n, e.g. "Personal-voice tips lead on saves (avg 41 vs 12 for brand), but n=3 — directional only."
- When the analysis flags a confound (two dimensions co-varying), name the confound rather than attributing the effect to one variable.
- Be concise and concrete. If the data says little, say that plainly and recommend gathering more before acting.`;

/**
 * Generate the prose sections of the digest/report from the pre-computed analysis.
 * @param analysisJson  Deterministic stats (cohorts, n, mean, median, confounds, weekly trend).
 * @param priorExcerpt  Recent content of the rolling doc (newest-first), or ''.
 */
export async function generateLearnings(
  analysisJson: string,
  priorExcerpt: string,
): Promise<LearningsProse> {
  const user =
    `ANALYSIS (ground truth — quote only these numbers):\n${analysisJson}\n\n` +
    `PRIOR WEEKS (most recent first; may be empty):\n${priorExcerpt || '(none yet)'}\n\n` +
    `Write the report's prose sections per your rules. Threshold n=${MIN_COHORT_N}.`;
  return completeJSON<LearningsProse>(SYSTEM, user, SCHEMA);
}
