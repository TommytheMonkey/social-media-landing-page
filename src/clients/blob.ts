// Vercel Blob — re-hosts image bytes to a durable PUBLIC https URL that Buffer
// can fetch at (possibly future) publish time. Token read from BLOB_READ_WRITE_TOKEN.

import { put } from '@vercel/blob';

/** Upload bytes and return the public URL. */
export async function uploadPublicImage(
  bytes: Buffer,
  filename: string,
  contentType: string,
): Promise<string> {
  const { url } = await put(`content-engine/images/${filename}`, bytes, {
    access: 'public',
    contentType,
    addRandomSuffix: true,
  });
  return url;
}

/**
 * Upload an arbitrary file to a DETERMINISTIC public key under downloads/ (no random
 * suffix), so a stable Vercel rewrite can serve it from the branded domain. `key` must
 * be URL-safe (the caller sanitizes it). Returns the raw Blob URL; the caller derives
 * the branded letsgo.takeo.co/downloads/<key> link from the same key.
 */
export async function uploadPublicFile(
  key: string,
  bytes: Buffer,
  contentType: string,
): Promise<string> {
  const { url } = await put(`content-engine/downloads/${key}`, bytes, {
    access: 'public',
    contentType,
    addRandomSuffix: false,
    allowOverwrite: true,
  });
  return url;
}
