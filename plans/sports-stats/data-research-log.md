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

## 2026-07-12 — first real data pull: 7 players, direct API, no paraphrasing

Replaced the fictional placeholder stat lines in sports-stats.js's demo
decks with real numbers, pulled via `curl` directly against the two
sources scoped earlier (MLB Stats API, ESPN's hidden API) — not through
an AI-summarized fetch, so the figures are exact, not paraphrased.

**MLB (`statsapi.mlb.com`) — 2026 season-to-date (mid-season, live):**
- Spencer Strider (P, ATL, `people/675911`): ERA 5.31, WHIP 1.36, 4-2, 46 K
- Will Smith (C, LAD, `people/669257`): .249/6 HR/23 RBI
- Freddie Freeman (1B, LAD, `people/518692`): .290/15 HR/49 RBI

Query shape: `people/{id}/stats?stats=season&group=pitching|hitting&season=2026`.

**NFL (ESPN hidden API) — completed 2025 season, not 2026:** the 2026 NFL
season hadn't started at pull time (confirmed via the athlete search
response itself: `season.type.name: "Off Season"`, 2025 marked as the
current/most recent season) — this is real off-season, not a bug in the
pull. Logging it plainly so nobody mistakes a 2025 stat line for a stale
2026 one later.
- Josh Allen (QB, BUF, ESPN athlete `3918298`): 3668 pass yds, 25 pass TD,
  10 INT, 579 rush yds, 14 rush TD
- Bijan Robinson (RB, ATL, ESPN athlete `4430807`): 1478 rush yds, 7 rush
  TD, 79 rec
- CeeDee Lamb (WR, DAL, ESPN athlete `4241389`): 75 rec, 1077 rec yds, 3
  rec TD
- Sam LaPorta (TE, DET, ESPN athlete `4430027`): 40 rec, 489 rec yds, 3
  rec TD

Query shape: `common/v3/sports/football/nfl/athletes/{id}/stats`.

**Identity note:** these source-native ids (MLB `people` id, ESPN athlete
id) are stored on each card's new `sourceIds` field, NOT `qid` — `qid` is
reserved specifically for a real Wikidata QID, which none of these have
yet. Conflating "an id from somewhere" with "the Wikidata anchor" would
have been exactly the kind of quiet mislabeling this log exists to avoid.

**Scope, said plainly:** this is 7 hand-picked players, not a roster or
team pipeline. Confirms the entity-cast layer and the receiver/
transmitter/staging flow all work end-to-end on real numbers — the next
real step up is a genuine ingestion slice (a team's full roster, or a
position group) rather than one-off players fetched by hand.

---

## 2026-07-12 — full position coverage + the real ETL: one live, one vendored

Before the full pipeline: expanded sports-engine.js from the original
representative slice (Pitcher/Catcher/QB/RB/WR/TE) to real, full position
coverage — MLB gets FirstBaseman/SecondBaseman/ThirdBaseman/ShortStop/
Outfielder/DesignatedHitter (sharing a common battingLine/fieldingLine),
Pitcher gained a `role` field (SP/RP/CL, one cast not three, since a
starter and a closer share the same stat shape); NFL gained Kicker,
Punter, TeamDefense, and IDP positions (LineBacker, DefensiveLineman,
DefensiveBack). Offensive linemen still resolve identity-only — genuinely
no individual fantasy stat line exists for them in any format, not a gap.
22 unit tests total now, including one confirming a truly unknown MLB
position code is the only case that falls through to the generic Batter
fallback (every real position has its own cast).

**Checked CORS before deciding architecture, not assumed:**
- MLB Stats API sends `access-control-allow-origin: *` — genuinely
  fetchable live, straight from the browser, no proxy needed.
- ESPN's site API sends NO CORS headers at all — a direct browser fetch
  would be blocked by the browser itself, not just rate-limited. Live NFL
  from ESPN would need a server-side proxy route, which wasn't built
  (a deliberate scope line, not an oversight).

Decision, confirmed with tychi: MLB goes **live** (fetched fresh, full
30 teams + full active rosters + batch-hydrated season stats, straight
from the browser, no vendoring at all). NFL goes **vendored** (nflverse,
periodic pull, committed as JSON) — "one of each" as a deliberate pattern
demo, not an inconsistency.

**NFL ETL, and a real mistake caught before shipping:** first pulled
nflverse's well-known `player_stats.csv` release — 0 rows for the 2025
season. Almost concluded the season simply wasn't published yet (which
would've been a reasonable guess, given the 2026 NFL season situation
already logged above). Checked the actual row contents instead of
guessing: that release is STALE, capped at 2024, apparently abandoned
without ever being updated. A *different*, more recent release tag in
the same repo — `stats_player` (not `player_stats`) — has the real
current data, confirmed by fetching `stats_player_week_2025.csv`
directly and checking its rows. That file also turned out to have full
defensive and kicking columns the older one never had — good, since
sports-engine.js had *just* grown Kicker/Punter/IDP casts with nothing
real to populate them yet.

**Result:** `client/public/cdn/nfl/teams.json` — all 32 teams, 2019
distinct players who recorded a real stat in the 2025 regular season,
aggregated from weekly rows into season totals, cast through the real
entity functions. Cross-checked against the earlier hand-pulled ESPN
numbers for Josh Allen — both sources agree exactly (3668 pass yds, 25
pass TD, 10 INT, 579 rush yds, 14 rush TD), independent confirmation the
aggregation logic is right. Full sourcing, known gaps (no extra-points-
made column in this file; TeamDefense/DST needs team-level game logs
this source doesn't have) logged in `client/public/cdn/nfl/ATTRIBUTION.md`.

MLB's live path needed no ETL script at all — batch-hydration + CORS
means the browser can just ask MLB Stats API directly, every time,
always current. Two working data patterns in one app, on purpose.

---
