// Config for hosting user-supplied files (e.g. PDFs) and linking them in posts.
// Files go to Vercel Blob under content-engine/downloads/<key>; a vercel.json rewrite
// maps letsgo.takeo.co/downloads/* to the Blob public base, so the visible link is branded.

/** Branded base for hosted file links. Must match the vercel.json /downloads rewrite. */
export const DOWNLOAD_PUBLIC_BASE = 'https://letsgo.takeo.co/downloads';

/** Refuse to host attachments larger than this (protects the function's time/memory). */
export const MAX_ATTACHMENT_BYTES = 100 * 1024 * 1024; // 100 MB

/** Cap on a provided image downloaded from the Content-Image column. */
export const MAX_IMAGE_BYTES = 25 * 1024 * 1024; // 25 MB
