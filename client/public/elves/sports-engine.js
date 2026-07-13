// sports-engine.js — entity casts, same shape @plan98/types already uses:
// plain functions, no framework, no build step. Integer(x)/Float(x)/Text(x)
// coerce a primitive; Pitcher(data)/Catcher(data)/BaseballTeam(data) coerce
// a whole record the same way, just with more fields. No zod: this repo has
// no TypeScript anywhere, so a schema library's main draw (compile-time
// inference from the schema) buys nothing here — only runtime shape
// coercion is left on the table, and these functions already do that in
// about as many lines as a zod schema would take to declare.
//
// full position coverage on purpose, not just the fantasy-headline
// positions — the first pass (Pitcher/Catcher/QB/RB/WR/TE) was explicitly
// representative, not the actual roster. Every real MLB and NFL position
// gets its own cast now, including ones with no individual fantasy
// relevance (offensive line still falls through to identity-only, since
// there's no real stat line to invent for it — not laziness, there's
// nothing there).
//
// scales to a new sport in two steps, never touching an existing one:
// 1. write the sport's position casts + its own POSITION_CAST_<SPORT> table
//    (kept separate per sport on purpose — MLB's "SS" is ShortStop, NFL's
//    "SS" is Strong Safety; one shared table would collide the moment a
//    second sport showed up).
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
// sourceIds is a SEPARATE, generic bag for whatever source-native id got
// us here in the first place (an MLB Advanced Media playerId, an ESPN
// athlete id) — real and useful for re-fetching a record, but not a
// Wikidata QID, so it doesn't get to pretend to be one under that name.
function identity(data) {
  return {
    id: Text(data.id) || crypto.randomUUID(),
    qid: data.qid ? Text(data.qid) : null,
    sourceIds: data.sourceIds || {},
    name: Text(data.name),
    team: Text(data.team),
  }
}

// === MLB ===

// starters and relievers/closers share this one cast — `role` is what a
// Bullpen-Report-style deck filters on, not a separate entity type. an
// inning-eating starter and a one-inning closer both have an ERA/WHIP;
// splitting them into different casts would just mean writing the same
// fields twice.
export function Pitcher(data = {}) {
  return {
    ...identity(data),
    position: 'P',
    role: Text(data.role) || 'SP', // 'SP' | 'RP' | 'CL'
    era: Float(data.era ?? 0),
    whip: Float(data.whip ?? 0),
    wins: Integer(data.wins ?? 0),
    losses: Integer(data.losses ?? 0),
    saves: Integer(data.saves ?? 0),
    holds: Integer(data.holds ?? 0),
    blownSaves: Integer(data.blownSaves ?? 0),
    strikeouts: Integer(data.strikeouts ?? 0),
    inningsPitched: Float(data.inningsPitched ?? 0),
    appearances: Integer(data.appearances ?? 0),
    qualityStarts: Integer(data.qualityStarts ?? 0),
  }
}

// every position player needs the same core offensive line — each named
// position adds this plus whatever's specific to actually playing that
// spot (fielding stats where they're real, none for DH since there's
// nothing to field).
function battingLine(data) {
  return {
    avg: Float(data.avg ?? 0),
    obp: Float(data.obp ?? 0),
    slg: Float(data.slg ?? 0),
    homeRuns: Integer(data.homeRuns ?? 0),
    rbi: Integer(data.rbi ?? 0),
    stolenBases: Integer(data.stolenBases ?? 0),
  }
}
function fieldingLine(data) {
  return {
    errors: Integer(data.errors ?? 0),
    fieldingPct: Float(data.fieldingPct ?? 0),
  }
}

export function Catcher(data = {}) {
  return {
    ...identity(data), position: 'C', ...battingLine(data), ...fieldingLine(data),
    caughtStealingPct: Float(data.caughtStealingPct ?? 0),
    passedBalls: Integer(data.passedBalls ?? 0),
  }
}
export function FirstBaseman(data = {}) { return { ...identity(data), position: '1B', ...battingLine(data), ...fieldingLine(data) } }
export function SecondBaseman(data = {}) { return { ...identity(data), position: '2B', ...battingLine(data), ...fieldingLine(data) } }
export function ThirdBaseman(data = {}) { return { ...identity(data), position: '3B', ...battingLine(data), ...fieldingLine(data) } }
export function ShortStop(data = {}) { return { ...identity(data), position: 'SS', ...battingLine(data), ...fieldingLine(data) } }
// LF/CF/RF share this one cast — position stays whichever of the three
// (or bare 'OF') the data actually says, same reasoning as Pitcher's role.
export function Outfielder(data = {}) {
  return {
    ...identity(data), position: Text(data.position) || 'OF', ...battingLine(data), ...fieldingLine(data),
    outfieldAssists: Integer(data.outfieldAssists ?? 0),
  }
}
export function DesignatedHitter(data = {}) { return { ...identity(data), position: 'DH', ...battingLine(data) } }

