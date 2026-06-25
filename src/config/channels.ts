// Voice x Platform -> Buffer channel ID mapping.
//
// Fill in the channel IDs for the accounts you actually have. Leave a platform
// out (or empty) for voices that don't post there. You can discover your IDs by
// running the Buffer `channels` query (the buffer client exposes listChannels()).
//
// Env override: any value of the form "$ENV_VAR" is read from process.env at
// runtime, so you can keep IDs in Vercel env vars instead of committing them.

import type { Platform, Voice } from '../types';

export const CHANNEL_MAP: Record<Voice, Partial<Record<Platform, string>>> = {
  // Tommy Lather — personal LinkedIn
  Tommy: { LinkedIn: '6a3bea455ab6d2f10668b3f3' },
  // Takeoff Monkey, LLC — company LinkedIn
  'Takeoff Monkey': { LinkedIn: '6a3bea455ab6d2f10668b3f7' },
  // No Heidi channel connected in Buffer yet
  Heidi: {},
  TBD: {},
  // TOM-flavored personal voice -> Tommy's LinkedIn (change to the company id if preferred)
  'Tommy + TOM': { LinkedIn: '6a3bea455ab6d2f10668b3f3' },
  'Heidi + TOM': {},
  Other: {},
  // NOTE: no Instagram channels are connected in Buffer yet — add IG channel ids
  // here once connected, e.g. Tommy: { LinkedIn: '...', Instagram: '<ig id>' }.
};

/**
 * Resolve the Buffer channel ID for a (voice, platform) pair.
 * Supports "$ENV_VAR" indirection. Returns null if unmapped/empty.
 */
export function resolveChannelId(voice: Voice, platform: Platform): string | null {
  const raw = CHANNEL_MAP[voice]?.[platform];
  if (!raw) return null;
  if (raw.startsWith('$')) {
    const fromEnv = process.env[raw.slice(1)];
    return fromEnv && fromEnv.length > 0 ? fromEnv : null;
  }
  return raw;
}
