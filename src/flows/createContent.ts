// FLOW 1 — Content creation. Triggered by Creation Trigger == "Create Post!".
//
// Order: clear the trigger FIRST (duplicate_item copies column values, so leaving
// it set would re-trigger every duplicate forever), generate copy per platform,
// duplicate the original into the full part×platform matrix, then materialize
// each cell (Drive folder + Doc + image, then write the Monday columns).

import type { MondayItem, Platform, GeneratedPart, GeneratedPost } from '../types';
import * as monday from '../clients/monday';
import * as google from '../clients/google';
import { COLUMNS, STATUS, POST_TRIGGER, CREATION_TRIGGER } from '../config/board';
import { DEFAULT_PLATFORM } from '../config/schedule';
import { cv } from '../domain/columnValues';
import { parseItem, READ_COLUMN_IDS } from '../domain/item';
import { generatePost } from '../generation/post';
import { generatePostImage } from '../generation/image';
import { reportError } from '../domain/errors';
import { todayInEastern } from '../lib/timezone';
import { log } from '../lib/logger';
import { uploadPublicFile } from '../clients/blob';
import { DOWNLOAD_PUBLIC_BASE, MAX_ATTACHMENT_BYTES, MAX_IMAGE_BYTES } from '../config/downloads';

const SOCIAL_ROOT_FOLDER_ID = '1Wu0FgCbW1qddaispMxVNqdOt-suFJZqe';

/** Short platform code suffixed onto content filenames for dual-platform posts. */
const PLATFORM_CODE: Record<Platform, string> = { LinkedIn: 'LI', Instagram: 'IG' };

interface Cell {
  itemId: string;
  platform: Platform;
  part: GeneratedPart;
}

interface RenderedImage {
  bytes: Buffer;
  filename: string;
  contentType: string;
}

/** Poll the board and run creation for every "Create Post!" item. */
export async function pollAndCreate(): Promise<number> {
  const raws = await monday.findItemsByStatus(
    [{ columnId: COLUMNS.creationTrigger, label: CREATION_TRIGGER.createPost }],
    READ_COLUMN_IDS,
  );
  let handled = 0;
  for (const raw of raws) {
    const item = parseItem(raw);
    try {
      await createForItem(item);
      handled++;
    } catch (err) {
      await reportError(item.id, 'Flow 1 (content creation) failed', err);
    }
  }
  return handled;
}

