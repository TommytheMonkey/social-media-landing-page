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
