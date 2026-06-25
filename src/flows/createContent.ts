// FLOW 1 — Content creation. Triggered by Creation Trigger == "Create Post!".
//
// Order: clear the trigger FIRST (duplicate_item copies column values, so leaving
// it set would re-trigger every duplicate forever), generate copy per platform,
// duplicate the original into the full part×platform matrix, then materialize
// each cell (Drive folder + Doc + image, then write the Monday columns).

import type { MondayItem, Platform, GeneratedPart } from '../types';
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

const SOCIAL_ROOT_FOLDER_ID = '1Wu0FgCbW1qddaispMxVNqdOt-suFJZqe';

interface Cell {
  itemId: string;
  platform: Platform;
  part: GeneratedPart;
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
  // Clear the trigger immediately so neither the original nor its duplicates re-fire.
  await monday.updateColumns(item.id, { [COLUMNS.creationTrigger]: cv.status('') });

  if (!item.description || item.description.trim().length === 0) {
    await reportError(item.id, 'Flow 1 aborted', new Error('Description is required to create a post'));
    return;
  }

  const platforms: Platform[] = item.platforms.length > 0 ? item.platforms : [DEFAULT_PLATFORM];
  const disambiguate = platforms.length > 1; // include platform in folder path / doc name

  // Generate copy for each platform up front so we know the matrix size.
  const generated = await Promise.all(platforms.map((p) => generatePost(item, p)));

  // Flat cell list: the first cell reuses the original item; the rest are
  // duplicates of the original (inheriting description/backlink/voice + the
  // now-cleared trigger).
  const cellSpecs: Array<{ platform: Platform; part: GeneratedPart }> = [];
  for (const post of generated) {
    for (const part of post.parts) cellSpecs.push({ platform: post.platform, part });
  }

  const createdDate = todayInEastern();
  let materialized = 0;
  for (let i = 0; i < cellSpecs.length; i++) {
    const spec = cellSpecs[i]!;
    // Create + materialize each cell in its own try/catch so a single cell's
    // failure reports on that item and does not orphan/abort the others.
    let cellId = item.id;
    try {
      if (i > 0) cellId = await monday.duplicateItem(item.id, false);
      await materializeCell(item.name, { itemId: cellId, platform: spec.platform, part: spec.part }, disambiguate, createdDate);
      materialized++;
    } catch (err) {
      await reportError(cellId, `Flow 1 cell ${i + 1}/${cellSpecs.length} failed`, err);
    }
  }

  log.info('Flow 1 created posts', { sourceItem: item.id, materialized, total: cellSpecs.length, platforms });
}

async function materializeCell(
  baseTitle: string,
  cell: Cell,
  disambiguate: boolean,
  createdDate: string,
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

  // Doc: "{title}[ - {platform}] - pt. {#} - {YYYY-MM-DD}"
  const docName =
    `${baseTitle}${disambiguate ? ` - ${platform}` : ''} - pt. ${part.partNumber} - ${createdDate}`;
  await google.createDoc(folder.id, docName, part.text);

  // Image: generate base + composite logo, archive in Drive, attach to Monday.
  const rendered = await generatePostImage(part.imagePrompt, `${docName}.png`);
  await google.uploadImage(folder.id, rendered.filename, rendered.bytes, rendered.contentType);

  // Write the Monday columns (everything except the file upload, which is separate).
  await monday.renameItem(itemId, itemName);
  await monday.updateColumns(itemId, {
    [COLUMNS.platform]: cv.dropdown([platform]),
    [COLUMNS.contentText]: cv.longText(part.text),
    [COLUMNS.contentFolder]: cv.link(folder.webViewLink, 'Drive folder'),
    [COLUMNS.status]: cv.status(STATUS.rawDraft),
    [COLUMNS.postTrigger]: cv.status(POST_TRIGGER.needsEdits),
    [COLUMNS.postCheckbox]: cv.checkbox(true),
  });

  // File column cannot hold a URL — upload the bytes so the team sees the image.
  await monday.addFileToColumn(itemId, COLUMNS.contentImage, rendered.bytes, rendered.filename, rendered.contentType);
}
