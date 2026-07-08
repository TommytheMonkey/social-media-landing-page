# Rescheduling Posts — The Protocol

How to move a scheduled post to a different day **without tripping the automations**. For the full pipeline walkthrough, see the [Content Engine Guide](CONTENT-ENGINE-GUIDE.md).

---

## The one rule

> **Change the Post Date on the Monday item. Touch nothing else.**

Monday is the source of truth. The engine sweeps every **Scheduled!** item on its 5-minute poll, and when it sees a Post Date that no longer matches what it last synced, it does the whole dance for you:

1. Deletes the old queued post in Buffer (Buffer can't move a post in place).
2. Creates a fresh Buffer post at the new time — same copy, same image.
3. Moves the **Google Calendar** event to match.
4. Leaves a `🔁 Rescheduled to <date>…` note in the item's **Updates**.

**That 🔁 note is your confirmation.** Until you see it, the reschedule hasn't happened yet. If the engine couldn't act safely, it leaves a `⚠️` note instead explaining why — read it before assuming the post moved.

---

## The don'ts

These are the ways to trip the automations. All three feel like reasonable manual shortcuts; none of them are.

| Don't | Why it breaks things |
|---|---|
| **Reschedule inside Buffer** | The engine can't see Buffer-side moves. Monday and the calendar keep showing the old time, and the next time anyone edits the Post Date in Monday, the engine deletes your hand-moved post and re-queues at Monday's time anyway. |
| **Delete the Buffer post by hand** | The Monday item carries the Buffer post ID. Orphan it and nothing gets re-queued — the post silently never sends. |
| **Move the Google Calendar event** | The calendar is a read-only mirror *and* the engine's reschedule baseline. Edits there are never read back. |

---

## Timing rules

- Posts always send at **5:00 AM ET on the Post Date**. You're choosing a *day*, not a time.
- **Move it to tomorrow or later.** There's no guard against picking today after 5 AM ET — don't.
- **After ~5:00 AM ET on send day it's too late.** The post is mid-send or already out; the engine correctly refuses to touch it (no duplicates, ever). If it published and you didn't want it, deleting it on LinkedIn/Instagram is a manual job.
- Changed your mind twice? Fine — each poll re-baselines. Just settle on a date and let the next 5-minute sweep pick it up.

---

## Adjacent moves (different tools for different jobs)

| You want | Do this | Not this |
|---|---|---|
| Different day | Edit **Post Date** | Cancel + re-clear |
| Out **today, now** | **Post Trigger → Post Now!** | Setting Post Date to today |
| Never send it | **Post Trigger → CANCEL!** | Deleting it in Buffer |

---

## Requirements & rare cases

- Reschedule sync needs the **Google Calendar mirror** enabled (`GOOGLE_CALENDAR_ID`). It's on in production today. If it were ever off, Post Date edits after scheduling would do nothing in Buffer — you'd cancel and re-clear instead.
- Only **Scheduled!** items are swept. **Live!** means it already published; **Past Due!** means it was never cleared — fix the date and clear it normally.
- If the engine finds the old Buffer post already gone (e.g. someone broke the "don'ts"), it moves the calendar only and logs a warning — check the item's Updates and re-clear if needed.
