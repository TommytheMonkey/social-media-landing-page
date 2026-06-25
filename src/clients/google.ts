// Google Drive + Docs client (service account).
//
// Setup: create a GCP service account, enable the Drive + Docs APIs, put its
// JSON key in GOOGLE_SERVICE_ACCOUNT_JSON (raw JSON or base64), and SHARE the
// Social Media folder with the service account's client_email (Editor).

import { google } from 'googleapis';
import { Readable } from 'node:stream';
import { readFileSync, existsSync } from 'node:fs';

const SCOPES = [
  'https://www.googleapis.com/auth/drive',
  'https://www.googleapis.com/auth/documents',
];
const FOLDER_MIME = 'application/vnd.google-apps.folder';
const DOC_MIME = 'application/vnd.google-apps.document';

interface SaCreds {
  client_email: string;
  private_key: string;
}

/** Parse raw JSON or base64-encoded JSON into service-account creds, or null. */
function parseCreds(raw: string): SaCreds | null {
  try {
    const json = raw.trim().startsWith('{') ? raw : Buffer.from(raw, 'base64').toString('utf8');
    const creds = JSON.parse(json);
    if (creds.client_email && creds.private_key) return creds;
  } catch {
    /* fall through */
  }
  return null;
}

/**
 * Resolve service-account creds. Prefers GOOGLE_SERVICE_ACCOUNT_JSON (raw JSON
 * OR base64 — base64 is recommended to avoid newline/quote issues in env files).
 * Falls back to a local creds file (GOOGLE_SERVICE_ACCOUNT_FILE or google_creds.json)
 * for local dev — that file is gitignored and not deployed, so production must use
 * the env var (base64).
 */
function serviceAccount(): SaCreds {
  const env = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  if (env && env.trim().length > 0) {
    const parsed = parseCreds(env);
    if (parsed) return parsed;
    // Set but unparseable (e.g. a multi-line paste mangled by the env loader) —
    // try the file before giving up.
  }
  const candidates = [
    process.env.GOOGLE_SERVICE_ACCOUNT_FILE,
    'google-creds.json',
    'google_creds.json',
  ].filter((p): p is string => Boolean(p));
  for (const filePath of candidates) {
    if (existsSync(filePath)) {
      const parsed = parseCreds(readFileSync(filePath, 'utf8'));
      if (parsed) return parsed;
      throw new Error(`Google creds file "${filePath}" is not valid service-account JSON`);
    }
  }
  throw new Error(
    'No valid Google credentials. Set GOOGLE_SERVICE_ACCOUNT_JSON (JSON or base64) or provide google_creds.json.',
  );
}

function authClient() {
  const creds = serviceAccount();
  return new google.auth.JWT({
    email: creds.client_email,
    key: creds.private_key,
    scopes: SCOPES,
  });
}

function drive() {
  return google.drive({ version: 'v3', auth: authClient() });
}
function docs() {
  return google.docs({ version: 'v1', auth: authClient() });
}

export interface DriveRef {
  id: string;
  webViewLink: string;
}