export async function createForItem(item: MondayItem): Promise<void> {
  // Mark the trigger "~Created~" immediately so neither the original nor its
  // duplicates re-fire (the poll only matches "Create Post!"). Also serves as the
  // visible "this item has been generated" state.
  await monday.updateColumns(
    item.id,
    { [COLUMNS.creationTrigger]: cv.status(CREATION_TRIGGER.created) },
    true, // auto-create the "~Created~" label if it doesn't exist yet
  );

  // "Use My Copy" needs the provided copy; otherwise we need a brief to generate from.
  const useMyCopy = item.useMyCopy;
  if (useMyCopy) {
    if (!item.contentText || item.contentText.trim().length === 0) {
      await reportError(item.id, 'Flow 1 aborted', new Error('"Use My Copy" is checked but Content - Text is empty'));
      return;
    }
  } else if (!item.description || item.description.trim().length === 0) {
    await reportError(item.id, 'Flow 1 aborted', new Error('Description is required to create a post'));
    return;
  }

  // Host an attached file (e.g. a PDF) to a branded download link, if one was provided.
  // Non-fatal: a hosting failure still produces the post, just without the link.
  let downloadUrl: string | null = null;
  if (item.attachmentAssetIds.length > 0) {
    try {
      downloadUrl = await hostAttachment(item);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      log.warn('Flow 1: attachment hosting failed', { itemId: item.id, err: msg });
      await monday.createUpdate(item.id, `⚠️ Couldn't host the attached file (${msg}). Created the post without a download link.`);
    }
    // The link is woven into the copy regardless; the column write is a separate,
    // non-fatal step so a Monday hiccup here can't masquerade as a hosting failure.
    if (downloadUrl) {
      try {
        await monday.updateColumns(item.id, { [COLUMNS.downloadLink]: cv.link(downloadUrl, 'Download') });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        log.warn('Flow 1: download-link column write failed', { itemId: item.id, err: msg });
        await monday.createUpdate(item.id, `ℹ️ Hosted the file and put the link in the post copy, but couldn't fill the Download Link column (${msg}).`);
      }
    }
  }

  // Use a provided image instead of generating one. If reading it fails, fall back
  // to generation (or to text-only when the post also uses your own copy).
  let providedImage: RenderedImage | null = null;
  if (item.hasImage) {
    try {
      providedImage = await resolveProvidedImage(item);
    } catch (err) {
      log.warn('Flow 1: could not read provided image — falling back', {
        itemId: item.id,
        err: err instanceof Error ? err.message : String(err),
      });
    }
  }

  const platforms: Platform[] = item.platforms.length > 0 ? item.platforms : [DEFAULT_PLATFORM];
  const disambiguate = platforms.length > 1; // include platform in folder path / doc name

  // Build copy per platform, ISOLATED — one platform's failure must not discard the
  // others. Use the provided copy verbatim when "Use My Copy" is set, else generate.
  // Either way, guarantee the download link (if any) is present in the final text.
  const generated: GeneratedPost[] = [];
  const failedPlatforms: Platform[] = [];
  for (const p of platforms) {
    try {
      if (useMyCopy) {
        const text = withDownloadCta(item.contentText!.trim(), downloadUrl);
        generated.push({ platform: p, parts: [{ partNumber: 1, totalParts: 1, text, imagePrompt: '' }] });
      } else {
        const post = await generatePost(item, p, downloadUrl ?? undefined);
        post.parts = post.parts.map((pt) => ({ ...pt, text: withDownloadCta(pt.text, downloadUrl) }));
        generated.push(post);
      }
    } catch (err) {
      failedPlatforms.push(p);
      log.warn('Flow 1 generation failed for a platform', {
        itemId: item.id,
        platform: p,
        err: err instanceof Error ? err.message : String(err),
      });
    }
  }
  if (generated.length === 0) {
    await reportError(item.id, 'Flow 1 generation failed for all platforms', new Error(platforms.join(', ')));
    return;
  }
  if (failedPlatforms.length > 0) {
    await monday.createUpdate(
      item.id,
      `⚠️ Generation failed for: ${failedPlatforms.join(', ')} — created the other platform(s). Re-trigger to retry the rest.`,
    );
  }

  // Flat cell list (first cell reuses the original; the rest are duplicates).
  const cellSpecs: Array<{ platform: Platform; part: GeneratedPart }> = [];
  for (const post of generated) {
    for (const part of post.parts) cellSpecs.push({ platform: post.platform, part });
  }

  // Create ALL cell ids UP FRONT from the still-pristine original (its file column
  // is empty here), so no duplicate inherits a sibling's uploaded image.
  const cellIds: string[] = [item.id];
  for (let i = 1; i < cellSpecs.length; i++) {
    cellIds.push(await monday.duplicateItem(item.id, false));
  }

  // Materialize each cell independently — a single cell's failure reports on THAT
  // cell and doesn't clobber the already-materialized original.
  const createdDate = todayInEastern();
  let materialized = 0;
  for (let i = 0; i < cellSpecs.length; i++) {
    const spec = cellSpecs[i]!;
    const cellId = cellIds[i]!;
    try {
      await materializeCell(item.name, { itemId: cellId, platform: spec.platform, part: spec.part }, disambiguate, createdDate, providedImage, useMyCopy);
      materialized++;
    } catch (err) {
      await reportError(cellId, `Flow 1 cell ${i + 1}/${cellSpecs.length} (${spec.platform}) failed`, err);
    }
  }

  log.info('Flow 1 created posts', { sourceItem: item.id, materialized, total: cellSpecs.length, platforms, failedPlatforms });
}

async function materializeCell(
  baseTitle: string,
  cell: Cell,
  disambiguate: boolean,
  createdDate: string,
  providedImage: RenderedImage | null,
  useMyCopy: boolean,
): Promise<void> {
  const { itemId, platform, part } = cell;
  const multi = part.totalParts > 1;
  const partSuffix = multi ? ` — pt. ${part.partNumber}` : '';
  const itemName = `${baseTitle}${partSuffix}`;

  // Drive folder: posts/{title}[/{platform}][/part N]
  const segments = ['posts', baseTitle];
  if (disambiguate) segments.push(platform);
  if (multi) segments.push(`part ${part.partNumber}`);
  const folder = await google.ensureFolderPath(SOCIAL_ROOT_FOLDER_ID, segments);

  // Doc: "{title} - pt. {#} - {YYYY-MM-DD}[ - LI|IG]" — the platform code is appended
  // at the END for dual-platform posts so the two files are easy to tell apart.
  const docName =
    `${baseTitle} - pt. ${part.partNumber} - ${createdDate}${disambiguate ? ` - ${PLATFORM_CODE[platform]}` : ''}`;
  await google.createDoc(folder.id, docName, part.text);

  // Image: use the provided one if present; else generate (base + composite logo).
  // When "Use My Copy" is set with no provided image, the post is intentionally
  // text-only. Archive whatever image we end up with in the Drive folder.
  let rendered: RenderedImage | null = null;
  if (providedImage) rendered = providedImage;
  else if (!useMyCopy && part.imagePrompt) rendered = await generatePostImage(part.imagePrompt, `${docName}.png`);
  if (rendered) await google.uploadImage(folder.id, rendered.filename, rendered.bytes, rendered.contentType);

  // Write the Monday columns. NOTE: the long-text column is intentionally NOT
  // populated here — the Google Doc is the editable source of truth, and Flow 2/3
  // snapshot the (possibly edited) Doc text into long-text at send time.
  await monday.renameItem(itemId, itemName);
  await monday.updateColumns(itemId, {
    [COLUMNS.platform]: cv.dropdown([platform]),
    [COLUMNS.contentFolder]: cv.link(folder.webViewLink, 'Drive folder'),
    [COLUMNS.status]: cv.status(STATUS.rawDraft),
    [COLUMNS.postTrigger]: cv.status(POST_TRIGGER.needsEdits),
    [COLUMNS.postCheckbox]: cv.checkbox(true),
  });

  // File column cannot hold a URL — upload the bytes so the team sees the image.
  // For a provided image the cell may already hold it (the original, or a duplicate
  // that inherited it) — only attach when missing, so we never double up.
  if (rendered && !(await cellHasImage(itemId))) {
    await monday.addFileToColumn(itemId, COLUMNS.contentImage, rendered.bytes, rendered.filename, rendered.contentType);
  }
}

