// Monday board map — single source of truth for IDs and label values.
// Board: "Social Media" content pipeline.

export const BOARD_ID = '18411954205';

/** Column IDs, keyed by their role in the app. */
export const COLUMNS = {
  description: 'text_mm4mvtmr', // short text — team's post idea (REQUIRED for creation)
  backlink: 'link_mm4mdabt', // link — optional links to include in the post
  platform: 'dropdown_mm33c63g', // dropdown — LinkedIn | Instagram
  voice: 'color_mm4m94nw', // status — which account/persona
  creationTrigger: 'color_mm4mbf7j', // status — Create Post! / Blog! / Newsletter!
  postTrigger: 'color_mm4meks3', // status — Needs Edits / Clear! / Junk / Post Now!
  status: 'status', // status — pipeline status
  postDate: 'date_mm33qjbw', // date — day to post (always 5am ET)
  contentText: 'long_text_mm4mh8gr', // long text — post copy snapshot (populated at Clear!, from the Doc)
  contentImage: 'file_mm33j0pd', // file — generated image (upload bytes; cannot hold a URL)
  contentFolder: 'link_mm4j5agh', // link — Drive folder for the post
  postCheckbox: 'boolean_mm4mxfvy', // checkbox — "Post"
  postWordCount: 'numeric_mm4nh9r1', // numbers — word count of the final post (set at Clear!)
  newsletterCheckbox: 'boolean_mm4mh94v', // checkbox — "Newsletter" (set when a post is used in a newsletter)
  newsletterWordCount: 'numeric_mm4n5xpx', // numbers — word count of the assembled newsletter
} as const;

/** Creation Trigger labels. Only "Create Post!" is in scope for phase 1. */
export const CREATION_TRIGGER = {
  createPost: 'Create Post!',
  createBlog: 'Create Blog!',
  createNewsletter: 'Create Newsletter!',
  /** Set by Flow 1 after a post is created (replaces the "Create Post!" trigger). */
  created: '~Created~',
} as const;

/** Post Trigger labels. */
export const POST_TRIGGER = {
  needsEdits: 'Needs Edits',
  clear: 'Clear!',
  junk: 'Junk',
  postNow: 'Post Now!',
  cancel: 'CANCEL!',
} as const;

/** Status labels. */
export const STATUS = {
  ideation: 'ideation',
  rawDraft: 'Raw Draft',
  scheduled: 'Scheduled!',
  pastDue: 'Past Due!',
  error: 'Error - Check Updates',
  live: 'Live!',
  cancelled: 'Cancelled',
} as const;

/** Platform dropdown labels. */
export const PLATFORM = {
  linkedin: 'LinkedIn',
  instagram: 'Instagram',
} as const;

/** Non-social Platform labels — these must NEVER be sent to Buffer. */
export const NON_SOCIAL_PLATFORMS = ['Newsletter', 'Blog'] as const;

/** Voice (status) labels. */
export const VOICE = {
  tommy: 'Tommy',
  takeoffMonkey: 'Takeoff Monkey',
  heidi: 'Heidi',
  tbd: 'TBD',
  tommyTom: 'Tommy + TOM',
  heidiTom: 'Heidi + TOM',
  other: 'Other',
} as const;

/** Group (by title) that "Junk" items are moved into. */
export const GARBAGE_GROUP_TITLE = 'Garbage';

/** Group (by title) where assembled newsletters are created. */
export const NEWSLETTER_PREP_GROUP_TITLE = 'Newsletter Prep';
