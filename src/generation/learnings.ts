// Flow 7 — narrative generation for the weekly learnings digest.
//
// CRITICAL: all numbers and every `n` are computed in code (flows/learningsDigest)
// and passed in here as ground truth. The model ONLY narrates them — it must not
// invent figures, and it must honor the sample-size hedging rules. The deterministic
// stat tables are rendered by the flow, not here; this produces the prose sections.

import { completeJSON } from '../clients/anthropic';
import { MIN_COHORT_N } from '../config/learnings';

export interface LearningsProse {
  /** Interpretation of the cohort comparisons, with mandatory low-n hedges. */
  whatsWorking: string;
  /** Suggestions for human review only — never framed as automatic changes. */
  candidateLearnings: string[];
  /** Patterns across weeks given the prior excerpt, or a "not enough history" note. */
  multiWeekPatterns: string;
}

const SCHEMA = {
  type: 'object',
  properties: {
    whatsWorking: {
      type: 'string',
      description:
        'Plain-language interpretation of the cohort comparisons (a few short paragraphs). Quote ONLY numbers present in the provided analysis JSON. EVERY comparative claim must state the n behind it. For any cohort whose n is below the threshold, explicitly label it "directional only / too early to trust" and never phrase it as a conclusion or a winner. Where a confound is flagged, name it rather than attributing the effect to one variable.',
    },
    candidateLearnings: {
      type: 'array',
      items: { type: 'string' },
      description:
        'Short bullet suggestions that, IF they hold up with more data, MIGHT be worth promoting into the style guide — explicitly framed as suggestions for human review, never automatic changes. Each must include the n behind it. Return an empty array if nothing clears even a directional bar.',
    },
    multiWeekPatterns: {
      type: 'string',
      description:
        'Patterns visible across multiple weeks based on the prior-weeks excerpt. If there is no prior history or it is too thin, return exactly "Not enough history yet."',
    },
  },
  required: ['whatsWorking', 'candidateLearnings', 'multiWeekPatterns'],
};

const SYSTEM = `You are a careful performance analyst for a construction-tech content brand (TakeoffMonkey). You write an ADVISORY weekly digest that helps a human decide what content is working. You are NOT the authority on voice — a human-owned style guide is. Your output is a suggestion for human review, never an automatic change.

Hard rules:
- Use ONLY the numbers in the provided analysis JSON. Never invent or estimate figures.
- Sample-size honesty is the most important rule. The threshold is n=${MIN_COHORT_N}. Any cohort with fewer than ${MIN_COHORT_N} posts behind a metric must be labeled "directional only / too early to trust" and must NOT be stated as a conclusion or a "winner". Do not declare winners off 1–3 posts.
- Every comparative claim must cite its n, e.g. "Personal-voice tips lead on saves (avg 41 vs 12 for brand), but n=3 — directional only."
- When the analysis flags a confound (two dimensions co-varying), name the confound rather than attributing the effect to one variable.
- Be concise and concrete. No hype. If the data says little, say that plainly.`;

/**
 * Generate the prose sections of the digest from the pre-computed analysis.
 * @param analysisJson  Deterministic stats (cohorts, n, mean, median, confounds).
 * @param priorExcerpt  Recent content of the rolling doc (newest-first), or ''.
 */
export async function generateLearnings(
  analysisJson: string,
  priorExcerpt: string,
): Promise<LearningsProse> {
  const user =
    `ANALYSIS (ground truth — quote only these numbers):\n${analysisJson}\n\n` +
    `PRIOR WEEKS (most recent first; may be empty):\n${priorExcerpt || '(none yet)'}\n\n` +
    `Write the digest's prose sections per your rules. Threshold n=${MIN_COHORT_N}.`;
  return completeJSON<LearningsProse>(SYSTEM, user, SCHEMA);
}
