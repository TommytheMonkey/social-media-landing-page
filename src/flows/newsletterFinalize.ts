// NEWSLETTER prep scan (Flow 5b) — runs in the 5-min poll over the "Newsletter
// Prep" group. Two jobs per item:
//   (a) Attachment -> branded Download Link (same behavior as posts / Flow 1).
//   (b) When a human flips Post Trigger to "Clear!" (Status still "Raw Draft"),
//       build ONE brand-standard HTML email from the edited Google Doc + imgs/,
//       save it to the Drive folder, and set Status -> "Ready to Send!".

import type { MondayItem } from '../types';
import * as monday from '../clients/monday';
import * as google from '../clients/google';
import { uploadPublicImage } from '../clients/blob';
import {
  COLUMNS,
  STATUS,
  POST_TRIGGER,
  PLATFORM,
  NEWSLETTER_PREP_GROUP_TITLE,
} from '../config/board';
import { SUBSCRIBE_URL } from '../config/links';
import { cv } from '../domain/columnValues';
import { parseItem, READ_COLUMN_IDS } from '../domain/item';
import { reportError } from '../domain/errors';
import { hostAttachment } from '../lib/attachments';
import { tryLoadAsset } from '../lib/assets';
import { finalizePostText } from './sendShared';
import { buildNewsletterHtml } from '../generation/newsletterHtml';
import { log } from '../lib/logger';

const FOLDER_MIME = 'application/vnd.google-apps.folder';
const FOLDER_ID_RE = /folders\/([a-zA-Z0-9_-]+)/;

export interface NewsletterPrepResult {
  hosted: number; // attachments turned into download links this cycle
  finalized: number; // newsletters turned into HTML this cycle
}

export async function pollNewsletterPrep(): Promise<NewsletterPrepResult> {
  const groupId = await monday.getGroupIdByTitle(NEWSLETTER_PREP_GROUP_TITLE);
  if (!groupId) {
    log.warn('Newsletter prep: group not found', { title: NEWSLETTER_PREP_GROUP_TITLE });
    return { hosted: 0, finalized: 0 };
  }
  const raws = await monday.getItemsInGroup(groupId, READ_COLUMN_IDS);
  let hosted = 0;
  let finalized = 0;

  for (const raw of raws) {
    const item = parseItem(raw);
    // Only act on newsletter-platform items (defensive — the group should only hold these).
    if (!item.platformLabels.includes(PLATFORM.newsletter)) continue;

    // (a) Attachment -> download link (mirrors Flow 1; same shared helper).
    if (item.attachmentAssetIds.length > 0 && !item.downloadLink) {
      try {
        const url = await hostAttachment(item);
        await monday.updateColumns(item.id, { [COLUMNS.downloadLink]: cv.link(url, 'Download') });
        hosted++;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        log.warn('Newsletter prep: attachment hosting failed', { itemId: item.id, err: msg });
        await monday.createUpdate(item.id, `⚠️ Couldn't host the attached file (${msg}).`).catch(() => undefined);
      }
    }

    // (b) Finalize -> HTML when cleared and still a Raw Draft.
    if (item.postTrigger === POST_TRIGGER.clear && item.status === STATUS.rawDraft) {
      try {
        if (await finalizeNewsletter(item)) finalized++;
      } catch (err) {
        await reportError(item.id, 'Newsletter finalize (build HTML) failed', err);
      }
    }
  }

  return { hosted, finalized };
}

/** Build + save the branded HTML email for one cleared newsletter. Returns true if built. */
async function finalizeNewsletter(item: MondayItem): Promise<boolean> {
  const folderUrl = item.folder?.url;
  if (!folderUrl) throw new Error('No Content folder linked — cannot build the newsletter HTML');
  const folderId = folderUrl.match(FOLDER_ID_RE)?.[1];
  if (!folderId) throw new Error(`Could not parse a Drive folder id from "${folderUrl}"`);

  // 1. Read the edited Doc text (source of truth after human edits) + finalize it.
  const docId = await google.findDocInFolder(folderId);
  if (!docId) throw new Error('No Google Doc found in the newsletter folder');
  const rawText = (await google.readDocText(docId)).trim();
  if (rawText.length === 0) throw new Error('The newsletter Google Doc is empty');
  const text = finalizePostText(rawText); // [SUBSCRIBE LINK] -> real URL, brand-name normalize

  // 2. Host the curated imgs/ images publicly so the email can render them.
  const imageUrls: Record<string, string> = {};
  const children = await google.listFolderChildren(folderId);
  const imgFolder = children.find((c) => c.mimeType === FOLDER_MIME && c.name === 'imgs');
  if (imgFolder) {
    for (const child of await google.listFolderChildren(imgFolder.id)) {
      if (!child.mimeType.startsWith('image/')) continue;
      try {
        const { bytes, contentType } = await google.downloadFileBytes(child.id);
        const url = await uploadPublicImage(bytes, `newsletter-${item.id}-${child.name}`, contentType);
        imageUrls[child.name] = url;
      } catch (err) {
        log.warn('Newsletter finalize: could not host an image', { itemId: item.id, name: child.name });
      }
    }
  }

  // 3. Host the white logo for the header (best-effort — falls back to a text logo).
  let logoUrl: string | null = null;
  const logoBytes = tryLoadAsset('assets/brand/logo-white.png');
  if (logoBytes) {
    try {
      logoUrl = await uploadPublicImage(logoBytes, 'newsletter-logo-white.png', 'image/png');
    } catch {
      log.warn('Newsletter finalize: could not host logo', { itemId: item.id });
    }
  }

  // 4. Build the brand-standard HTML + save it to the newsletter folder.
  const folderName = (await google.getFileName(folderId)) ?? '';
  const dateLabel = folderName ? folderName.replace(/^week of/i, 'Week of') : null;
  const html = buildNewsletterHtml(text, {
    title: item.name,
    subscribeUrl: SUBSCRIBE_URL,
    imageUrls,
    logoUrl,
    dateLabel,
  });
  await google.uploadFile(folderId, 'newsletter.html', Buffer.from(html, 'utf8'), 'text/html');

  // 5. CLAIM: re-read Status right before flipping so an overlapping poll or a
  //    re-run can't rebuild endlessly. Only advance if it's still a Raw Draft.
  const [fresh] = await monday.getItems([item.id], [COLUMNS.status]);
  const status = fresh?.column_values.find((c) => c.id === COLUMNS.status)?.text ?? null;
  if (status !== STATUS.rawDraft) {
    log.info('Newsletter finalize: item no longer Raw Draft — HTML saved, status left as-is', { itemId: item.id });
    return false;
  }
  await monday.updateColumns(item.id, { [COLUMNS.status]: cv.status(STATUS.readyToSend) }, true);
  log.info('Newsletter finalized', { itemId: item.id, images: Object.keys(imageUrls).length });
  return true;
}