// generic fallback — bench/utility/unknown position. every named position
// above is preferred when it's known; this exists so a roster dispatch
// never has to throw over an unusual or missing position code.
export function Batter(data = {}) { return { ...identity(data), position: Text(data.position) || 'DH', ...battingLine(data) } }

const POSITION_CAST_MLB = {
  P: Pitcher, C: Catcher,
  '1B': FirstBaseman, '2B': SecondBaseman, '3B': ThirdBaseman, SS: ShortStop,
  LF: Outfielder, CF: Outfielder, RF: Outfielder, OF: Outfielder,
  DH: DesignatedHitter,
}
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

export function TightEnd(data = {}) { return { ...WideReceiver(data), position: 'TE' } }

export function Kicker(data = {}) {
  return {
    ...identity(data), position: 'K',
    fieldGoalsMade: Integer(data.fieldGoalsMade ?? 0),
    fieldGoalAttempts: Integer(data.fieldGoalAttempts ?? 0),
    fieldGoalPct: Float(data.fieldGoalPct ?? 0),
    longestFieldGoal: Integer(data.longestFieldGoal ?? 0),
    extraPointsMade: Integer(data.extraPointsMade ?? 0),
  }
}

export function Punter(data = {}) {
  return {
    ...identity(data), position: 'P',
    punts: Integer(data.punts ?? 0),
    puntYards: Integer(data.puntYards ?? 0),
    avgPuntYards: Float(data.avgPuntYards ?? 0),
    puntsInside20: Integer(data.puntsInside20 ?? 0),
  }
}

// scored as a UNIT (the team's defense/special teams) in standard fantasy
// formats, not per individual player — a roster entry for this IS the
// team, standing in for eleven players at once.
export function TeamDefense(data = {}) {
  return {
    ...identity(data), position: 'DST',
    sacks: Float(data.sacks ?? 0),
    interceptions: Integer(data.interceptions ?? 0),
    fumbleRecoveries: Integer(data.fumbleRecoveries ?? 0),
    defensiveTouchdowns: Integer(data.defensiveTouchdowns ?? 0),
    pointsAllowed: Integer(data.pointsAllowed ?? 0),
    yardsAllowed: Integer(data.yardsAllowed ?? 0),
  }
}

// IDP (individual defensive player) — real positions with real tracked
// stats, relevant the moment a league scores IDP (several formats Shawn
// Childs plays — NFFC/RTSports/FFPC — support it as an option).
export function LineBacker(data = {}) {
  return {
    ...identity(data), position: 'LB',
    tackles: Integer(data.tackles ?? 0),
    sacks: Float(data.sacks ?? 0),
    interceptions: Integer(data.interceptions ?? 0),
    passesDefended: Integer(data.passesDefended ?? 0),
    forcedFumbles: Integer(data.forcedFumbles ?? 0),
  }
}
// DE/DT share this cast — position stays whichever the data says, same
// reasoning as Outfielder/Pitcher's role.
export function DefensiveLineman(data = {}) {
  return {
    ...identity(data), position: Text(data.position) || 'DL',
    tackles: Integer(data.tackles ?? 0),
    sacks: Float(data.sacks ?? 0),
    forcedFumbles: Integer(data.forcedFumbles ?? 0),
    qbHits: Integer(data.qbHits ?? 0),
  }
}
// CB/S/FS/SS(afety) share this cast, same reasoning.
export function DefensiveBack(data = {}) {
  return {
    ...identity(data), position: Text(data.position) || 'DB',
    tackles: Integer(data.tackles ?? 0),
    interceptions: Integer(data.interceptions ?? 0),
    passesDefended: Integer(data.passesDefended ?? 0),
    forcedFumbles: Integer(data.forcedFumbles ?? 0),
  }
}

const POSITION_CAST_NFL = {
  QB: QuarterBack, RB: RunningBack, WR: WideReceiver, TE: TightEnd,
  K: Kicker, P: Punter, DST: TeamDefense, DEF: TeamDefense,
  LB: LineBacker, OLB: LineBacker, ILB: LineBacker, MLB: LineBacker,
  DE: DefensiveLineman, DT: DefensiveLineman, DL: DefensiveLineman, NT: DefensiveLineman,
  CB: DefensiveBack, S: DefensiveBack, FS: DefensiveBack, SS: DefensiveBack, DB: DefensiveBack, SAF: DefensiveBack,
}
// offensive line (T/G/C/OL) has no individual fantasy-relevant stat line
// in any standard or IDP format — identity + position only, not a gap.
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
