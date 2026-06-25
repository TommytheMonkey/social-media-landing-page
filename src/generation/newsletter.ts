// Placeholder sibling module — weekly newsletter generation (phase 2).
// Wire a new Creation Trigger value ("Create Newsletter!") to a flow that calls
// this, mirroring generation/post.ts. Reuses the shared anthropic client.

import type { MondayItem } from '../types';

export async function generateNewsletter(_item: MondayItem): Promise<never> {
  throw new Error('Newsletter generation is not implemented in phase 1');
}
