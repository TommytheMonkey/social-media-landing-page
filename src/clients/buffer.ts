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
    const rlCode = (errors?.[0]?.extensions?.code ?? body.extensions?.code) as string | undefined;
    // Buffer's hard quota limit (RATE_LIMIT_EXCEEDED, window 15m/1h/24h) won't clear
    // within our backoff — retrying just burns more of the already-exhausted quota
    // and stalls the function ~30s/call. Fail fast: reconcile/metrics callers skip
    // the item, and the send flows surface a clear Error instead of hanging.
    const isQuotaExceeded = rlCode === 'RATE_LIMIT_EXCEEDED';
    const isRateLimited = res.status === 429 || typeof retryAfter === 'number' || isQuotaExceeded;

    if (isRateLimited) {
      const retryableSoon = typeof retryAfter === 'number' && retryAfter <= 60;
      if (isQuotaExceeded && !retryableSoon) {
        const win = errors?.[0]?.extensions?.window ?? body.extensions?.window;
        throw new Error(
          `Buffer rate limit exceeded${win ? ` (window ${win})` : ''} — not retrying; ` +
            `wait for the quota to reset.`,
        );
      }
      if (attempt <= MAX_RETRIES) {
        const waitMs = (typeof retryAfter === 'number' ? retryAfter : Math.min(2 ** attempt, 60)) * 1000;
        log.warn('buffer rate limited, backing off', { attempt, waitMs });
        await sleep(waitMs);
        continue;
      }
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

// --- Flow 6: post metrics (READ-ONLY) ----------------------------------------
// Verified contract (June 2026): `post(input: PostInput!) { id metricsUpdatedAt
// metrics { type name value unit } }`, PostInput = { id: PostId! }, returns Post!.
// EXPERIMENTAL surface — field shapes may drift, so parse defensively. Metrics are
// ingested by Buffer on a ~daily cadence (a fresh post can lag ~24h), and the
// array only contains metric types the network actually reported (absent != zero).

export interface PostMetric {
  /** Stable machine key (PostMetricType), e.g. reach | reactions | impressions. */
  type: string;
  name: string;
  value: number;
  /** count | percentage. */
  unit: string;
}

export interface PostMetricsResult {
  /** ISO timestamp Buffer last refreshed metrics, or null if none yet (skip writes). */
  metricsUpdatedAt: string | null;
  /** Only the metric types the network reported. Never synthesized. */
  metrics: PostMetric[];
}

/**
 * Read normalized performance metrics for one published post. Read-only — never
 * mutates Buffer. Tolerates missing/extra fields and schema drift (keeps only
 * well-formed numeric metrics); throws only on transport/GraphQL errors so the
 * caller can skip a single item without aborting the whole sweep.
 */
export async function getPostMetrics(postId: string): Promise<PostMetricsResult> {
  const data = await bufferGql<{
    post?: {
      id?: string;
      metricsUpdatedAt?: string | null;
      metrics?: Array<{ type?: string; name?: string; value?: number; unit?: string }> | null;
    } | null;
  }>(
    `query ($input: PostInput!) {
       post(input: $input) {
         id
         metricsUpdatedAt
         metrics { type name value unit }
       }
     }`,
    { input: { id: postId } },
  );

  const post = data.post ?? null;
  const rawMetrics = Array.isArray(post?.metrics) ? post!.metrics! : [];
  const metrics: PostMetric[] = [];
  for (const m of rawMetrics) {
    // Drift-tolerant: keep only entries with a usable type + finite numeric value.
    if (m && typeof m.type === 'string' && typeof m.value === 'number' && Number.isFinite(m.value)) {
      metrics.push({
        type: m.type,
        name: typeof m.name === 'string' ? m.name : m.type,
        value: m.value,
        unit: typeof m.unit === 'string' ? m.unit : 'count',
      });
    }
  }
  const updatedAt =
    typeof post?.metricsUpdatedAt === 'string' && post.metricsUpdatedAt.length > 0
      ? post.metricsUpdatedAt
      : null;
  return { metricsUpdatedAt: updatedAt, metrics };
}

// --- Flow 8: post publish status (READ-ONLY) ---------------------------------
// Verified contract (June 2026): Post.status is the PostStatus enum
//   draft | needs_approval | scheduled | sending | sent | error
// where `sent` = actually published (sentAt is the publish instant, externalLink
// the live post URL) and `error` = Buffer failed to publish (error.message explains
// why). Flow 8 uses this to move Monday to match REALITY instead of guessing.
// Read-only — never mutates Buffer.

/** PostStatus enum values (kept loose as string at the boundary so an unknown
 *  future value degrades to "still pending" rather than crashing the reconcile). */
export type BufferPostStatus =
  | 'draft'
  | 'needs_approval'
  | 'scheduled'
  | 'sending'
  | 'sent'
  | 'error';

export interface PostStatusResult {
  /** Raw PostStatus enum value (e.g. 'sent'). Defaults to 'scheduled' if absent. */
  status: string;
  /** ISO publish timestamp once sent, else null. */
  sentAt: string | null;
  /** Live post URL once published, else null. */
  externalLink: string | null;
  /** Buffer's publishing-error message when status == 'error', else null. */
  error: string | null;
}

/**
 * Read one post's real publish status from Buffer. Read-only. Throws only on
 * transport/GraphQL errors (caller skips a single item without aborting the sweep);
 * a missing/unknown status degrades to 'scheduled' so we never mis-flip to Live!.
 */
export async function getPostStatus(postId: string): Promise<PostStatusResult> {
  if (process.env.BUFFER_DRY_RUN === 'true') {
    // No real post backs a dry-run id — report "still scheduled" so the reconcile
    // is a clean no-op instead of erroring on a synthetic id.
    log.warn('BUFFER_DRY_RUN active — skipping Buffer status read', { postId });
    return { status: 'scheduled', sentAt: null, externalLink: null, error: null };
  }

  const data = await bufferGql<{
    post?: {
      id?: string;
      status?: string | null;
      sentAt?: string | null;
      externalLink?: string | null;
      error?: { message?: string | null } | null;
    } | null;
  }>(
    `query ($input: PostInput!) {
       post(input: $input) {
         id
         status
         sentAt
         externalLink
         error { message }
       }
     }`,
    { input: { id: postId } },
  );

  const post = data.post ?? null;
  // Absent/blank status -> treat as still scheduled (safe: never flips to Live!).
  const status =
    typeof post?.status === 'string' && post.status.length > 0 ? post.status : 'scheduled';
  const sentAt =
    typeof post?.sentAt === 'string' && post.sentAt.length > 0 ? post.sentAt : null;
  const externalLink =
    typeof post?.externalLink === 'string' && post.externalLink.length > 0
      ? post.externalLink
      : null;
  const error =
    post?.error && typeof post.error.message === 'string' && post.error.message.length > 0
      ? post.error.message
      : null;
  return { status, sentAt, externalLink, error };
}
