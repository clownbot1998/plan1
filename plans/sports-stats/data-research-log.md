# sports-stats data research log

Append-only. Every source we touch, when, what we found, and what rights we
actually have to it — logged before we build anything on top of it, not
after. This is the transparency record for the sports-stats elf's data
foundation.

---

## 2026-07-12 — open data landscape (no fetch, prior knowledge)

Scoped what's realistically usable for MLB/NFL decks, split by actual
licensing status vs. "everyone uses it but it's not officially licensed":

**Explicitly open (safe to vendor as static data, same pattern as lore-game's
PF2e SRD):**
- **nflverse / nflfastR** — CC0, GitHub-hosted, NFL play-by-play/rosters/
  schedules back to 1999+.
- **Retrosheet** — free-for-any-use, MLB play-by-play back to ~1901.
- **Lahman Database** — open-licensed, MLB season-by-season team/player
  stats, 1871–present.

**Free but not officially licensed (community-standard, hobby-use gray
area — fine for a personal build, not for resale):**
- **MLB Stats API** (`statsapi.mlb.com`) — undocumented, no key, live +
  historical.
- **ESPN hidden API** (`site.api.espn.com`) — same deal, both sports.
- **Baseball Savant** — public Statcast pitch-tracking exports (2015+).

**Long-term identity anchor:** Wikidata assigns stable QIDs to every
player/team already. Plan: mint our own UUIDs 1:1 mapped to Wikidata QIDs
as the graph's foreign key, rather than inventing identity from scratch —
mirrors the bulletin-board card model tychi wants to extend this toward.

**Not pursued (real rights, real cost):** Sportradar / Genius Sports —
official league data partners, commercial licensing, not relevant at this
stage.

---

## 2026-07-12 — Shawn Childs, as a domain expert signal (web search)

Asked: who is he, which leagues/formats does he actually work in. Used
WebSearch (two queries), no scraping, just public search snippets + his
own bio pages.

**Findings:**
- NFBC (National Fantasy Baseball Championship) Hall of Famer — 5 Main
  Event titles, 4 AL-only Auction titles, 1 NL-only title, 1 RTFBC overall
  title (2012, $10k). Playing high-stakes since 2004.
- Also plays/writes for: NFFC, RTSports, FFPC, DraftKings, FanDuel,
  Underdog Fantasy, FFW.
- Past roles: Director of Forecasting (MLB & NFL) at Fulltime Fantasy
  Sports; Senior Fantasy Baseball/Football Writer at Sports Illustrated.
- Current outlet: `fantasyanalyst.substack.com`.
- Format specialties visible from his own topic list: AL-only/NL-only
  **auction** formats (a real specialization — most content is
  format-agnostic), NFBC **FAAB strategy** (blind-bid free agency, a
  mechanic casual content mostly ignores), **best ball**, DFS, and NFL
  **player prop parlays**.

Sources (search snippets, not full-text scrapes):
- https://www.si.com/onsi/fantasy/authors/shawnchil
- https://fantasyanalyst.substack.com/
- https://www.youtube.com/watch?v=wlSGZ1927f0
- https://www.linkedin.com/in/shawn-childs-3562a6ab/
- https://fulltimefantasy.com/author/childs-shawngmail-com/
- https://fftoolbox.fulltimefantasy.com/writers/writer.cfm?id=96

---

## 2026-07-12 — Substack archive + RSS pull (WebFetch, foundation gathering)

Goal: establish his actual publishing cadence/topic taxonomy as a real
foundation for deck categories — not to republish his analysis, to learn
the *shape* of how a working high-stakes analyst organizes content.

**Fetched:**
- `https://fantasyanalyst.substack.com/archive` — post list, most-recent-
  first, no visible pagination/"load more" on the page as rendered.
- `https://fantasyanalyst.substack.com/feed` — RSS/XML, 9 items returned
  in this pull (2026-07-09 through 2026-07-12).
- `https://fantasyanalyst.substack.com/p/2026-fantasy-baseball-nfbc-15-team-fd9`
  — one sample article, to check paywall status and structure.
- `https://fantasyanalyst.substack.com/about` — pricing/terms.

**Publishing cadence observed (9 posts, 2026-07-09 → 2026-07-12, ~4 days):**
near-daily, sometimes multiple posts/day (two "Bullpen Report" halves
same day, waiver-wire hitters+pitchers as separate same-day posts).

**Recurring content categories (a real taxonomy, not one I'm inventing):**
- NFBC-specific: "NFBC 15-Team Waiver Wire" (separate Hitters/Pitchers
  posts)
- "Bullpen Report" (relief-pitching-specific, split by half)
- "Minor League Hitting/Pitching Report" (weekly, by farm-system depth)
- "NFL Team Outlooks by Division" (AFC East/North/South seen — a
  division-by-division rollout, still mid-cycle as of this pull)
- "Fantasy Football Early Depth Charts & Projections" (batched "First 8
  Teams" / "Third 8 Teams" style — teams released in groups of 8)

This maps cleanly onto deck structure: **team decks** (division rollout
pattern), **position/role decks** (bullpen, minor-league hitters vs.
pitchers), and a **format dimension** (NFBC/15-team specific vs. generic)
that should probably be its own axis rather than folded into team/position
decks.

**Paywall status — important, logged plainly:**
The About page states *"all content and NFL outlooks will be free until
July 1st while I attempt to build an audience."* Today is July 12 — past
that stated date — yet the sample article fetched was fully visible, no
paywall prompt. Two live possibilities: he extended the free period, or
paywalling is selective (some posts free, some not) and this pull happened
to hit a free one. **Not resolved yet — needs periodic re-checking, not
assumed either way.**

**Rights, stated plainly:** No explicit content-reuse/republication terms
found on the page beyond Substack's standard Privacy/Terms/Collection
Notice footer links. Free-to-read is not the same as free-to-redistribute.
**Decision: we do not scrape or store his article text or original
analysis verbatim.** What's usable here is the *structural signal*
(cadence, taxonomy, which formats/leagues he specializes in) to inform our
own independently-built deck categories and data model — not his written
content as a dataset. If we ever want his actual player calls as a data
layer (e.g. "compare Shawn's ranking to market consensus"), that requires
either explicit permission or building it from his *public* social posts
under fair-use-for-commentary norms, decided separately, not defaulted
into.

---
