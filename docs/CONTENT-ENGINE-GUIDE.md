# TakeoffMonkey Content Engine — User Guide

Your content engine lives inside your **Social Media** board in Monday.com. You work entirely in Monday — fill in a few columns, flip a trigger, and the system writes the copy, makes the image, files everything in Google Drive, publishes to LinkedIn/Instagram through Buffer, pulls back performance stats, and writes you a weekly "what's working" report.

You never touch code. You set columns; the robots do the rest.

---

## How it works (the 30-second version)

1. **You** add an item to the board, give it a title + a short brief, and flip **Creation Trigger → Create Post!**
2. **The engine** (within ~5 minutes) writes the post copy, generates an on-brand image, creates a Google Doc + folder, and drops everything back onto the item. Status becomes **Raw Draft**.
3. **You** review the copy in the Google Doc and tweak anything you want.
4. **You** flip **Post Trigger → Clear!** to schedule it (goes out 5:00 AM ET on the Post Date) **or → Post Now!** to publish immediately.
5. **The engine** sends it to LinkedIn/Instagram, marks it **Live!**, then quietly syncs reach/reactions/etc. for the next 7 days and folds it into your weekly learnings report.

> **The golden rule:** the **Google Doc is the source of truth for the copy.** Edit there before you publish. Whatever the Doc says at publish time is what goes out.

---

## Quick start: your first post

1. Create a new item on the board.
2. Fill in:
   - **Name** → your title / topic
   - **Description** → a short brief ("what should this post be about?")
   - **Platform** → LinkedIn or Instagram
   - **Voice** → Tommy, Takeoff Monkey, etc.
   - **Post Date** → the day you want it out
   - *(optional)* **Post Type** → Tip / Trick / Hack · How-to / Playbook · Product Review
3. Flip **Creation Trigger → Create Post!**
4. Wait ~5 minutes. The item fills itself in and turns **Raw Draft**.
5. Open the **Content** link (your Google Drive folder), read the Doc, edit if needed.
6. Flip **Post Trigger → Clear!** (schedule) or **Post Now!** (publish now). Done.

---

## The board at a glance

| Column | What it's for |
|---|---|
| **Name** | The post title / topic |
| **Description** | Your brief — what the post should be about |
| **Platform** | LinkedIn · Instagram · Newsletter · Blog |
| **Post Type** | Tip / Trick / Hack · How-to / Playbook · Product Review |
| **Voice** | Which persona writes it (see below) |
| **Post Date** | The day it publishes (always 5:00 AM ET) |
| **Creation Trigger** | You set this to kick off creation |
| **Post Trigger** | You set this to schedule / publish / cancel |
| **Status** | Where the post is in its life (set by the engine) |
| **Content** | Link to the Google Drive folder (Doc + image) |
| **Content - Text** | The post copy *(also where you paste your own — see "Bring your own")* |
| **Content - Image** | The post image *(drop your own here to use it)* |
| **Backlink** | An optional link you want worked into the post |
| **Attachment** | Drop a file here (e.g. a PDF) to host it + auto-add a download link |
| **Use My Copy** | Check this to use your own copy instead of AI-written |
| **Download Link** | The branded download link the engine generates (auto-filled) |
| **Reach / Comments / Reactions / Shares / Saves / Impressions** | Performance stats (auto-synced) |
| **Stats Last Updated** | When metrics were last refreshed (auto) |

---

## Voices

| Voice | Counts as |
|---|---|
| Tommy | Personal |
| Heidi | Personal |
| Takeoff Monkey | Brand |
| Tommy + TOM | Hybrid |
| Heidi + TOM | Hybrid |
| TBD / Other | (excluded from the "voice" performance comparison) |

