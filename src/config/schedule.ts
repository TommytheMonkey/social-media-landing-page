// Scheduling config — adjust here without touching flow code.

import type { Platform } from '../types';

/** Posts always schedule for this local time on the Post Date. */
export const POST_LOCAL_TIME = { hour: 5, minute: 0, second: 0 };

/** Timezone the post time is expressed in (DST handled by luxon). */
export const POST_TIMEZONE = 'America/New_York';

/**
 * Platform used when an item reaches creation without a Platform set.
 * (Platform is not required at creation, but generation needs a target.)
 */
export const DEFAULT_PLATFORM: Platform = 'LinkedIn';

/** Hard cap on parts the generator may split a post into. */
export const MAX_PARTS = 6;
