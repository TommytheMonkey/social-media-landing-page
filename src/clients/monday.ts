// Monday.com GraphQL client (API version 2026-04).
//
// Verified contract notes:
//  - Endpoint https://api.monday.com/v2 ; file uploads to /v2/file (multipart).
//  - Auth header is the RAW token (no "Bearer" prefix).
//  - Status columns filter by label INDEX (not text) via query_params/any_of.
//  - File columns cannot store a URL — bytes go in via add_file_to_column.
//  - 429 responses carry retry_in_seconds; complexity over budget -> ComplexityException.

import { log } from '../lib/logger';
import { BOARD_ID } from '../config/board';

const API_URL = 'https://api.monday.com/v2';
const FILE_URL = 'https://api.monday.com/v2/file';
const API_VERSION = '2026-04';
const MAX_RETRIES = 4;

export interface RawColumnValue {
  id: string;
  text: string | null;
  /** JSON string (or null) — the structured value. */
  value: string | null;
}

export interface RawItem {
  id: string;
  name: string;
  column_values: RawColumnValue[];
}

export interface MondayAsset {
  id: string;
  name: string;
  public_url: string | null;
  url: string | null;
}

function token(): string {
  const t = process.env.MONDAY_API_TOKEN;
  if (!t) throw new Error('MONDAY_API_TOKEN is not set');
  return t;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Core GraphQL POST with retry/backoff on rate-limit + complexity errors. */
export async function gql<T = any>(
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
        Authorization: token(),
        'API-Version': API_VERSION,
      },
      body: JSON.stringify({ query, variables }),
    });

    const bodyText = await res.text();
    let body: any;
    try {
      body = JSON.parse(bodyText);
    } catch {
      throw new Error(`Monday returned non-JSON (HTTP ${res.status}): ${bodyText.slice(0, 500)}`);
    }

    const errors = body.errors as Array<{ message: string; extensions?: any }> | undefined;
    const errorCode = body.error_code as string | undefined;
    const retryIn =
      (body.retry_in_seconds as number | undefined) ??
      errors?.[0]?.extensions?.retry_in_seconds;

    const isRateLimited =
      res.status === 429 ||
      errorCode === 'ComplexityException' ||
      (typeof retryIn === 'number' && retryIn > 0);

    if (isRateLimited && attempt <= MAX_RETRIES) {
      const waitMs = (typeof retryIn === 'number' ? retryIn : Math.min(2 ** attempt, 30)) * 1000;
      log.warn('monday rate limited, backing off', { attempt, waitMs, errorCode });
      await sleep(waitMs);
      continue;
    }

    if (!res.ok) {
      throw new Error(`Monday HTTP ${res.status}: ${bodyText.slice(0, 800)}`);
    }
    if (errors && errors.length > 0) {
      throw new Error(`Monday GraphQL error: ${errors.map((e) => e.message).join('; ')}`);
    }
    return body.data as T;
  }
}

// --- Status label <-> index resolution (cached per warm instance) ------------

const labelIndexCache = new Map<string, Map<string, number>>();

async function statusLabelMap(columnId: string): Promise<Map<string, number>> {
  const cached = labelIndexCache.get(columnId);
  if (cached) return cached;

  const data = await gql<{ boards: Array<{ columns: Array<{ id: string; settings_str: string }> }> }>(
    `query ($board: [ID!], $col: [String!]) {
       boards(ids: $board) { columns(ids: $col) { id settings_str } }
     }`,
    { board: [BOARD_ID], col: [columnId] },
  );

  const settingsStr = data.boards?.[0]?.columns?.[0]?.settings_str;
  if (!settingsStr) throw new Error(`No settings_str for column ${columnId}`);
  const settings = JSON.parse(settingsStr) as { labels?: Record<string, string> };
  const map = new Map<string, number>();
  for (const [idx, label] of Object.entries(settings.labels ?? {})) {
    map.set(label, Number(idx));
  }
  labelIndexCache.set(columnId, map);
  return map;
}

