// Pre-send validation (Flows 2 & 3). On failure the caller sets Status =
// "Error - Check Updates" and posts an update listing exactly what's missing.

import type { MondayItem, ValidationResult } from '../types';
import { NON_SOCIAL_PLATFORMS } from '../config/board';

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
