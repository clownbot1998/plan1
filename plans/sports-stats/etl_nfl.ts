#!/usr/bin/env -S deno run --allow-net --allow-write --allow-read
// etl_nfl.ts — NFL is the VENDORED half of the "one live, one vendored"
// pair (MLB fetches live in-browser; ESPN sends no CORS headers, so NFL
// can't). Pulls nflverse's stats_player_week_2025.csv (weekly rows,
// CC0-licensed — see data-research-log.md), aggregates into season
// totals per player, casts each through the REAL sports-engine.js entity
// functions, and writes vendored static JSON under client/public/cdn/nfl/
// — same pattern lore-game used for the PF2e SRD: fetch once, commit the
// slice, no live dependency at runtime.
//
// NOTE: this replaced an earlier attempt against the "player_stats"
// release, which turned out to be a STALE release (last real season:
// 2024, never updated) sitting alongside a newer "stats_player" release
// that actually has 2025 — same repo, two release tags, only one current.
// Worth remembering: a source being CC0/well-known doesn't mean every
// release under it is current; checked the actual row contents, not just
// assumed the well-known filename was the live one.
//
// run with: deno run --allow-net --allow-write --allow-read plans/sports-stats/etl_nfl.ts
import { parse } from 'jsr:@std/csv/parse'
import { AmericanFootballTeam } from '../../client/public/elves/sports-engine.js'

const SEASON = '2025'
const root = new URL('../../', import.meta.url).pathname
const outDir = `${root}client/public/cdn/nfl`

async function csv(url) {
  const text = await (await fetch(url)).text()
  return parse(text, { skipFirstRow: true })
}

// static — conference/division realignment is rare and public knowledge,
// not worth an API round trip for something this stable.
const TEAM_META = {
  ARI: ['NFC', 'West'], ATL: ['NFC', 'South'], BAL: ['AFC', 'North'], BUF: ['AFC', 'East'],
  CAR: ['NFC', 'South'], CHI: ['NFC', 'North'], CIN: ['AFC', 'North'], CLE: ['AFC', 'North'],
  DAL: ['NFC', 'East'], DEN: ['AFC', 'West'], DET: ['NFC', 'North'], GB: ['NFC', 'North'],
  HOU: ['AFC', 'South'], IND: ['AFC', 'South'], JAX: ['AFC', 'South'], KC: ['AFC', 'West'],
  LA: ['NFC', 'West'], LAC: ['AFC', 'West'], LV: ['AFC', 'West'], MIA: ['AFC', 'East'],
  MIN: ['NFC', 'North'], NE: ['AFC', 'East'], NO: ['NFC', 'South'], NYG: ['NFC', 'East'],
  NYJ: ['AFC', 'East'], PHI: ['NFC', 'East'], PIT: ['AFC', 'North'], SEA: ['NFC', 'West'],
  SF: ['NFC', 'West'], TB: ['NFC', 'South'], TEN: ['AFC', 'South'], WAS: ['NFC', 'East'],
}
const TEAM_NAMES = {
  ARI: 'Arizona Cardinals', ATL: 'Atlanta Falcons', BAL: 'Baltimore Ravens', BUF: 'Buffalo Bills',
  CAR: 'Carolina Panthers', CHI: 'Chicago Bears', CIN: 'Cincinnati Bengals', CLE: 'Cleveland Browns',
  DAL: 'Dallas Cowboys', DEN: 'Denver Broncos', DET: 'Detroit Lions', GB: 'Green Bay Packers',
  HOU: 'Houston Texans', IND: 'Indianapolis Colts', JAX: 'Jacksonville Jaguars', KC: 'Kansas City Chiefs',
  LA: 'Los Angeles Rams', LAC: 'Los Angeles Chargers', LV: 'Las Vegas Raiders', MIA: 'Miami Dolphins',
  MIN: 'Minnesota Vikings', NE: 'New England Patriots', NO: 'New Orleans Saints', NYG: 'New York Giants',
  NYJ: 'New York Jets', PHI: 'Philadelphia Eagles', PIT: 'Pittsburgh Steelers', SEA: 'Seattle Seahawks',
  SF: 'San Francisco 49ers', TB: 'Tampa Bay Buccaneers', TEN: 'Tennessee Titans', WAS: 'Washington Commanders',
}
const num = v => Number(v) || 0