export async function statusLabelIndex(columnId: string, label: string): Promise<number> {
  const map = await statusLabelMap(columnId);
  const idx = map.get(label);
  if (idx === undefined) {
    throw new Error(`Label "${label}" not found on column ${columnId} (have: ${[...map.keys()].join(', ')})`);
  }
  return idx;
}

// --- Reads -------------------------------------------------------------------

export interface StatusFilter {
  columnId: string;
  label: string;
}

const ITEM_FIELDS = `id name column_values(ids: $cols) { id text value }`;

/**
 * Find items whose status columns match ALL given (columnId == label) filters.
 * Uses query_params with any_of on the resolved label index (exact match).
 */
export async function findItemsByStatus(
  filters: StatusFilter[],
  columnIds: string[],
): Promise<RawItem[]> {
  const rules = await Promise.all(
    filters.map(async (f) => ({
      column_id: f.columnId,
      compare_value: [await statusLabelIndex(f.columnId, f.label)],
      operator: 'any_of',
    })),
  );

  const items: RawItem[] = [];
  let cursor: string | null = null;

  // First page (filtered).
  const first = await gql<{
    boards: Array<{ items_page: { cursor: string | null; items: RawItem[] } }>;
  }>(
    `query ($board: [ID!], $cols: [String!], $qp: ItemsQuery) {
       boards(ids: $board) {
         items_page(limit: 100, query_params: $qp) { cursor items { ${ITEM_FIELDS} } }
       }
     }`,
    { board: [BOARD_ID], cols: columnIds, qp: { rules, operator: 'and' } },
  );
  const firstPage = first.boards?.[0]?.items_page;
  if (firstPage) {
    items.push(...firstPage.items);
    cursor = firstPage.cursor;
  }

  // Subsequent pages (cursor only — query_params cannot be combined with cursor).
  while (cursor) {
    const next: {
      next_items_page: { cursor: string | null; items: RawItem[] };
    } = await gql(
      `query ($cols: [String!], $cursor: String!) {
         next_items_page(limit: 100, cursor: $cursor) { cursor items { ${ITEM_FIELDS} } }
       }`,
      { cols: columnIds, cursor },
    );
    items.push(...next.next_items_page.items);
    cursor = next.next_items_page.cursor;
  }

  return items;
}

/** Fetch specific items by id with the given columns. */
export async function getItems(ids: string[], columnIds: string[]): Promise<RawItem[]> {
  if (ids.length === 0) return [];
  const data = await gql<{ items: RawItem[] }>(
    `query ($ids: [ID!], $cols: [String!]) {
       items(ids: $ids) { ${ITEM_FIELDS} }
     }`,
    { ids, cols: columnIds },
  );
  return data.items ?? [];
}

/** Resolve temporary public download URLs for uploaded assets (file column). */
export async function getAssets(assetIds: string[]): Promise<MondayAsset[]> {
  if (assetIds.length === 0) return [];
  const data = await gql<{ assets: MondayAsset[] }>(
    `query ($ids: [ID!]) { assets(ids: $ids) { id name public_url url } }`,
    { ids: assetIds },
  );
  return data.assets ?? [];
}

/** Find a group's id by its title (e.g. "Garbage"). */
export async function getGroupIdByTitle(title: string): Promise<string | null> {
  const data = await gql<{ boards: Array<{ groups: Array<{ id: string; title: string }> }> }>(
    `query ($board: [ID!]) { boards(ids: $board) { groups { id title } } }`,
    { board: [BOARD_ID] },
  );
  const group = data.boards?.[0]?.groups?.find((g) => g.title === title);
  return group?.id ?? null;
}

// --- Writes ------------------------------------------------------------------