/** Find a direct child folder by name, or create it. Returns its ref. */
async function ensureFolder(parentId: string, name: string): Promise<DriveRef> {
  const d = drive();
  const safeName = name.replace(/'/g, "\\'");
  const q = `name = '${safeName}' and mimeType = '${FOLDER_MIME}' and '${parentId}' in parents and trashed = false`;
  const found = await d.files.list({
    q,
    fields: 'files(id, webViewLink)',
    pageSize: 1,
    supportsAllDrives: true,
    includeItemsFromAllDrives: true,
  });
  const existing = found.data.files?.[0];
  if (existing?.id) {
    return { id: existing.id, webViewLink: existing.webViewLink ?? folderLink(existing.id) };
  }
  const created = await d.files.create({
    requestBody: { name, mimeType: FOLDER_MIME, parents: [parentId] },
    fields: 'id, webViewLink',
    supportsAllDrives: true,
  });
  const id = created.data.id!;
  return { id, webViewLink: created.data.webViewLink ?? folderLink(id) };
}

function folderLink(id: string): string {
  return `https://drive.google.com/drive/folders/${id}`;
}

/** Ensure a nested path of folders under `rootId`. Returns the leaf folder ref. */
export async function ensureFolderPath(rootId: string, segments: string[]): Promise<DriveRef> {
  let parent: DriveRef = { id: rootId, webViewLink: folderLink(rootId) };
  for (const seg of segments) {
    parent = await ensureFolder(parent.id, seg);
  }
  return parent;
}

/** Create a Google Doc in `folderId` populated with `content`. */
export async function createDoc(
  folderId: string,
  name: string,
  content: string,
): Promise<DriveRef> {
  const d = drive();
  const created = await d.files.create({
    requestBody: { name, mimeType: DOC_MIME, parents: [folderId] },
    fields: 'id, webViewLink',
    supportsAllDrives: true,
  });
  const id = created.data.id!;

  if (content.length > 0) {
    await docs().documents.batchUpdate({
      documentId: id,
      requestBody: {
        requests: [{ insertText: { location: { index: 1 }, text: content } }],
      },
    });
  }
  return { id, webViewLink: created.data.webViewLink ?? `https://docs.google.com/document/d/${id}/edit` };
}

/** Find the (most recently modified) Google Doc inside a folder. Returns its id. */
export async function findDocInFolder(folderId: string): Promise<string | null> {
  const d = drive();
  const res = await d.files.list({
    q: `'${folderId}' in parents and mimeType = '${DOC_MIME}' and trashed = false`,
    fields: 'files(id,name,modifiedTime)',
    orderBy: 'modifiedTime desc',
    pageSize: 1,
    supportsAllDrives: true,
    includeItemsFromAllDrives: true,
  });
  return res.data.files?.[0]?.id ?? null;
}

/** Find a Google Doc by exact name within a folder. Returns its id, or null. */
export async function findDocByName(folderId: string, name: string): Promise<string | null> {
  const d = drive();
  const safeName = name.replace(/'/g, "\\'");
  const res = await d.files.list({
    q: `name = '${safeName}' and '${folderId}' in parents and mimeType = '${DOC_MIME}' and trashed = false`,
    fields: 'files(id)',
    orderBy: 'createdTime',
    pageSize: 1,
    supportsAllDrives: true,
    includeItemsFromAllDrives: true,
  });
  return res.data.files?.[0]?.id ?? null;
}

/** Insert text at the very start of a Google Doc (prepend), leaving prior content below. */
export async function prependToDoc(documentId: string, text: string): Promise<void> {
  if (text.length === 0) return;
  await docs().documents.batchUpdate({
    documentId,
    requestBody: { requests: [{ insertText: { location: { index: 1 }, text } }] },
  });
}

/** Read the plain-text body of a Google Doc. */
export async function readDocText(documentId: string): Promise<string> {
  const res = await docs().documents.get({ documentId });
  let text = '';
  for (const el of res.data.body?.content ?? []) {
    for (const pe of el.paragraph?.elements ?? []) {
      if (pe.textRun?.content) text += pe.textRun.content;
    }
  }
  return text;
}

/** Upload image bytes into a Drive folder. Returns the file ref. */
export async function uploadImage(
  folderId: string,
  name: string,
  bytes: Buffer,
  contentType: string,
): Promise<DriveRef> {
  const d = drive();
  const created = await d.files.create({
    requestBody: { name, parents: [folderId] },
    media: { mimeType: contentType, body: Readable.from(bytes) },
    fields: 'id, webViewLink',
    supportsAllDrives: true,
  });
  const id = created.data.id!;
  return { id, webViewLink: created.data.webViewLink ?? `https://drive.google.com/file/d/${id}/view` };
}
