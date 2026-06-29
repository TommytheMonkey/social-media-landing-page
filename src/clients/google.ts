// Google Drive + Docs client (service account).
//
// Setup: create a GCP service account, enable the Drive + Docs APIs, put its
// JSON key in GOOGLE_SERVICE_ACCOUNT_JSON (raw JSON or base64), and SHARE the
// Social Media folder with the service account's client_email (Editor).

import { google } from 'googleapis';
import { Readable } from 'node:stream';
import { readFileSync, existsSync } from 'node:fs';
import { POST_TIMEZONE } from '../config/schedule';

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

// --- Gmail send (domain-wide delegation) -------------------------------------
// You cannot send mail "as the service account" — Gmail requires impersonating a
// real Workspace user. One-time setup: a Workspace admin grants this SA's client id
// domain-wide delegation for the gmail.send scope (see the weekly-report docs).
// The impersonated user (`sender`) becomes the From: address.

const GMAIL_SEND_SCOPE = 'https://www.googleapis.com/auth/gmail.send';

function gmailFor(sender: string) {
  const creds = serviceAccount();
  return google.gmail({
    version: 'v1',
    auth: new google.auth.JWT({
      email: creds.client_email,
      key: creds.private_key,
      scopes: [GMAIL_SEND_SCOPE],
      subject: sender, // impersonate this Workspace user
    }),
  });
}

/** RFC 2047-encode a header value when it carries non-ASCII (e.g. an emoji subject). */
function encodeHeader(s: string): string {
  return /[^\x00-\x7F]/.test(s) ? `=?UTF-8?B?${Buffer.from(s, 'utf8').toString('base64')}?=` : s;
}

export interface SendEmailArgs {
  /** Workspace user to send AS (must be authorized via domain-wide delegation). */
  sender: string;
  to: string[];
  subject: string;
  html: string;
  /** Optional display name for the From: header. */
  fromName?: string;
}

/** Send an HTML email as `sender` (impersonated). Throws on API/auth failure. */
export async function sendHtmlEmail(args: SendEmailArgs): Promise<void> {
  const from = args.fromName ? `${encodeHeader(args.fromName)} <${args.sender}>` : args.sender;
  const mime = [
    `From: ${from}`,
    `To: ${args.to.join(', ')}`,
    `Subject: ${encodeHeader(args.subject)}`,
    'MIME-Version: 1.0',
    'Content-Type: text/html; charset="UTF-8"',
    'Content-Transfer-Encoding: base64',
    '',
    Buffer.from(args.html, 'utf8').toString('base64'),
  ].join('\r\n');
  const raw = Buffer.from(mime, 'utf8')
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
  await gmailFor(args.sender).users.messages.send({ userId: 'me', requestBody: { raw } });
}

// --- Google Calendar (mirror scheduled posts) --------------------------------
// Posts scheduled to Buffer are also mirrored as events on a shared Google
// Calendar so the team can see the social plan at a glance. Set GOOGLE_CALENDAR_ID
// to the target calendar's id (e.g. c_xxxxx@group.calendar.google.com). Times are
// stored as UTC instants; the calendar's display timezone is its own setting.
//
// AUTH — two supported models:
//  1) Domain-wide delegation (RECOMMENDED, same as the Gmail send flow). Set
//     GOOGLE_CALENDAR_AS to a Workspace user who has write access to the calendar
//     (typically its owner/creator); the service account impersonates them. The
//     SA's client id must be granted the calendar.events scope in the Workspace
//     Admin console's domain-wide delegation. Use this when the Workspace blocks
//     sharing edit access to "external" accounts (a service account counts as
//     external, so "Make changes to events" is greyed out for it in calendar UI).
//  2) Direct share (only if the Workspace allows external edit sharing). Leave
//     GOOGLE_CALENDAR_AS unset and instead share the calendar with the SA's
//     client_email -> "Make changes to events".

const CALENDAR_SCOPE = 'https://www.googleapis.com/auth/calendar.events';

/** The configured calendar id, or null when the mirror is not enabled. */
function calendarId(): string | null {
  const id = process.env.GOOGLE_CALENDAR_ID;
  return id && id.trim().length > 0 ? id.trim() : null;
}

/** True when GOOGLE_CALENDAR_ID is set — gates all calendar writes + reschedule sync. */
export function calendarConfigured(): boolean {
  return calendarId() !== null;
}

function calendarClient() {
  const creds = serviceAccount();
  // Impersonate a Workspace user (domain-wide delegation) when GOOGLE_CALENDAR_AS
  // is set; otherwise act as the service account itself (direct-share model).
  const subject = process.env.GOOGLE_CALENDAR_AS?.trim();
  return google.calendar({
    version: 'v3',
    auth: new google.auth.JWT({
      email: creds.client_email,
      key: creds.private_key,
      scopes: [CALENDAR_SCOPE],
      ...(subject ? { subject } : {}),
    }),
  });
}

export interface CalendarEventInput {
  summary: string;
  description: string;
  /** ISO-8601 UTC instant for the event start (the post's send time). */
  startUtcISO: string;
  /** ISO-8601 UTC instant for the event end. */
  endUtcISO: string;
}

function eventBody(input: CalendarEventInput) {
  return {
    summary: input.summary,
    description: input.description,
    start: { dateTime: input.startUtcISO, timeZone: POST_TIMEZONE },
    end: { dateTime: input.endUtcISO, timeZone: POST_TIMEZONE },
  };
}

/** Create a calendar event; returns the Google-assigned event id. Throws if the
 *  mirror isn't configured (callers gate on calendarConfigured() first). */
export async function insertCalendarEvent(input: CalendarEventInput): Promise<string> {
  const cid = calendarId();
  if (!cid) throw new Error('GOOGLE_CALENDAR_ID is not set');
  const res = await calendarClient().events.insert({
    calendarId: cid,
    requestBody: eventBody(input),
  });
  const id = res.data.id;
  if (!id) throw new Error('Calendar insert returned no event id');
  return id;
}

/** Update an existing event in place (used to move a post to a new date). */
export async function patchCalendarEvent(eventId: string, input: CalendarEventInput): Promise<void> {
  const cid = calendarId();
  if (!cid) throw new Error('GOOGLE_CALENDAR_ID is not set');
  await calendarClient().events.patch({
    calendarId: cid,
    eventId,
    requestBody: eventBody(input),
  });
}

/** Delete an event. A 404/410 (already gone) is treated as success, not an error. */
export async function deleteCalendarEvent(eventId: string): Promise<void> {
  const cid = calendarId();
  if (!cid) return;
  try {
    await calendarClient().events.delete({ calendarId: cid, eventId });
  } catch (err) {
    const code = (err as { code?: number; response?: { status?: number } })?.code
      ?? (err as { response?: { status?: number } })?.response?.status;
    if (code === 404 || code === 410) return; // already deleted — nothing to do
    throw err;
  }
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
