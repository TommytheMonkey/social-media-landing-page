// Shared send pipeline for Flows 2 & 3.
// The image on the Monday file column is the source of truth (the team may swap
// in a Canva-finished version during review), so at send time we pull those
// bytes and re-host them to a durable public Blob URL for Buffer to fetch.

import type { MondayItem } from '../types';
import * as monday from '../clients/monday';
import { uploadPublicImage } from '../clients/blob';

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