*(The "counts as" grouping is what the weekly learnings report uses to compare what's working.)*

---

## Triggers & statuses (your control panel)

### Creation Trigger — *you set this to start*

| Value | What it does |
|---|---|
| **Create Post!** | Generate a social post for this item |
| **Create Newsletter!** | Tag this post to be pulled into the next newsletter |
| **Create Blog!** | *(reserved — blog flow not built yet)* |
| **~Created~** | Set automatically once generation is done — leave it alone |

### Post Trigger — *you set this to publish or manage*

| Value | What it does |
|---|---|
| **Needs Edits** | Default after generation — "this is waiting on you" |
| **Clear!** | Schedule the post (publishes 5:00 AM ET on the Post Date) |
| **Post Now!** | Publish immediately |
| **CANCEL!** | Cancel a scheduled post (un-queues it from Buffer) |
| **Junk** | Throw the item away (moves it to the Garbage group) |

### Status — *the engine sets this; you read it*

| Status | Meaning |
|---|---|
| **Ideation** | Created, not generated yet |
| **Raw Draft** | Content generated — your turn to review |
| **Scheduled!** | Queued in Buffer for its Post Date |
| **Live!** | Published 🎉 |
| **Past Due!** | The Post Date passed without being cleared |
| **Cancelled** | A scheduled post was cancelled |
| **Error - Check Updates** | Something failed — open the item's **Updates** for the reason |

---

## Creating a post (the full picture)

When you flip **Create Post!**, the engine:

- ✅ Writes the post copy in your brand voice (for the platform you chose)
- ✅ Generates a photo-real, on-brand image with your logo
- ✅ Creates a Google Drive folder + Doc and links it in **Content**
- ✅ Sets **Status → Raw Draft**, **Post Trigger → Needs Edits**
- ✅ Flips **Creation Trigger → ~Created~** so it won't re-run

Then you review and publish. That's the standard path.

---

## Bring your own: image, copy, or a file

Sometimes you already have the image, the words, or a document you want to share. Drop them in **before** you flip Create Post!:

### 🖼️ Your own image
Drop your image into **Content - Image**. The engine **uses it and skips image generation** entirely.

### ✍️ Your own copy
1. Check the **Use My Copy** box.
2. Paste your finished post into **Content - Text**.

The engine uses your words **verbatim** — no AI rewriting.
> If you use your own copy **and** don't provide an image, the post goes out **text-only**. Want an image? Drop one in Content - Image.

### 📎 A file to share (PDF, etc.) → auto download link
Drop the file into the **Attachment** column. The engine automatically:
1. Hosts the file,
2. **Generates a branded link** like `letsgo.takeo.co/downloads/your-file.pdf`,
3. Saves it to the **Download Link** column, **and**
4. Works it into the post as a download call-to-action.

You never create or paste a link — it just appears.

**Good to know about attachments:**
- The link is generated at **Create Post!** time. If you add a file to an item that's *already* been generated, flip **Creation Trigger → Create Post!** again to re-run.
- Use a clean filename (e.g. `grade-checklist.pdf`) — it becomes part of the link. Spaces/odd characters are cleaned up automatically.
- Supported: PDFs, images, ZIPs, and most file types. **`.html`/`.htm` files are not supported** — convert to PDF.
- Size limits: **100 MB** per file, **25 MB** for a provided image.
- If hosting ever hiccups, **the post is still created** — just without the link, and you'll see a note on the item.

---

## Reviewing & publishing

After a post is **Raw Draft**:

1. Open the **Content** link → the Google Drive folder.
2. Read/edit the **Doc** (this is the copy that will publish).
3. Swap the image if you like (replace the file in **Content - Image**).
4. Publish:

| You want to… | Flip Post Trigger to… | Result |
|---|---|---|
| Schedule it for 5 AM ET on the Post Date | **Clear!** | Status → **Scheduled!** |
| Publish right now | **Post Now!** | Status → **Live!** |

> **Posting today?** Since scheduling targets 5:00 AM ET on the Post Date, if that time has already passed, use **Post Now!** to go out immediately.

---

## Cancelling or trashing a post

| Situation | What to do | What happens |
|---|---|---|
| A **Scheduled!** post you no longer want | Flip **Post Trigger → CANCEL!** | Un-queued from Buffer, Status → **Cancelled** |
| An idea you want to discard | Flip **Post Trigger → Junk** | Moved to the **Garbage** group (and any queued post is cancelled first) |
| A post that's already **Live!** | (can't un-publish) | You'll be told to delete it on the platform manually |

---

## Changing a scheduled post's date

Already flipped a post to **Scheduled!** but need it to go out on a different day? **Just change the Post Date in Monday** — that's it.

- Within ~5 minutes the engine notices the new date, re-queues the post in Buffer for the new time, and moves its **Google Calendar** entry to match. You'll see a 🔁 note in the item's **Updates** confirming the move.
- You do **not** need to touch Buffer, and you do **not** need to cancel and re-clear. Editing the Post Date is enough.
- This only works while the post is still **Scheduled!** (not yet published). If it's already **Live!**, the date has passed — the post is out and can't be moved.
- Rare safety case: if the post happened to publish in the moment you edited the date, the engine leaves it alone (no duplicate) and tells you in the Updates.