// summed across every week played; fg_long is the one field that's a
// MAX, not a sum (a season's longest field goal, not their total length).
const SUM_FIELDS = [
  'passing_yards', 'passing_tds', 'passing_interceptions',
  'rushing_yards', 'rushing_tds',
  'receptions', 'targets', 'receiving_yards', 'receiving_tds',
  'def_tackles_solo', 'def_tackles_with_assist', 'def_sacks', 'def_interceptions', 'def_pass_defended', 'def_fumbles_forced', 'def_qb_hits',
  'fg_made', 'fg_att',
  'punts', 'punt_yards',
]

// deliberately NOT calling QuarterBack()/RunningBack()/etc directly here —
// that would duplicate sports-engine.js's own POSITION_CAST_NFL dispatch
// in a second place that could quietly drift out of sync with it. Build
// the raw field names each cast expects and hand the whole roster array to
// AmericanFootballTeam(), which already dispatches correctly (and is
// already tested). extraPointsMade has no equivalent column in this file
// — left at Kicker's own default (0) rather than invented.
function toRosterInput({ position, name, team, sourceIds, agg, fgLong }) {
  return {
    sourceIds, name, team, position,
    passYards: agg.passing_yards, passTouchdowns: agg.passing_tds, interceptions: agg.passing_interceptions || agg.def_interceptions,
    rushYards: agg.rushing_yards, rushTouchdowns: agg.rushing_tds,
    receptions: agg.receptions, targets: agg.targets, receivingYards: agg.receiving_yards, receivingTouchdowns: agg.receiving_tds,
    tackles: agg.def_tackles_solo + agg.def_tackles_with_assist, sacks: agg.def_sacks, passesDefended: agg.def_pass_defended,
    forcedFumbles: agg.def_fumbles_forced, qbHits: agg.def_qb_hits,
    fieldGoalsMade: agg.fg_made, fieldGoalAttempts: agg.fg_att, fieldGoalPct: agg.fg_att ? agg.fg_made / agg.fg_att : 0, longestFieldGoal: fgLong,
    punts: agg.punts, puntYards: agg.punt_yards, avgPuntYards: agg.punts ? agg.punt_yards / agg.punts : 0,
  }
}

console.log(`fetching nflverse stats_player_week_${SEASON}.csv…`)
const rows = await csv(`https://github.com/nflverse/nflverse-data/releases/download/stats_player/stats_player_week_${SEASON}.csv`)
const seasonRows = rows.filter(r => r.season_type === 'REG')
console.log(`${rows.length} total weekly rows -> ${seasonRows.length} REG-season rows`)

const byPlayer = new Map()
for (const row of seasonRows) {
  const id = row.player_id
  if (!id) continue
  if (!byPlayer.has(id)) {
    byPlayer.set(id, {
      name: row.player_display_name, position: row.position, team: row.team,
      agg: Object.fromEntries(SUM_FIELDS.map(f => [f, 0])), fgLong: 0,
    })
  }
  const entry = byPlayer.get(id)
  entry.team = row.team // last-seen team (handles in-season trades)
  for (const f of SUM_FIELDS) entry.agg[f] += num(row[f])
  entry.fgLong = Math.max(entry.fgLong, num(row.fg_long))
}
console.log(`aggregated to ${byPlayer.size} distinct players`)

const rosterByTeam = {}
for (const [id, p] of byPlayer) {
  if (!TEAM_NAMES[p.team]) continue // skip free agents / team codes not in our static map
  ;(rosterByTeam[p.team] ||= []).push(toRosterInput({ position: p.position, name: p.name, team: TEAM_NAMES[p.team], sourceIds: { nflverse: id }, agg: p.agg, fgLong: p.fgLong }))
}

const teams = Object.keys(TEAM_NAMES).map(abbr => {
  const [conference, division] = TEAM_META[abbr]
  return AmericanFootballTeam({
    sourceIds: { nflAbbr: abbr },
    name: TEAM_NAMES[abbr],
    conference, division,
    roster: rosterByTeam[abbr] || [],
  })
})

await Deno.mkdir(outDir, { recursive: true })
await Deno.writeTextFile(`${outDir}/teams.json`, JSON.stringify(teams, null, 2))
const totalPlayers = teams.reduce((n, t) => n + t.roster.length, 0)
const byPosition = {}
for (const t of teams) for (const p of t.roster) byPosition[p.position] = (byPosition[p.position] || 0) + 1
console.log(`wrote ${teams.length} teams / ${totalPlayers} players (${SEASON} REG season) -> ${outDir}/teams.json`)
console.log('players by position:', byPosition)
