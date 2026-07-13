# NFL data — attribution

**Source:** [nflverse/nflverse-data](https://github.com/nflverse/nflverse-data), release
`stats_player`, asset `stats_player_week_2025.csv`. CC0-licensed (public domain) —
see the [nflverse-data repo](https://github.com/nflverse/nflverse-data) for the
license file.

**Pulled:** 2026-07-12, via `plans/sports-stats/etl_nfl.ts`.

**Season:** 2025 regular season (the completed season — the 2026 NFL season had
not started at pull time).

**What's in `teams.json`:** all 32 teams (name, conference, division — the
conference/division mapping is a small static table in the ETL script itself,
not from nflverse, since realignment is rare and public knowledge). Each
team's roster is every player who recorded at least one real stat during the
2025 regular season, aggregated from weekly rows into season totals, cast
through `sports-engine.js`'s real entity functions (QuarterBack, RunningBack,
WideReceiver, TightEnd, Kicker, Punter, LineBacker, DefensiveLineman,
DefensiveBack). Offensive linemen and long snappers have no individual
fantasy-relevant stat line in this source and are represented identity-only
(name/team/position), which is correct, not a gap.

**Known gap:** extra points made has no equivalent column in this source file
— `Kicker.extraPointsMade` is 0 for everyone rather than fabricated.
`TeamDefense` (the DST unit fantasy-scoring format) is not populated here —
it needs team-level game-log data (points/yards allowed), not per-player
stats, and wasn't in scope for this pull.

**Note for future re-pulls:** this repo has TWO differently-named release
tags for player weekly stats — `player_stats` (older, stale, capped at the
2024 season, never updated) and `stats_player` (current, the one actually
used here). Confirmed by checking the real row contents, not by trusting the
more "obvious" filename. Worth re-checking which tag is current rather than
assuming, next time this gets re-pulled.