> Reschedule sync + the calendar mirror require the **Google Calendar** integration to be turned on (a one-time `GOOGLE_CALENDAR_ID` setup). If it's off, changing a Post Date after scheduling has **no effect** in Buffer — you'd cancel and re-clear instead.

---

## Google Calendar of everything scheduled

When the calendar mirror is enabled, every post the engine sends to Buffer also appears on a shared **Google Calendar** ("Social Media Content"), at its scheduled send time, titled with the platform, voice, and idea. It's a read-only view of the plan:

- **Scheduling** a post adds it to the calendar; **rescheduling** moves it; **cancelling** or **junking** removes it.
- The calendar is a *mirror* — edit dates in **Monday**, not in Google Calendar (changes made directly in Google Calendar are not read back).

---

## Newsletters

The engine assembles a weekly newsletter from your best posts:

1. On any post you want included, set **Creation Trigger → Create Newsletter!**
2. **Early Friday morning**, the engine gathers all the tagged posts, assembles them into a single draft, and creates a new item in the **Newsletter Prep** group (with the copy in a Google Doc and any images collected).
3. It marks each source post's **Newsletter** box as used, so nothing gets pulled twice.

The assembled newsletter lands as a **Raw Draft** for you to review and send. *(Sending the email is still manual for now — that's a planned next step.)*

---

## Performance stats (automatic)

Once a post is **Live!**, the engine pulls its numbers from Buffer **every morning** and fills these columns:

**Reach · Comments · Reactions · Shares · Saves · Impressions**

- Stats refresh **daily for 7 days** after publishing (engagement keeps climbing, so the numbers grow).
- New posts can take **up to ~24 hours** before any stats appear — that's normal.
- A blank metric means "not reported," **not zero** (e.g. LinkedIn posts won't have Saves).
- **Stats Last Updated** shows the last refresh time.

You don't do anything here — just sort/filter by these columns to see what's landing.

---

## Weekly learnings report

**Late every Sunday night**, the engine writes an advisory **"Performance Learnings"** Google Doc that compares your Live posts and tells you what's working — broken down by:

- **Voice** (Personal vs Brand vs Hybrid)
- **Post Type** (Tip vs How-to vs Review)
- **Day of week**
- **Holiday proximity**

Each new week is added to the top of the same rolling doc, so you can watch trends build.

> **It's honest about small samples.** Anything based on fewer than 8 posts is flagged **"directional only — too early to trust"** and never stated as a conclusion. The report is **advice for you to consider** — it never changes your posts or your brand voice on its own.

---

## When something goes wrong

If a post shows **Status: Error - Check Updates**:

1. Open the item and check its **Updates** (the activity/comments feed) — the engine posts a plain-English reason there.
2. Fix the cause (e.g. add a missing Description).
3. Re-trigger:
   - Creation problem → flip **Creation Trigger → Create Post!** again
   - Publishing problem → flip **Post Trigger → Clear!** (or **Post Now!**) again

The engine is built to never double-post — re-running a step is safe.

---

## Automation schedule (cheat sheet)

| What runs | When |
|---|---|
| Create / schedule / reschedule / post-now / cancel checks | **Every 5 minutes** |
| Nightly safety sweep (past-due + cleanup) | **~1 AM ET** |
| Newsletter assembly | **Early Friday morning** |
| Performance-stats sync | **Every morning (~6–7 AM ET)** |
| Weekly learnings report | **Late Sunday night** |

---

## Tips & gotchas

- ✅ **Edit copy in the Google Doc**, not the Monday text column — the Doc is what publishes.
- ✅ **Drop your image/file/copy in before** flipping Create Post!. Added them late? Just flip **Create Post!** again.
- ✅ **To publish today**, use **Post Now!** (scheduling aims for 5 AM ET, which may have passed).
- ✅ **A required Description** is needed to generate copy — unless you've checked **Use My Copy**, in which case **Content - Text** must be filled.
- ✅ **Let the automation do its thing** — set your triggers and give it ~5 minutes. No need to poke it.
- ⚠️ **`.html` files can't be hosted** — use PDF.
- ⚠️ **Stats lag** — give a new post a day before expecting numbers.

---

*That's the whole engine. You drive it with a handful of columns; everything else — copy, images, scheduling, publishing, stats, and weekly insights — happens for you.*
