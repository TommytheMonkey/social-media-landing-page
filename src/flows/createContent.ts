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
  // Mark the trigger "~Created~" immediately so neither the original nor its
  // duplicates re-fire (the poll only matches "Create Post!"). Also serves as the
  // visible "this item has been generated" state.
  await monday.updateColumns(
    item.id,
    { [COLUMNS.creationTrigger]: cv.status(CREATION_TRIGGER.created) },
    true, // auto-create the "~Created~" label if it doesn't exist yet
  );

  if (!item.description || item.description.trim().length === 0) {
    await reportError(item.id, 'Flow 1 aborted', new Error('Description is required to create a post'));
    return;
  }

  const platforms: Platform[] = item.platforms.length > 0 ? item.platforms : [DEFAULT_PLATFORM];
  const disambiguate = platforms.length > 1; // include platform in folder path / doc name

  // Generate copy per platform, ISOLATED — one platform's failure must not discard
  // the others (or stall the whole item with the trigger already consumed).
  const generated: GeneratedPost[] = [];
  const failedPlatforms: Platform[] = [];
  for (const p of platforms) {
    try {
      generated.push(await generatePost(item, p));
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
      await materializeCell(item.name, { itemId: cellId, platform: spec.platform, part: spec.part }, disambiguate, createdDate);
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
  await monday.addFileToColumn(itemId, COLUMNS.contentImage, rendered.bytes, rendered.filename, rendered.contentType);
}