/** Set multiple column values. `values` maps columnId -> JSON-serializable value. */
export async function updateColumns(
  itemId: string,
  values: Record<string, unknown>,
): Promise<void> {
  await gql(
    `mutation ($board: ID!, $item: ID!, $vals: JSON!) {
       change_multiple_column_values(board_id: $board, item_id: $item, column_values: $vals) { id }
     }`,
    { board: BOARD_ID, item: itemId, vals: JSON.stringify(values) },
  );
}

/** Rename an item via the "name" pseudo-column. */
export async function renameItem(itemId: string, name: string): Promise<void> {
  await gql(
    `mutation ($board: ID!, $item: ID!, $val: String!) {
       change_simple_column_value(board_id: $board, item_id: $item, column_id: "name", value: $val) { id }
     }`,
    { board: BOARD_ID, item: itemId, val: name },
  );
}

/** Duplicate a top-level item (copies its column values). Returns the new id. */
export async function duplicateItem(itemId: string, withUpdates = false): Promise<string> {
  const data = await gql<{ duplicate_item: { id: string } }>(
    `mutation ($board: ID!, $item: ID!, $upd: Boolean!) {
       duplicate_item(board_id: $board, item_id: $item, with_updates: $upd) { id }
     }`,
    { board: BOARD_ID, item: itemId, upd: withUpdates },
  );
  return data.duplicate_item.id;
}

/** Create a new top-level item. Returns the new id. */
export async function createItem(
  name: string,
  values: Record<string, unknown>,
  groupId?: string,
): Promise<string> {
  const data = await gql<{ create_item: { id: string } }>(
    `mutation ($board: ID!, $group: String, $name: String!, $vals: JSON!) {
       create_item(board_id: $board, group_id: $group, item_name: $name, column_values: $vals) { id }
     }`,
    { board: BOARD_ID, group: groupId ?? null, name, vals: JSON.stringify(values) },
  );
  return data.create_item.id;
}

/** Post an update (comment) on an item — our error/log channel. */
export async function createUpdate(itemId: string, body: string): Promise<void> {
  await gql(
    `mutation ($item: ID!, $body: String!) {
       create_update(item_id: $item, body: $body) { id }
     }`,
    { item: itemId, body },
  );
}

/** Move an item to a group (same board). */
export async function moveItemToGroup(itemId: string, groupId: string): Promise<void> {
  await gql(
    `mutation ($item: ID!, $group: String!) {
       move_item_to_group(item_id: $item, group_id: $group) { id }
     }`,
    { item: itemId, group: groupId },
  );
}

/** Upload file bytes into a file column via the /v2/file multipart endpoint. */
export async function addFileToColumn(
  itemId: string,
  columnId: string,
  bytes: Buffer,
  filename: string,
  contentType: string,
): Promise<void> {
  // itemId/columnId are app-internal (numeric id + config constant), but guard
  // before interpolating into the GraphQL document to be safe.
  if (!/^\d+$/.test(itemId)) throw new Error(`Unsafe item id for file upload: ${itemId}`);
  if (!/^[a-zA-Z0-9_]+$/.test(columnId)) throw new Error(`Unsafe column id for file upload: ${columnId}`);
  const query =
    `mutation ($file: File!) {
       add_file_to_column(item_id: ${itemId}, column_id: "${columnId}", file: $file) { id }
     }`;

  const form = new FormData();
  form.append('query', query);
  form.append('map', JSON.stringify({ image: ['variables.file'] }));
  form.append('image', new Blob([new Uint8Array(bytes)], { type: contentType }), filename);

  const res = await fetch(FILE_URL, {
    method: 'POST',
    headers: { Authorization: token(), 'API-Version': API_VERSION },
    body: form,
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`Monday file upload HTTP ${res.status}: ${text.slice(0, 500)}`);
  const parsed = JSON.parse(text);
  if (parsed.errors) {
    throw new Error(`Monday file upload error: ${JSON.stringify(parsed.errors).slice(0, 500)}`);
  }
}
