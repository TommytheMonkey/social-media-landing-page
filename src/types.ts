// Shared domain types for the content-engine automation.
// These are the pinned contracts every module imports — keep them stable.

export type Platform = 'LinkedIn' | 'Instagram';

export type Voice =
  | 'Tommy'
  | 'Takeoff Monkey'
  | 'Heidi'
  | 'TBD'
  | 'Tommy + TOM'
  | 'Heidi + TOM'
  | 'Other';

/** A link-column value. */
export interface LinkValue {
  url: string;
  text: string | null;
}

/**
 * A Monday board item parsed into the fields this app cares about.
 * Raw column values are normalized here so flows never touch GraphQL shapes.
 */
export interface MondayItem {
  id: string;
  name: string;
  description: string | null;
  backlink: LinkValue | null;
  /** All platforms selected on the dropdown (may be 0, 1, or 2 at creation). */
  platforms: Platform[];
  /** Convenience: the first selected platform, or null. */
  platform: Platform | null;
  /** ALL raw platform-dropdown labels, including non-social ones (Newsletter/Blog). */
  platformLabels: string[];
  /** Post Type dropdown label (How-to / Playbook | Tip / Trick / Hack | Product Review), or null. */
  postType: string | null;
  voice: Voice | null;
  creationTrigger: string | null;
  postTrigger: string | null;
  status: string | null;
  /** ISO date 'YYYY-MM-DD' or null. */
  postDate: string | null;
  contentText: string | null;
  /** True when the file column already holds at least one file. */
  hasImage: boolean;
  /** Monday asset IDs of files in the file column (resolve to URLs via getAssets). */
  imageAssetIds: string[];
  /** User-authored image prompt/brief — used to generate an image ONLY when none is uploaded. */
  imageBrief: string | null;
  folder: LinkValue | null;
  postChecked: boolean;
  /** True when the "Newsletter" checkbox is set (post already used in a newsletter). */
  newsletterUsed: boolean;
  /** When true, use the provided Content-Text copy verbatim (skip copy generation). */
  useMyCopy: boolean;
  /** Monday asset IDs in the Attachment file column (a file to host + link in the post). */
  attachmentAssetIds: string[];
  /** Branded download link for the hosted Attachment, or null if none yet. */
  downloadLink: LinkValue | null;
  /** Buffer post id the engine recorded on send (column), or null if not sent / pre-column item. */
  bufferPostId: string | null;
}

/** One part of a (possibly multi-part) generated post for a single platform. */
export interface GeneratedPart {
  partNumber: number;
  totalParts: number;
  /** Final post copy, ready to drop in the long-text column and send to Buffer. */
  text: string;
  /** Prompt for gpt-image-1 to render the text-free photoreal base image. */
  imagePrompt: string;
}

/** Generation result for one platform (may be multiple parts). */
export interface GeneratedPost {
  platform: Platform;
  parts: GeneratedPart[];
}

/** Result of uploading/producing an image asset for a single item. */
export interface ImageAsset {
  /** Public https URL Buffer can fetch (Vercel Blob). */
  publicUrl: string;
  /** Raw bytes, reused for the Monday file-column upload and Drive. */
  bytes: Buffer;
  contentType: string;
  filename: string;
}

/** Outcome of a Buffer send. */
export interface BufferSendResult {
  postId: string;
  channelId: string;
}

/** A validation failure with a human-readable reason for the Monday update. */
export interface ValidationResult {
  ok: boolean;
  missing: string[];
}
