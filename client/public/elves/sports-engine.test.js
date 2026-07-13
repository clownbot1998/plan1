// sports-engine.test.js — run with: deno test --allow-read client/public/elves/sports-engine.test.js
import { assert, assertEquals, assertThrows } from 'jsr:@std/assert'
import {
  Pitcher, Catcher, Batter, BaseballTeam,
  QuarterBack, RunningBack, WideReceiver, TightEnd, AmericanFootballTeam,
  Team, SPORT_TEAM_CAST,
} from './sports-engine.js'

// === identity ===

Deno.test('identity: mints a UUID when none is supplied', () => {
  const a = Pitcher({ name: 'Cy Young' })
  const b = Pitcher({ name: 'Cy Young' })
  assert(a.id.length > 0)
  assertEquals(new Set([a.id, b.id]).size, 2) // two different mints, not shared state
})

Deno.test('identity: keeps a supplied id and qid rather than minting', () => {
  const p = Pitcher({ id: 'fixed-id', qid: 'Q123', name: 'Cy Young' })
  assertEquals(p.id, 'fixed-id')
  assertEquals(p.qid, 'Q123')
})

Deno.test('identity: sourceIds is a separate bag from qid, empty object when absent', () => {
  assertEquals(Pitcher({ name: 'x' }).sourceIds, {})
  const p = Pitcher({ name: 'x', sourceIds: { mlb: '675911' } })
  assertEquals(p.sourceIds, { mlb: '675911' })
  assertEquals(p.qid, null) // a source-native id is not a Wikidata QID — never conflated
})

Deno.test('identity: qid is null, not undefined, when absent', () => {
  assertEquals(Pitcher({ name: 'x' }).qid, null)
})

// === MLB casts ===

Deno.test('Pitcher: coerces numeric fields and tags position P', () => {
  const p = Pitcher({ name: 'Cy Young', team: 'BOS', era: '1.5', whip: '0.9', wins: '20', strikeouts: '200' })
  assertEquals(p.position, 'P')
  assertEquals(p.era, 1.5)
  assertEquals(p.whip, 0.9)
  assertEquals(p.wins, 20)
  assertEquals(p.strikeouts, 200)
})

Deno.test('Pitcher: missing numeric fields default to 0, not NaN', () => {
  const p = Pitcher({ name: 'nobody' })
  assertEquals(p.era, 0)
  assertEquals(p.saves, 0)
})

Deno.test('Catcher: coerces batting + catching-specific fields, tags position C', () => {
  const c = Catcher({ name: 'Yadi', avg: '.285', homeRuns: '12', caughtStealingPct: '.42' })
  assertEquals(c.position, 'C')
  assertEquals(c.avg, 0.285)
  assertEquals(c.homeRuns, 12)
  assertEquals(c.caughtStealingPct, 0.42)
})

Deno.test('Batter: defaults position to DH when none given', () => {
  assertEquals(Batter({ name: 'x' }).position, 'DH')
})

Deno.test('Batter: keeps whatever position it was given otherwise', () => {
  assertEquals(Batter({ name: 'x', position: '1B' }).position, '1B')
})

Deno.test('BaseballTeam: dispatches each roster slot to the right position cast', () => {
  const team = BaseballTeam({
    name: 'Red Sox', league: 'AL', division: 'East',
    roster: [
      { name: 'Cy Young', position: 'P', era: '2.0' },
      { name: 'Yadi', position: 'C', avg: '.280' },
      { name: 'Some 1B', position: '1B', homeRuns: '30' },
    ],
  })
  assertEquals(team.league, 'AL')
  assertEquals(team.roster.length, 3)
  assertEquals(team.roster[0].position, 'P')
  assertEquals(team.roster[0].era, 2.0)
  assertEquals(team.roster[1].position, 'C')
  assertEquals(team.roster[2].position, '1B') // fell through to Batter, kept its own position
  assertEquals(team.roster[2].homeRuns, 30)
})

// === NFL casts ===

Deno.test('QuarterBack: coerces both passing and rushing lines', () => {
  const qb = QuarterBack({ name: 'x', passYards: '4000', passTouchdowns: '35', rushYards: '200' })
  assertEquals(qb.position, 'QB')
  assertEquals(qb.passYards, 4000)
  assertEquals(qb.passTouchdowns, 35)
  assertEquals(qb.rushYards, 200)
})

Deno.test('TightEnd: reuses WideReceiver\'s shape but overrides position to TE', () => {
  const te = TightEnd({ name: 'x', receptions: '80', receivingYards: '900' })
  assertEquals(te.position, 'TE')
  assertEquals(te.receptions, 80)
  assertEquals(te.receivingYards, 900)
})

Deno.test('AmericanFootballTeam: dispatches skill positions, keeps others identity-only', () => {
  const team = AmericanFootballTeam({
    name: 'Patriots', conference: 'AFC', division: 'East',
    roster: [
      { name: 'a QB', position: 'QB', passYards: '3000' },
      { name: 'a LB', position: 'LB' }, // no stat shape yet — identity only
    ],
  })
  assertEquals(team.roster[0].position, 'QB')
  assertEquals(team.roster[0].passYards, 3000)
  assertEquals(team.roster[1].position, 'LB')
  assertEquals(team.roster[1].passYards, undefined) // confirms it did NOT fall through to a skill-position shape
})

// === the scaling seam ===

Deno.test('Team(sport, data): dispatches to the registered constructor for that sport', () => {
  const mlb = Team('MLB', { name: 'Red Sox', roster: [] })
  const nfl = Team('NFL', { name: 'Patriots', roster: [] })
  assertEquals(mlb.league, '') // BaseballTeam-shaped (has a league field, even if blank)
  assertEquals(nfl.conference, '') // AmericanFootballTeam-shaped
})

Deno.test('Team(sport, data): throws a clear error for an unregistered sport, not a silent undefined', () => {
  assertThrows(() => Team('NHL', { name: 'x' }), Error, 'NHL')
})

Deno.test('SPORT_TEAM_CAST: adding a sport is additive — existing entries stay exactly as registered', () => {
  const before = { ...SPORT_TEAM_CAST }
  Team('MLB', { name: 'x', roster: [] })
  assertEquals(SPORT_TEAM_CAST.MLB, before.MLB)
  assertEquals(SPORT_TEAM_CAST.NFL, before.NFL)
})
