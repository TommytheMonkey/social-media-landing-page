// NEWSLETTER assembly (Flow 5) — runs in the 5-min poll. Aggregates every post
// currently tagged "Create Newsletter!" into ONE new Monday item in "Newsletter
// Prep", plus a Drive folder ("week of {Friday}") that holds COPIES of each source
// post's files, an imgs/ subfolder of curated images, and a plain-text Google Doc
// (with [IMG - img_n] placeholders). Assembly only — the branded HTML email is
// built later, when a human flips the item's Post Trigger to "Clear!" (see
// newsletterFinalize.ts).

import type { MondayItem } from '../types';
import * as monday from '../clients/monday';
import * as google from '../clients/google';
import {
  COLUMNS,
  CREATION_TRIGGER,
  POST_TRIGGER,
  STATUS,
  VOICE,
  PLATFORM,
  POST_TYPE,
  NEWSLETTER_PREP_GROUP_TITLE,
  NEWSLETTER_ROOT_FOLDER_ID,
  NEWSLETTER_AUTHOR_EMAIL,
} from '../config/board';
import { cv } from '../domain/columnValues';
import { parseItem, READ_COLUMN_IDS } from '../domain/item';
import { reportError } from '../domain/errors';
import { generateNewsletter, type NewsletterSource, type NewsletterImage } from '../generation/newsletter';
import { thisWeeksFriday } from '../lib/timezone';
import { log } from '../lib/logger';

const FOLDER_ID_RE = /folders\/([a-zA-Z0-9_-]+)/;

/** Make a title safe to use as a Drive folder name (no slashes; trimmed length). */
function sanitizeFolderName(name: string): string {
  const cleaned = name.replace(/[\\/]+/g, '-').replace(/\s+/g, ' ').trim().slice(0, 120);
  return cleaned.length > 0 ? cleaned : 'post';
}

function folderIdOf(item: MondayItem): string | null {
  return item.folder?.url?.match(FOLDER_ID_RE)?.[1] ?? null;
}

