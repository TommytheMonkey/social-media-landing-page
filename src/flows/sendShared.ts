// Shared send pipeline for Flows 2 & 3.
// The image on the Monday file column is the source of truth (the team may swap
// in a Canva-finished version during review), so at send time we pull those
// bytes and re-host them to a durable public Blob URL for Buffer to fetch.

import type { MondayItem } from '../types';
import * as monday from '../clients/monday';
import * as google from '../clients/google';
import { uploadPublicImage } from '../clients/blob';

const FOLDER_ID_RE = /folders\/([a-zA-Z0-9_-]+)/;

/**
 * Read the post text from the item's Google Doc (the editable source of truth).
 * Throws with a clear message if the folder/Doc is missing or empty.
 */
export async function resolvePostTextFromDoc(item: MondayItem): Promise<string> {
  const folderUrl = item.folder?.url;
  if (!folderUrl) throw new Error('No Content folder linked — cannot read the Google Doc');
  const folderId = folderUrl.match(FOLDER_ID_RE)?.[1];
  if (!folderId) throw new Error(`Could not parse a Drive folder id from "${folderUrl}"`);

  const docId = await google.findDocInFolder(folderId);
  if (!docId) throw new Error('No Google Doc found in the Content folder');

  const text = (await google.readDocText(docId)).trim();
  if (text.length === 0) throw new Error('The Google Doc is empty');
  return text;
}

/** Word count of the post text (whitespace-delimited). */
export function wordCount(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

/** Resolve a public https image URL for Buffer, or null if the item has none. */
export async function prepareImageUrl(item: MondayItem): Promise<string | null> {
  if (!item.hasImage || item.imageAssetIds.length === 0) return null;

  const assets = await monday.getAssets(item.imageAssetIds);
  const asset = assets.find((a) => a.public_url) ?? assets[0];
  if (!asset?.public_url) throw new Error('Image asset has no downloadable public_url');

  const res = await fetch(asset.public_url);
  if (!res.ok) throw new Error(`Failed to download Monday asset (HTTP ${res.status})`);
  const bytes = Buffer.from(await res.arrayBuffer());
  const contentType = res.headers.get('content-type') ?? 'image/png';
  const filename = asset.name && asset.name.length > 0 ? asset.name : 'image.png';

  return uploadPublicImage(bytes, filename, contentType);
}
