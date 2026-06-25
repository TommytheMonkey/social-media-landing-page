// Buffer GraphQL client.
//
// Verified contract notes (June 2026, post "Assets Input Migration"):
//  - Endpoint POST https://api.buffer.com (root, no path). Auth: Bearer <key>.
//  - createPost(input: CreatePostInput!). One channel per mutation (channelId).
//  - schedulingType: automatic. mode: customScheduled (uses dueAt) | shareNow.
//  - dueAt is ISO-8601 UTC (no timezone field — caller converts 5am ET -> UTC).
//  - Media must be a PUBLIC https URL (no binary upload). New shape:
//      assets: [{ image: { url } }]   (@oneOf array; [] for text-only)
//  - Instagram needs metadata: { instagram: { type: post, shouldShareToFeed } }.
//  - 429 -> body extensions.retryAfter (seconds).

import { log } from '../lib/logger';
import type { Platform } from '../types';

const API_URL = 'https://api.buffer.com';
const MAX_RETRIES = 4;

function token(): string {
  const t = process.env.BUFFER_API_KEY;
  if (!t) throw new Error('BUFFER_API_KEY is not set');
  return t;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function bufferGql<T = any>(
  query: string,
  variables: Record<string, unknown> = {},
): Promise<T> {
  let attempt = 0;
  for (;;) {
    attempt++;
    const res = await fetch(API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token()}`,
      },
      body: JSON.stringify({ query, variables }),
    });

    const text = await res.text();
    let body: any;
    try {
      body = JSON.parse(text);
    } catch {
      throw new Error(`Buffer returned non-JSON (HTTP ${res.status}): ${text.slice(0, 500)}`);
    }

    const errors = body.errors as Array<{ message: string; extensions?: any }> | undefined;
    // Contract: the retry hint lives at the TOP-LEVEL extensions.retryAfter (seconds).
    // Fall back to the per-error path defensively.
    const retryAfter = (typeof body.extensions?.retryAfter === 'number'
      ? body.extensions.retryAfter
      : errors?.[0]?.extensions?.retryAfter) as number | undefined;
    const isRateLimited = res.status === 429 || typeof retryAfter === 'number';

    if (isRateLimited && attempt <= MAX_RETRIES) {
      const waitMs = (typeof retryAfter === 'number' ? retryAfter : Math.min(2 ** attempt, 60)) * 1000;
      log.warn('buffer rate limited, backing off', { attempt, waitMs });
      await sleep(waitMs);
      continue;
    }

    if (!res.ok) throw new Error(`Buffer HTTP ${res.status}: ${text.slice(0, 800)}`);
    if (errors && errors.length > 0) {
      throw new Error(`Buffer GraphQL error: ${errors.map((e) => e.message).join('; ')}`);
    }
    return body.data as T;
  }
}

export interface BufferChannel {
  id: string;
  name: string;
  displayName: string | null;
  service: string;
  isQueuePaused: boolean;
}

/** List channels across the account's organizations (for mapping Voice -> channel). */
export async function listChannels(): Promise<BufferChannel[]> {
  const orgData = await bufferGql<{ account: { organizations: Array<{ id: string }> } }>(
    `query { account { organizations { id name } } }`,
  );
  const orgs = orgData.account?.organizations ?? [];
  const all: BufferChannel[] = [];
  for (const org of orgs) {
    const data = await bufferGql<{ channels: BufferChannel[] }>(
      `query ($input: ChannelsInput!) {
         channels(input: $input) { id name displayName service isQueuePaused }
       }`,
      { input: { organizationId: org.id } },
    );
    all.push(...(data.channels ?? []));
  }
  return all;
}

export interface CreatePostArgs {
  channelId: string;
  text: string;
  platform: Platform;
  /** Public https image URL, or null for text-only (LinkedIn). */
  imageUrl: string | null;
  /** ISO-8601 UTC instant; omit/undefined for post-now. */
  dueAtUtc?: string;
}

interface CreatePostResult {
  createPost: {
    __typename: string;
    post?: { id: string };
    message?: string;
  };
}

/**
 * Create a Buffer post. With dueAtUtc -> scheduled (mode customScheduled);
 * without -> posted immediately (mode shareNow). Returns the Buffer post id.
 */
export async function createPost(args: CreatePostArgs): Promise<string> {
  if (process.env.BUFFER_DRY_RUN === 'true') {
    log.warn('BUFFER_DRY_RUN active — not sending to Buffer', {
      channelId: args.channelId,
      scheduled: Boolean(args.dueAtUtc),
    });
    return `dryrun-${args.channelId}-${args.dueAtUtc ?? 'now'}`;
  }

  const scheduled = Boolean(args.dueAtUtc);
  const mode = scheduled ? 'customScheduled' : 'shareNow';
  const assets = args.imageUrl ? [{ image: { url: args.imageUrl } }] : [];
  const metadata =
    args.platform === 'Instagram'
      ? { instagram: { type: 'post', shouldShareToFeed: true } }
      : null;

  const data = await bufferGql<CreatePostResult>(
    `mutation ($channelId: ChannelId!, $text: String, $dueAt: DateTime,
               $assets: [AssetInput!]!, $metadata: PostInputMetaData) {
       createPost(input: {
         channelId: $channelId
         schedulingType: automatic
         mode: ${mode}
         dueAt: $dueAt
         text: $text
         assets: $assets
         metadata: $metadata
       }) {
         __typename
         ... on PostActionSuccess { post { id } }
         ... on MutationError { message }
       }
     }`,
    {
      channelId: args.channelId,
      text: args.text,
      dueAt: args.dueAtUtc ?? null,
      assets,
      metadata,
    },
  );

  const result = data.createPost;
  if (result.post?.id) return result.post.id;
  throw new Error(`Buffer createPost failed: ${result.message ?? result.__typename ?? 'unknown error'}`);
}

export interface DeleteResult {
  /** True if the post was removed from the queue. False if it was already gone
   *  (already published, not found, or already deleted) — caller handles gracefully. */
  deleted: boolean;
  message?: string;
}

/**
 * Cancel/delete a scheduled post by its Buffer id. Returns {deleted:false} when
 * Buffer reports the post can't be deleted (e.g. it already published) rather than
 * throwing — so a CANCEL! on an already-live post degrades to a manual-delete note
 * instead of a stuck error.
 */
export async function deletePost(postId: string): Promise<DeleteResult> {
  if (process.env.BUFFER_DRY_RUN === 'true') {
    log.warn('BUFFER_DRY_RUN active — not deleting from Buffer', { postId });
    return { deleted: true };
  }
  const data = await bufferGql<{ deletePost: { __typename: string; message?: string } }>(
    `mutation ($id: PostId!) {
       deletePost(input: { id: $id }) {
         __typename
         ... on VoidMutationError { message }
       }
     }`,
    { id: postId },
  );
  const result = data.deletePost;
  if (result.__typename === 'DeletePostSuccess') return { deleted: true };
  return { deleted: false, message: result.message ?? result.__typename };
}
