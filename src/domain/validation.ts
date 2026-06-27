// Pre-send validation (Flows 2 & 3). On failure the caller sets Status =
// "Error - Check Updates" and posts an update listing exactly what's missing.

import type { MondayItem, Platform, ValidationResult } from '../types';
import { NON_SOCIAL_PLATFORMS, PLATFORM_CHAR_LIMIT } from '../config/board';

/** True if the item targets a non-social platform (Newsletter/Blog) — never send to Buffer. */
export function isNonSocialPlatform(item: MondayItem): boolean {
  return item.platformLabels.some((l) => (NON_SOCIAL_PLATFORMS as readonly string[]).includes(l));
}

/**
 * Validate an item is ready to send to Buffer.
 * @param requireDate true for schedule-ahead (Flow 2), false for Post Now (Flow 3).
 */
export function validateForSend(item: MondayItem, requireDate: boolean): ValidationResult {
  const missing: string[] = [];

  // NOTE: post text is NOT checked here — it's read from the Google Doc at send
  // time (see resolvePostTextFromDoc), which throws/reports if the Doc is empty.
  if (!item.voice) missing.push('Voice');
  if (!item.platform) missing.push('Platform');
  if (item.platform === 'Instagram' && !item.hasImage) {
    missing.push('Image (required for Instagram)');
  }
  if (requireDate && !item.postDate) missing.push('Post Date');

  return { ok: missing.length === 0, missing };
}

/**
 * Hard character-limit check on the RESOLVED post text. Run at send time, after the
 * Google Doc is read — that's the exact text Buffer receives — so an over-limit post
 * fails with a clear message instead of a cryptic Buffer "Invalid post" rejection.
 */
export function validateTextLength(text: string, platform: Platform): ValidationResult {
  const limit = PLATFORM_CHAR_LIMIT[platform];
  if (text.length > limit) {
    return {
      ok: false,
      missing: [
        `Post is ${text.length} characters — ${platform} allows a maximum of ${limit}. ` +
          `Shorten the copy in the Google Doc, then set Post Trigger back to "Clear!".`,
      ],
    };
  }
  return { ok: true, missing: [] };
}
