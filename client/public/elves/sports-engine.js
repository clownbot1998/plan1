// sports-engine.js — entity casts, same shape @plan98/types already uses:
// plain functions, no framework, no build step. Integer(x)/Float(x)/Text(x)
// coerce a primitive; Pitcher(data)/Catcher(data)/BaseballTeam(data) coerce
// a whole record the same way, just with more fields. No zod: this repo has
// no TypeScript anywhere, so a schema library's main draw (compile-time
// inference from the schema) buys nothing here — only runtime shape
// coercion is left on the table, and these functions already do that in
// about as many lines as a zod schema would take to declare.
//
// scales to a new sport in two steps, never touching an existing one:
// 1. write the sport's position casts + its own POSITION_CAST_<SPORT> table
//    (kept separate per sport on purpose — MLB's "C" is Catcher, NHL's "C"
//    is Center; one shared table would collide the moment a second sport
//    showed up).
// 2. write <Sport>Team(data) and add it to SPORT_TEAM_CAST.
// NOT imported from @plan98/types, on purpose: types.js pulls in plan98.js,
// which imports bare npm specifiers (diffhtml, quickjs-emscripten) that
// only resolve through the browser's importmap — reaching for that here
// would crash instantly under `deno test`. These three are exact copies of
// types.js's own Integer/Float/Text (mirroring the pattern, not reusing the
// module), which keeps this file at zero real imports — same reason
// hearts-engine.js has none — testable with nothing but `deno test`.
function Integer(x) { return parseInt(x, 10) }
function Float(x) { return parseFloat(x) }
function Text(x = '') { return x.toString() }

// every entity gets a UUID (ours, minted if not supplied) and an optional
// Wikidata QID — the cross-source foreign key discussed for the eventual
// graph: our own id is what everything internal points to, qid is how we
// bridge out to enrich a record without owning a heavy ingestion pipeline.
function identity(data) {
  return {
    id: Text(data.id) || crypto.randomUUID(),
    qid: data.qid ? Text(data.qid) : null,
    name: Text(data.name),
    team: Text(data.team),
  }
}

// === MLB ===

export function Pitcher(data = {}) {
  return {
    ...identity(data),
    position: 'P',
    era: Float(data.era ?? 0),
    whip: Float(data.whip ?? 0),
    wins: Integer(data.wins ?? 0),
    losses: Integer(data.losses ?? 0),
    saves: Integer(data.saves ?? 0),
    strikeouts: Integer(data.strikeouts ?? 0),
    inningsPitched: Float(data.inningsPitched ?? 0),
  }
}

export function Catcher(data = {}) {
  return {
    ...identity(data),
    position: 'C',
    avg: Float(data.avg ?? 0),
    obp: Float(data.obp ?? 0),
    slg: Float(data.slg ?? 0),
    homeRuns: Integer(data.homeRuns ?? 0),
    rbi: Integer(data.rbi ?? 0),
    caughtStealingPct: Float(data.caughtStealingPct ?? 0),
    passedBalls: Integer(data.passedBalls ?? 0),
  }
}

// every other MLB position (1B/2B/3B/SS/OF/DH) shares one batting-stat
// shape for now — split out its own function the moment a deck actually
// needs position-specific fielding stats, not before.
export function Batter(data = {}) {
  return {
    ...identity(data),
    position: Text(data.position) || 'DH',
    avg: Float(data.avg ?? 0),
    obp: Float(data.obp ?? 0),
    slg: Float(data.slg ?? 0),
    homeRuns: Integer(data.homeRuns ?? 0),
    rbi: Integer(data.rbi ?? 0),
    stolenBases: Integer(data.stolenBases ?? 0),
  }
}

const POSITION_CAST_MLB = { P: Pitcher, C: Catcher }
function castMlbPlayer(data) { return (POSITION_CAST_MLB[data.position] || Batter)(data) }

export function BaseballTeam(data = {}) {
  return {
    ...identity(data),
    league: Text(data.league),     // 'AL' | 'NL'
    division: Text(data.division), // 'East' | 'Central' | 'West'
    roster: (data.roster || []).map(castMlbPlayer),
  }
}

// === NFL ===

export function QuarterBack(data = {}) {
  return {
    ...identity(data),
    position: 'QB',
    passYards: Integer(data.passYards ?? 0),
    passTouchdowns: Integer(data.passTouchdowns ?? 0),
    interceptions: Integer(data.interceptions ?? 0),
    rushYards: Integer(data.rushYards ?? 0),
    rushTouchdowns: Integer(data.rushTouchdowns ?? 0),
  }
}

export function RunningBack(data = {}) {
  return {
    ...identity(data),
    position: 'RB',
    rushYards: Integer(data.rushYards ?? 0),
    rushTouchdowns: Integer(data.rushTouchdowns ?? 0),
    receptions: Integer(data.receptions ?? 0),
    receivingYards: Integer(data.receivingYards ?? 0),
  }
}

export function WideReceiver(data = {}) {
  return {
    ...identity(data),
    position: 'WR',
    receptions: Integer(data.receptions ?? 0),
    receivingYards: Integer(data.receivingYards ?? 0),
    receivingTouchdowns: Integer(data.receivingTouchdowns ?? 0),
    targets: Integer(data.targets ?? 0),
  }
}

export function TightEnd(data = {}) {
  return { ...WideReceiver(data), position: 'TE' }
}

const POSITION_CAST_NFL = { QB: QuarterBack, RB: RunningBack, WR: WideReceiver, TE: TightEnd }
// anything not fantasy-relevant on its own (OL/DL/LB/DB/K in non-IDP
// formats) just keeps its identity + position, no stat shape yet.
function castNflPlayer(data) { return (POSITION_CAST_NFL[data.position] || (d => ({ ...identity(d), position: Text(d.position) })))(data) }

export function AmericanFootballTeam(data = {}) {
  return {
    ...identity(data),
    conference: Text(data.conference), // 'AFC' | 'NFC'
    division: Text(data.division),     // 'East' | 'North' | 'South' | 'West'
    roster: (data.roster || []).map(castNflPlayer),
  }
}

// === the scaling seam ===
// a new sport registers here and nowhere else — everything above stays
// untouched. Team('MLB', data) / Team('NFL', data) is the generic entry
// point; the named constructors above stay exported too, for call sites
// that already know their sport.
export const SPORT_TEAM_CAST = { MLB: BaseballTeam, NFL: AmericanFootballTeam }
export function Team(sport, data = {}) {
  const cast = SPORT_TEAM_CAST[sport]
  if (!cast) throw new Error(`sports-engine: no Team cast registered for sport "${sport}"`)
  return cast(data)
}
