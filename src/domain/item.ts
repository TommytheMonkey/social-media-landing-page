// Parse a raw Monday item (id, name, column_values[{id,text,value}]) into the
// typed MondayItem the flows consume. All GraphQL-shape knowledge stays here.

import type { MondayItem, Platform, Voice, LinkValue } from '../types';
import { COLUMNS, PLATFORM, VOICE } from '../config/board';
import type { RawItem, RawColumnValue } from '../clients/monday';

/** Column ids this app reads — pass to monday reads as the `cols` selection. */
export const READ_COLUMN_IDS: string[] = [
  COLUMNS.description,
  COLUMNS.backlink,
  COLUMNS.platform,
  COLUMNS.postType,
  COLUMNS.voice,
  COLUMNS.creationTrigger,
  COLUMNS.postTrigger,
  COLUMNS.status,
  COLUMNS.postDate,
  COLUMNS.contentText,
  COLUMNS.contentImage,
  COLUMNS.attachment,
  COLUMNS.downloadLink,
  COLUMNS.contentFolder,
  COLUMNS.postCheckbox,
  COLUMNS.newsletterCheckbox,
  COLUMNS.useMyCopy,
  COLUMNS.bufferPostId,
];

const KNOWN_PLATFORMS = new Set<string>(Object.values(PLATFORM));
const KNOWN_VOICES = new Set<string>(Object.values(VOICE));

function byId(raw: RawItem): Map<string, RawColumnValue> {
  return new Map(raw.column_values.map((c) => [c.id, c]));
}

function parseJson(value: string | null): any {
  if (!value) return null;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function text(cols: Map<string, RawColumnValue>, id: string): string | null {
  const t = cols.get(id)?.text;
  return t && t.length > 0 ? t : null;
}

function parsePlatformLabels(cols: Map<string, RawColumnValue>): string[] {
  const t = text(cols, COLUMNS.platform);
  if (!t) return [];
  return t.split(',').map((s) => s.trim()).filter((s) => s.length > 0);
}

function parseVoice(cols: Map<string, RawColumnValue>): Voice | null {
  const t = text(cols, COLUMNS.voice);
  return t && KNOWN_VOICES.has(t) ? (t as Voice) : null;
}

function parseLink(cols: Map<string, RawColumnValue>, id: string): LinkValue | null {
  const v = parseJson(cols.get(id)?.value ?? null);
  if (v && typeof v.url === 'string' && v.url.length > 0) {
    return { url: v.url, text: typeof v.text === 'string' ? v.text : null };
  }
  return null;
}

function parseDate(cols: Map<string, RawColumnValue>): string | null {
  const v = parseJson(cols.get(COLUMNS.postDate)?.value ?? null);
  if (v && typeof v.date === 'string' && v.date.length > 0) return v.date;
  return text(cols, COLUMNS.postDate);
}

function parseFilesFrom(cols: Map<string, RawColumnValue>, colId: string): string[] {
  const v = parseJson(cols.get(colId)?.value ?? null);
  const files = v?.files;
  if (!Array.isArray(files)) return [];
  return files
    .map((f: any) => (f.assetId != null ? String(f.assetId) : null))
    .filter((x: string | null): x is string => x !== null);
}

function parseCheckbox(cols: Map<string, RawColumnValue>, colId: string): boolean {
  const v = parseJson(cols.get(colId)?.value ?? null);
  return v?.checked === true || v?.checked === 'true';
}

export function parseItem(raw: RawItem): MondayItem {
  const cols = byId(raw);
  const platformLabels = parsePlatformLabels(cols);
  const platforms = platformLabels.filter((l) => KNOWN_PLATFORMS.has(l)) as Platform[];
  const assetIds = parseFilesFrom(cols, COLUMNS.contentImage);
  return {
    id: raw.id,
    name: raw.name,
    description: text(cols, COLUMNS.description),
    backlink: parseLink(cols, COLUMNS.backlink),
    platforms,
    platform: platforms[0] ?? null,
    platformLabels,
    postType: text(cols, COLUMNS.postType),
    voice: parseVoice(cols),
    creationTrigger: text(cols, COLUMNS.creationTrigger),
    postTrigger: text(cols, COLUMNS.postTrigger),
    status: text(cols, COLUMNS.status),
    postDate: parseDate(cols),
    contentText: text(cols, COLUMNS.contentText),
    hasImage: assetIds.length > 0,
    imageAssetIds: assetIds,
    folder: parseLink(cols, COLUMNS.contentFolder),
    postChecked: parseCheckbox(cols, COLUMNS.postCheckbox),
    newsletterUsed: parseCheckbox(cols, COLUMNS.newsletterCheckbox),
    useMyCopy: parseCheckbox(cols, COLUMNS.useMyCopy),
    attachmentAssetIds: parseFilesFrom(cols, COLUMNS.attachment),
    downloadLink: parseLink(cols, COLUMNS.downloadLink),
    bufferPostId: text(cols, COLUMNS.bufferPostId),
  };
}