// --- helpers for provided assets ---------------------------------------------

/** Append a download CTA with the link if it isn't already present in the copy. */
function withDownloadCta(text: string, url: string | null): string {
  if (!url || text.includes(url)) return text;
  return `${text}\n\n📄 Download: ${url}`;
}

/** Make a filename URL-safe for the deterministic Blob key / branded link. */
function sanitizeFilename(name: string): string {
  const cleaned = name.normalize('NFKD').replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^-+|-+$/g, '');
  return cleaned.length > 0 ? cleaned : 'file';
}

/**
 * Fetch a URL fully into memory with a HARD size cap. Streams the body and aborts
 * the moment the running total exceeds `maxBytes`, so a missing Content-Length can't
 * lead to an unbounded buffer (the header pre-check is only a cheap fast-path).
 */
async function downloadCapped(url: string, maxBytes: number): Promise<{ bytes: Buffer; contentType: string }> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Download failed (HTTP ${res.status})`);
  const contentType = res.headers.get('content-type') ?? 'application/octet-stream';
  const declared = Number(res.headers.get('content-length') ?? 0);
  if (declared > maxBytes) throw new Error(`File too large (${declared} bytes > ${maxBytes})`);
  if (!res.body) {
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length > maxBytes) throw new Error(`File too large (${buf.length} bytes > ${maxBytes})`);
    return { bytes: buf, contentType };
  }
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of res.body as unknown as AsyncIterable<Uint8Array>) {
    total += chunk.length;
    if (total > maxBytes) throw new Error(`File too large (> ${maxBytes} bytes)`);
    chunks.push(Buffer.from(chunk));
  }
  return { bytes: Buffer.concat(chunks), contentType };
}

/** Download the first Attachment asset, host it on Blob, return the branded link. */
async function hostAttachment(item: MondayItem): Promise<string> {
  const assets = await monday.getAssets(item.attachmentAssetIds);
  const asset = assets.find((a) => a.public_url) ?? assets[0];
  if (!asset?.public_url) throw new Error('Attachment has no downloadable URL');
  const safe = sanitizeFilename(asset.name ?? 'file');
  // Vercel's global cleanUrls strips a trailing .html/.htm BEFORE our /downloads
  // rewrite runs, which would 404 the link — so refuse those rather than mis-serve.
  if (/\.html?$/i.test(safe)) {
    throw new Error('HTML attachments are not supported — use PDF or another file type');
  }
  const { bytes, contentType } = await downloadCapped(asset.public_url, MAX_ATTACHMENT_BYTES);
  const key = `${item.id}/${safe}`;
  await uploadPublicFile(key, bytes, contentType);
  return `${DOWNLOAD_PUBLIC_BASE}/${key}`;
}

/** Download the first image in the Content-Image column for reuse across cells. */
async function resolveProvidedImage(item: MondayItem): Promise<RenderedImage | null> {
  const assets = await monday.getAssets(item.imageAssetIds);
  const asset = assets.find((a) => a.public_url) ?? assets[0];
  if (!asset?.public_url) return null;
  const { bytes, contentType } = await downloadCapped(asset.public_url, MAX_IMAGE_BYTES);
  return {
    bytes,
    filename: asset.name && asset.name.length > 0 ? asset.name : 'image.png',
    contentType: contentType.startsWith('image/') ? contentType : 'image/png',
  };
}

/** True if the item's Content-Image file column already holds at least one file. */
async function cellHasImage(itemId: string): Promise<boolean> {
  const [it] = await monday.getItems([itemId], [COLUMNS.contentImage]);
  const raw = it?.column_values.find((c) => c.id === COLUMNS.contentImage)?.value;
  if (!raw) return false;
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed.files) && parsed.files.length > 0;
  } catch {
    return false;
  }
}
