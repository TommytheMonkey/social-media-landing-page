// NEWSLETTER flow — weekly assembly (Friday cron). Aggregates the week's posts
// tagged "Create Newsletter!" (whose Newsletter checkbox is unchecked) into ONE
// new Monday item in "Newsletter Prep". Assembly only — no email send (a send
// flow can be added later without touching this).

import * as monday from '../clients/monday';
import * as google from '../clients/google';
import {
  COLUMNS,
  CREATION_TRIGGER,
  POST_TRIGGER,
  STATUS,
  VOICE,
  NEWSLETTER_PREP_GROUP_TITLE,
} from '../config/board';
import { cv } from '../domain/columnValues';
import { parseItem, READ_COLUMN_IDS } from '../domain/item';
import { reportError } from '../domain/errors';
import { wordCount } from './sendShared';
import { generateNewsletter, type NewsletterSource } from '../generation/newsletter';
import { upcomingMonday } from '../lib/timezone';
import { log } from '../lib/logger';

const NEWSLETTER_ROOT_FOLDER_ID = '14qb1gvyrdXCVl41tL83aM6p38T2Epa1O';
const FOLDER_ID_RE = /folders\/([a-zA-Z0-9_-]+)/;

export interface NewsletterResult {
  created: boolean;
  itemId?: string;
  sources?: number;
}

export async function runNewsletter(): Promise<NewsletterResult> {
  // 1. Source posts: Creation Trigger == "Create Newsletter!" AND not yet used.
  const raws = await monday.findItemsByStatus(
    [{ columnId: COLUMNS.creationTrigger, label: CREATION_TRIGGER.createNewsletter }],
    READ_COLUMN_IDS,
  );
  const sources = raws.map(parseItem).filter((it) => !it.newsletterUsed);
  if (sources.length === 0) {
    log.info('Newsletter: no qualifying source posts — skipping');
    return { created: false };
  }

  // 2. Read each source's content — long-text, falling back to its Google Doc.
  const sourceContent: NewsletterSource[] = [];
  for (const s of sources) {
    let body = (s.contentText ?? '').trim();
    if (body.length === 0 && s.folder?.url) {
      try {
        const folderId = s.folder.url.match(FOLDER_ID_RE)?.[1];
        if (folderId) {
          const docId = await google.findDocInFolder(folderId);
          if (docId) body = (await google.readDocText(docId)).trim();
        }
      } catch (err) {
        log.warn('Newsletter: could not read source Doc', { itemId: s.id });
      }
    }
    if (body.length === 0) {
      log.warn('Newsletter: source has no readable content — excluding it', { itemId: s.id, name: s.name });
      continue;
    }
    sourceContent.push({ title: s.name, text: body, backlink: s.backlink?.url ?? null });
  }
  if (sourceContent.length === 0) {
    log.warn('Newsletter: no source posts had content — skipping');
    return { created: false };
  }

  // 3. Drive folder for this newsletter + an "img" subfolder.
  const mondayDate = upcomingMonday();
  const folder = await google.ensureFolderPath(NEWSLETTER_ROOT_FOLDER_ID, [`Newsletter - ${mondayDate}`]);
  const imgFolder = await google.ensureFolderPath(folder.id, ['img']);

  // 4. Collect the source images into the img subfolder (keep bytes for the item).
  const images: Array<{ bytes: Buffer; filename: string; contentType: string }> = [];
  for (const s of sources) {
    if (!s.hasImage || s.imageAssetIds.length === 0) continue;
    try {
      const assets = await monday.getAssets(s.imageAssetIds);
      const asset = assets.find((a) => a.public_url) ?? assets[0];
      if (!asset?.public_url) continue;
      const res = await fetch(asset.public_url);
      if (!res.ok) continue;
      const bytes = Buffer.from(await res.arrayBuffer());
      const contentType = res.headers.get('content-type') ?? 'image/png';
      const filename = asset.name && asset.name.length > 0 ? asset.name : `${s.id}.png`;
      await google.uploadImage(imgFolder.id, filename, bytes, contentType);
      images.push({ bytes, filename, contentType });
    } catch (err) {
      log.warn('Newsletter: could not collect a source image', { itemId: s.id });
    }
  }

  // 5. Generate the newsletter from the source content.
  const generated = await generateNewsletter(sourceContent);
  const wc = wordCount(generated.text);

  // 6. Google Doc (word count at the top), in the newsletter folder.
  await google.createDoc(folder.id, `${generated.title} - ${mondayDate}`, `Word count: ${wc}\n\n${generated.text}`);

  // 7. Create the newsletter item in "Newsletter Prep".
  const groupId = await monday.getGroupIdByTitle(NEWSLETTER_PREP_GROUP_TITLE);
  if (!groupId) log.warn('Newsletter Prep group not found — creating in default group', { title: NEWSLETTER_PREP_GROUP_TITLE });
  const newId = await monday.createItem(
    generated.title,
    {
      [COLUMNS.platform]: cv.dropdown(['Newsletter']),
      [COLUMNS.voice]: cv.status(VOICE.tommy),
      [COLUMNS.creationTrigger]: cv.status(CREATION_TRIGGER.created),
      [COLUMNS.postDate]: cv.date(mondayDate),
      [COLUMNS.postTrigger]: cv.status(POST_TRIGGER.needsEdits),
      [COLUMNS.status]: cv.status(STATUS.rawDraft),
      [COLUMNS.contentFolder]: cv.link(folder.webViewLink, 'Newsletter folder'),
      [COLUMNS.contentText]: cv.longText(generated.text),
      [COLUMNS.newsletterWordCount]: cv.number(wc),
    },
    groupId ?? undefined,
  );

  // Attach the collected images to the item's file column (it can't hold a URL).
  for (const img of images) {
    try {
      await monday.addFileToColumn(newId, COLUMNS.contentImage, img.bytes, img.filename, img.contentType);
    } catch (err) {
      log.warn('Newsletter: could not attach image to item', { newId, filename: img.filename });
    }
  }

  // 8. Mark each source used (checkbox = idempotency guard) + clear its trigger.
  for (const s of sources) {
    try {
      await monday.updateColumns(s.id, {
        [COLUMNS.newsletterCheckbox]: cv.checkbox(true),
        [COLUMNS.creationTrigger]: cv.status(''),
      });
    } catch (err) {
      await reportError(s.id, 'Newsletter: failed to mark source used', err);
    }
  }

  log.info('Newsletter created', { newId, sources: sources.length, used: sourceContent.length, mondayDate });
  return { created: true, itemId: newId, sources: sourceContent.length };
}