// A bare http(s) URL token (stops at whitespace, brackets, quotes — trailing
// sentence punctuation is trimmed separately so it isn't swallowed into the URL).
const URL_TOKEN_RE = /https?:\/\/[^\s<>()[\]"']+/g;
const DOWNLOAD_ID_RE = /\/downloads\/([0-9]+)\//;

/**
 * Canonical branded download links from the source posts, keyed by the source item
 * id (the numeric segment of /downloads/{id}/...). Prefers each post's Download Link
 * column, then any link already present in its Doc text (Flow 1 inserts those
 * verbatim, so they're exact). This is the ground truth the repair snaps back to.
 */
export function collectCanonicalDownloads(sources: MondayItem[], sourceTexts: string[]): Map<string, string> {
  const byId = new Map<string, string>();
  const add = (url: string | null | undefined): void => {
    if (!url) return;
    const id = url.match(DOWNLOAD_ID_RE)?.[1];
    if (id && !byId.has(id)) byId.set(id, url);
  };
  for (const s of sources) add(s.downloadLink?.url);
  for (const t of sourceTexts) for (const m of t.matchAll(URL_TOKEN_RE)) add(m[0]);
  return byId;
}

/**
 * Repair branded download links the generator may have mistranscribed. Any
 * ".../downloads/{id}/..." URL in the newsletter is snapped back to the exact hosted
 * link for that source id; if the id itself is corrupted but the sources expose
 * exactly one download link, it snaps to that one. Everything else (external
 * backlinks, the subscribe URL) is left untouched. Returns the fixed text + count.
 */
export function repairDownloadLinks(text: string, byId: Map<string, string>): { text: string; repairs: number } {
  const canon = [...byId.values()];
  if (canon.length === 0) return { text, repairs: 0 };
  let repairs = 0;
  const out = text.replace(URL_TOKEN_RE, (raw) => {
    if (!raw.includes('/downloads/')) return raw;
    const trail = raw.match(/[.,;:!?]+$/)?.[0] ?? '';
    const url = trail ? raw.slice(0, -trail.length) : raw;
    const id = url.match(DOWNLOAD_ID_RE)?.[1] ?? null;
    const fixed = (id ? byId.get(id) : undefined) ?? (canon.length === 1 ? canon[0] : undefined);
    if (!fixed || fixed === url) return raw;
    repairs++;
    return fixed + trail;
  });
  return { text: out, repairs };
}

export interface NewsletterResult {
  created: boolean;
  itemId?: string;
  sources?: number;
  folder?: string;
}

export async function pollAndCreateNewsletter(): Promise<NewsletterResult> {
  // 1. Source posts: Creation Trigger == "Create Newsletter!" (no checkbox filter —
  //    posts stay reusable and keep counting in reports).
  const raws = await monday.findItemsByStatus(
    [{ columnId: COLUMNS.creationTrigger, label: CREATION_TRIGGER.createNewsletter }],
    READ_COLUMN_IDS,
  );
  const flagged = raws.map(parseItem);
  if (flagged.length === 0) return { created: false };

  // 2. CLAIM each source FIRST — flip its trigger back to "~Created~" so a
  //    concurrent/next poll can't grab it again (the reset is the idempotency guard,
  //    same claim-first pattern as Flow 1). Only build from sources we successfully
  //    claimed; any that fail to claim are simply retried next poll.
  const sources: MondayItem[] = [];
  for (const s of flagged) {
    try {
      await monday.updateColumns(s.id, { [COLUMNS.creationTrigger]: cv.status(CREATION_TRIGGER.created) }, true);
      sources.push(s);
    } catch (err) {
      log.warn('Newsletter: failed to claim source (will retry next poll)', {
        itemId: s.id,
        err: err instanceof Error ? err.message : String(err),
      });
    }
  }
  if (sources.length === 0) return { created: false };

  // 3. Read each source's content — its Google Doc (edited source of truth), falling
  //    back to the Content-Text column. Skip sources with nothing readable.
  const sourceContent: NewsletterSource[] = [];
  for (const s of sources) {
    let body = '';
    const folderId = folderIdOf(s);
    if (folderId) {
      try {
        const docId = await google.findDocInFolder(folderId);
        if (docId) body = (await google.readDocText(docId)).trim();
      } catch {
        log.warn('Newsletter: could not read source Doc', { itemId: s.id });
      }
    }
    if (body.length === 0) body = (s.contentText ?? '').trim();
    if (body.length === 0) {
      log.warn('Newsletter: source has no readable content — excluding it', { itemId: s.id, name: s.name });
      continue;
    }
    sourceContent.push({ title: s.name, text: body, backlink: s.backlink?.url ?? null });
  }
  if (sourceContent.length === 0) {
    log.warn('Newsletter: no claimed source had content — skipping (sources already reset)');
    return { created: false };
  }

  // 4. Drive folder "week of {Friday}" with imgs/ + sources/ subfolders.
  const friday = thisWeeksFriday();
  const folderName = `week of ${friday}`;
  const folder = await google.ensureFolderPath(NEWSLETTER_ROOT_FOLDER_ID, [folderName]);
  const imgFolder = await google.ensureFolderPath(folder.id, ['imgs']);
  const sourcesFolder = await google.ensureFolderPath(folder.id, ['sources']);

  // 5. COPY (not move) each source's Drive files into sources/<post title>/.
  for (const s of sources) {
    const srcFolderId = folderIdOf(s);
    if (!srcFolderId) continue;
    try {
      const dest = await google.ensureFolderPath(sourcesFolder.id, [sanitizeFolderName(s.name)]);
      await google.copyFolderInto(srcFolderId, dest.id);
    } catch (err) {
      log.warn('Newsletter: could not copy a source folder', {
        itemId: s.id,
        err: err instanceof Error ? err.message : String(err),
      });
    }
  }

  // 6. Curate the source images into imgs/ as img_1, img_2, … + build the manifest.
  const images: NewsletterImage[] = [];
  let imgN = 0;
  for (const s of sources) {
    if (!s.hasImage || s.imageAssetIds.length === 0) continue;
    try {
      const assets = await monday.getAssets(s.imageAssetIds);
      for (const assetId of s.imageAssetIds) {
        const asset = assets.find((a) => a.id === assetId);
        if (!asset?.public_url) continue;
        const res = await fetch(asset.public_url);
        if (!res.ok) continue;
        const bytes = Buffer.from(await res.arrayBuffer());
        const contentType = res.headers.get('content-type') ?? 'image/png';
        imgN++;
        const filename = `img_${imgN}`;
        await google.uploadFile(imgFolder.id, filename, bytes, contentType);
        images.push({ filename, sourceTitle: s.name });
      }
    } catch (err) {
      log.warn('Newsletter: could not collect a source image', { itemId: s.id });
    }
  }

  // 7. Generate the newsletter (plain text w/ [IMG - img_n] placeholders + summary).
  const generated = await generateNewsletter(sourceContent, images);

  // 7b. Snap any mistranscribed download links back to the source posts' real hosted
  //     URLs (the generator can corrupt long/opaque links when reassembling text).
  const canonicalDownloads = collectCanonicalDownloads(sources, sourceContent.map((s) => s.text));
  const { text: docText, repairs } = repairDownloadLinks(generated.text, canonicalDownloads);
  if (repairs > 0) log.info('Newsletter: repaired mistranscribed download link(s)', { repairs, folder: folderName });

  // 8. Plain-text Google Doc in the newsletter folder (NOT the imgs subfolder).
  await google.createDoc(folder.id, generated.title, docText);

  // 9. Resolve the author (people column needs a user id) — best-effort.
  let authorId: string | null = null;
  try {
    authorId = await monday.resolveUserIdByEmail(NEWSLETTER_AUTHOR_EMAIL);
  } catch {
    log.warn('Newsletter: could not resolve author user id', { email: NEWSLETTER_AUTHOR_EMAIL });
  }

  // 10. Create the newsletter item in "Newsletter Prep".
  const groupId = await monday.getGroupIdByTitle(NEWSLETTER_PREP_GROUP_TITLE);
  if (!groupId) log.warn('Newsletter Prep group not found — creating in default group', { title: NEWSLETTER_PREP_GROUP_TITLE });
  const values: Record<string, unknown> = {
    [COLUMNS.platform]: cv.dropdown([PLATFORM.newsletter]),
    [COLUMNS.postType]: cv.dropdown([POST_TYPE.newsletter]),
    [COLUMNS.voice]: cv.status(VOICE.tommy),
    [COLUMNS.creationTrigger]: cv.status(CREATION_TRIGGER.created),
    [COLUMNS.postTrigger]: cv.status(POST_TRIGGER.needsEdits),
    [COLUMNS.status]: cv.status(STATUS.rawDraft),
    [COLUMNS.contentFolder]: cv.link(folder.webViewLink, 'Newsletter folder'),
  };
  if (generated.summary.length > 0) values[COLUMNS.description] = cv.text(generated.summary);
  if (authorId) values[COLUMNS.author] = cv.person(authorId);

  const newId = await monday.createItem(generated.title, values, groupId ?? undefined, true);

  log.info('Newsletter created', { newId, sources: sourceContent.length, images: imgN, folder: folderName });
  return { created: true, itemId: newId, sources: sourceContent.length, folder: folderName };
}
