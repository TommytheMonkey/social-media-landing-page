// Shared attachment/file hosting. A user-supplied Attachment (e.g. a PDF) is
// downloaded from its Monday asset URL, pushed to Vercel Blob under a DETERMINISTIC
// downloads/ key, and served from the branded letsgo.takeo.co/downloads/... link.
// Used by Flow 1 (posts) and the newsletter prep scan — same behavior for both.

import type { MondayItem } from '../types';
import * as monday from '../clients/monday';
import { uploadPublicFile } from '../clients/blob';
import { DOWNLOAD_PUBLIC_BASE, MAX_ATTACHMENT_BYTES } from '../config/downloads';

/** Make a filename URL-safe for the deterministic Blob key / branded link. */
export function sanitizeFilename(name: string): string {
  const cleaned = name.normalize('NFKD').replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^-+|-+$/g, '');
  return cleaned.length > 0 ? cleaned : 'file';
}

/**
 * Fetch a URL fully into memory with a HARD size cap. Streams the body and aborts
 * the moment the running total exceeds `maxBytes`, so a missing Content-Length can't
 * lead to an unbounded buffer (the header pre-check is only a cheap fast-path).
 */
export async function downloadCapped(url: string, maxBytes: number): Promise<{ bytes: Buffer; contentType: string }> {
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
export async function hostAttachment(item: MondayItem): Promise<string> {
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
