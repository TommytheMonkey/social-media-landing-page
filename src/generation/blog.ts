// Placeholder sibling module — blog article generation (phase 2).
// Wire a new Creation Trigger value ("Create Blog!") to a flow that calls this,
// mirroring generation/post.ts. Reuses the shared anthropic client.

import type { MondayItem } from '../types';

export async function generateBlog(_item: MondayItem): Promise<never> {
  throw new Error('Blog generation is not implemented in phase 1');
}
