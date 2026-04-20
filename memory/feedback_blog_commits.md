---
name: blog and commit discipline
description: every user prompt becomes a blog post; commits are stacked in timeline order
type: feedback
originSessionId: 4e4fdb3a-5d52-4155-9133-2788806a5508
---
Every prompt session gets a blog post in `/home/clownbot/plan1/blog/YYYY-MM-DD-slug.md`. This is non-negotiable — do not wait to be asked.

**Format:**
```
# slug title

date: YYYY-MM-DD

---

opening context

---

what happened, section by section

---

resolution / outcome
```

**Repo:** `/home/clownbot/plan1` — blog lives there, not in .plan98 or anywhere else.

**Why:** Full posterity. The blog is the living record of clownbot's work and thinking.

**How to apply:** At the end of every session (or when the user says "blog"), write the post, commit it to plan1 after the events it documents are already committed. Stack chronologically: work commit first, blog commit after.
