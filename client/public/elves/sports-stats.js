// sports-stats.js — receiver/transmitter, same shape plan1-hearts already
// proved (QR-unlock, heartbeat presence, persistent-element QR fix), but
// open-ended instead of fixed-4: any number of receivers (real displays —
// a TV, an OBS browser-source) and any number of transmitters (an
// operator's own phone/tablet), all one trust pool per session. Any
// transmitter can cast to any receiver — no exclusive per-receiver lock.
// "pass the torch" and "recover from an error" are the same primitive:
// whoever holds a role can re-share its join code so a new device claims
// that exact role and continues it.
//
// decks are full league data now, sourced two different ways on purpose —
// see plans/sports-stats/data-research-log.md for the full story:
//   MLB  — LIVE. MLB Stats API sends real CORS headers, so this fetches
//          all 30 teams + full active rosters + batch-hydrated season
//          stats straight from the browser, every time. No vendoring.
//   NFL  — VENDORED. ESPN's API sends no CORS headers at all (a direct
//          browser fetch would be blocked, not just rate-limited), so
//          this loads client/public/cdn/nfl/teams.json — all 32 teams,
//          pulled from nflverse (CC0) via plans/sports-stats/etl_nfl.ts,
//          2025 regular season (the completed season — 2026 NFL hadn't
//          started at pull time).
import Self, { linkState, broadcastElf } from '@plan98/elf'
import { ROLE_TIMEOUT_MS, mintRoleId, joinUrl, parseJoinParam, ROOM_MERGE } from './sports-stats-engine.js'
import { BaseballTeam } from './sports-engine.js'

const tag = 'sports-stats'

// chroma green — the same hex v-log.js already established for this
// exact purpose (its own background-color palette calls it out by name,
// distinct from plan98-camera.js's casual 'dodgerblue' default for an
// unrelated live-draw feature). reused, not reinvented.
const CHROMA_GREEN = '#00b140'

const MLB_SEASON = 2026

// module-scope, not $ state — this is fetched data, not shared game
// state; every device loads its own copy independently, same reasoning
// plan1-hearts gives gameId/mySeat. null = not loaded yet.
let MLB_TEAMS = null
let NFL_TEAMS = null
let _mlbLoadStarted = false

function mlbStatLine(person, group) {
  const entry = (person.stats || []).find(s => s.group?.displayName === group)
  return entry?.splits?.[0]?.stat || {}
}

// raw field names Pitcher/Catcher/etc expect, NOT a call to those
// functions directly — BaseballTeam(data).roster already dispatches by
// position (see sports-engine.js), so building the flat input and letting
// IT cast avoids a second dispatch table that could drift out of sync.
function mlbRosterInput(rosterEntry, person, teamName) {
  const pitching = mlbStatLine(person, 'pitching')
  const hitting = mlbStatLine(person, 'hitting')
  return {
    sourceIds: { mlb: String(person.id) }, name: person.fullName, team: teamName,
    position: rosterEntry.position.abbreviation,
    era: Number(pitching.era) || 0, whip: Number(pitching.whip) || 0,
    wins: pitching.wins || 0, losses: pitching.losses || 0, saves: pitching.saves || 0,
    holds: pitching.holds || 0, blownSaves: pitching.blownSaves || 0,
    strikeouts: pitching.strikeOuts || 0, inningsPitched: Number(pitching.inningsPitched) || 0,
    appearances: pitching.gamesPlayed || 0, qualityStarts: pitching.qualityStarts || 0,
    avg: Number(hitting.avg) || 0, obp: Number(hitting.obp) || 0, slg: Number(hitting.slg) || 0,
    homeRuns: hitting.homeRuns || 0, rbi: hitting.rbi || 0, stolenBases: hitting.stolenBases || 0,
    caughtStealingPct: Number(hitting.stolenBasePercentage) || 0, passedBalls: hitting.passedBall || 0,
  }
}

async function ensureMlbLoaded() {
  if (MLB_TEAMS || _mlbLoadStarted) return
  _mlbLoadStarted = true
  try {
    const teamsRes = await fetch(`https://statsapi.mlb.com/api/v1/teams?sportId=1&season=${MLB_SEASON}&activeStatus=Y`).then(r => r.json())
    const teams = teamsRes.teams
    const rosterEntries = await Promise.all(teams.map(async team => {
      const res = await fetch(`https://statsapi.mlb.com/api/v1/teams/${team.id}/roster?rosterType=active&season=${MLB_SEASON}`).then(r => r.json())
      return [team.id, res.roster || []]
    }))
    const rosterByTeam = Object.fromEntries(rosterEntries)
    const allIds = Object.values(rosterByTeam).flat().map(r => r.person.id)
    const peopleById = new Map()
    for (let i = 0; i < allIds.length; i += 50) {
      const chunk = allIds.slice(i, i + 50)
      const url = `https://statsapi.mlb.com/api/v1/people?personIds=${chunk.join(',')}` +
        `&hydrate=${encodeURIComponent(`stats(group=[hitting,pitching],type=season,season=${MLB_SEASON})`)}`
      const data = await fetch(url).then(r => r.json())
      for (const p of data.people || []) peopleById.set(p.id, p)
    }
    MLB_TEAMS = teams.map(team => BaseballTeam({
      sourceIds: { mlb: String(team.id) },
      name: team.name,
      league: (team.league?.name || '').replace('American League', 'AL').replace('National League', 'NL'),
      division: (team.division?.name || '').replace(/^(AL|NL) /, ''),
      roster: rosterByTeam[team.id].filter(r => peopleById.has(r.person.id)).map(r => mlbRosterInput(r, peopleById.get(r.person.id), team.name)),
    }))
  } catch (e) {
    console.error('sports-stats: live MLB load failed, will retry on next deck view', e)
    _mlbLoadStarted = false
    return
  }
  redraw()
}

async function ensureNflLoaded() {
  if (NFL_TEAMS) return
  try {
    NFL_TEAMS = await fetch('/cdn/nfl/teams.json').then(r => r.json())
    redraw()
  } catch (e) { console.error('sports-stats: NFL vendor load failed', e) }
}

// scoped per sport ON PURPOSE, not one shared switch on card.position —
// MLB's Pitcher and NFL's Punter are both position 'P', and MLB's
// ShortStop / NFL's Strong Safety are both 'SS'. A single switch keyed on
// position alone would silently render one sport's fields on the other's
// card the moment both appeared side by side. Same lesson sports-engine.js
// already encoded with its two separate POSITION_CAST tables.
const battingFallback = c => [`AVG ${c.avg}`, `HR ${c.homeRuns}`, `RBI ${c.rbi}`, `SB ${c.stolenBases}`]
const dlLine = c => [`Tkl ${c.tackles}`, `Sacks ${c.sacks}`, `QB Hits ${c.qbHits}`]
const dbLine = c => [`Tkl ${c.tackles}`, `INT ${c.interceptions}`, `PD ${c.passesDefended}`]

const CARD_LINES_MLB = {
  P: c => [`ERA ${c.era}`, `WHIP ${c.whip}`, `${c.role} ${c.wins}-${c.losses}`, `K ${c.strikeouts}`],
  C: c => [`AVG ${c.avg}`, `HR ${c.homeRuns}`, `RBI ${c.rbi}`, `CS% ${c.caughtStealingPct}`],
}
const CARD_LINES_NFL = {
  QB: c => [`Pass Yds ${c.passYards}`, `Pass TD ${c.passTouchdowns}`, `INT ${c.interceptions}`, `Rush Yds ${c.rushYards}`],
  RB: c => [`Rush Yds ${c.rushYards}`, `Rush TD ${c.rushTouchdowns}`, `Rec ${c.receptions}`],
  WR: c => [`Rec ${c.receptions}`, `Rec Yds ${c.receivingYards}`, `Rec TD ${c.receivingTouchdowns}`],
  TE: c => [`Rec ${c.receptions}`, `Rec Yds ${c.receivingYards}`, `Rec TD ${c.receivingTouchdowns}`],
  K: c => [`FG ${c.fieldGoalsMade}/${c.fieldGoalAttempts}`, `Long ${c.longestFieldGoal}`, `XP ${c.extraPointsMade}`],
  P: c => [`Punts ${c.punts}`, `Yds ${c.puntYards}`, `Avg ${c.avgPuntYards}`],
  DST: c => [`Sacks ${c.sacks}`, `INT ${c.interceptions}`, `TD ${c.defensiveTouchdowns}`, `Allowed ${c.pointsAllowed}`],
  LB: c => [`Tkl ${c.tackles}`, `Sacks ${c.sacks}`, `INT ${c.interceptions}`],
  DE: dlLine, DT: dlLine, DL: dlLine,
  CB: dbLine, S: dbLine, FS: dbLine, SS: dbLine, DB: dbLine,
}

// quick cross-team slices — the "Shawn Childs" shape from the research
// log (bullpen report, position-group comparisons) rather than only
// browsing one team's roster at a time. Same roster/card shape as a team
// deck, just flattened across every loaded team and filtered by position.
const MLB_SLICES = [
  { key: 'P', label: 'Pitchers', match: p => p === 'P' },
  { key: 'C', label: 'Catchers', match: p => p === 'C' },
  { key: 'IF', label: 'Infield', match: p => ['1B', '2B', '3B', 'SS'].includes(p) },
  { key: 'OF', label: 'Outfield', match: p => p === 'OF' },
  { key: 'DH', label: 'DH', match: p => p === 'DH' },
]
const NFL_SLICES = [
  { key: 'QB', label: 'Quarterbacks', match: p => p === 'QB' },
  { key: 'RB', label: 'Running Backs', match: p => p === 'RB' },
  { key: 'WR', label: 'Wide Receivers', match: p => p === 'WR' },
  { key: 'TE', label: 'Tight Ends', match: p => p === 'TE' },
  { key: 'K', label: 'Kickers', match: p => p === 'K' },
  { key: 'P', label: 'Punters', match: p => p === 'P' },
  { key: 'IDP', label: 'Defense (IDP)', match: p => ['LB', 'DE', 'DT', 'DL', 'CB', 'S', 'FS', 'SS', 'DB'].includes(p) },
]

function cardLines(card, sport) {
  const table = sport === 'NFL' ? CARD_LINES_NFL : CARD_LINES_MLB
  const fn = table[card.position]
  if (fn) return fn(card)
  // MLB fallback covers every position that shares battingLine (1B/2B/3B/
  // SS/OF/DH/generic Batter) — football has no equivalent shared shape,
  // so an unrecognized NFL position (an O-lineman, a long snapper) just
  // shows what it is, honestly, since there's no real stat line for it.
  return sport === 'NFL' ? [card.position || 'no stat line'] : battingFallback(card)
}

const $ = Self(tag, {
  view: 'boot',        // boot | receiver | transmitter
  receivers: {},       // { [id]: { name, lastSeen, cast: { full, left, right } } }
  transmitters: {},    // { [id]: { name, lastSeen } }
  modalReceiverId: null, // local-only — which receiver's reconnect code is on screen
  activeDeck: null,      // local-only — { sport: 'MLB'|'NFL', mode: 'team'|'slice', key } the transmitter has open
  stagedCardIdx: null,   // local-only — index into the active deck's cards
  targetReceiverId: null, // local-only — which receiver Send acts on
  showSetup: false,       // local-only — receiver's setup/recovery overlay
})

function commit(patch) {
  $.teach(patch, ROOM_MERGE)
  try { broadcastElf(tag, patch, ROOM_MERGE) } catch (e) { console.warn('sports-stats sync:', e) }
}

// MLB_TEAMS/NFL_TEAMS live outside $ (they're fetched data, not shared
// game state), so setting them doesn't trigger a re-render on its own —
// this forces one once they've actually loaded.
function redraw() { $.whisper({ tick: ($.learn().tick || 0) + 1 }) }

// navigation identity, not shared data — same reasoning plan1-hearts
// gives gameId/mySeat: every device computes these independently from its
// own URL/sessionStorage.
let gameId = new URLSearchParams(location.search).get('id') || null
let myKind = null   // 'receiver' | 'transmitter'
let myRoleId = null

function myRoleKey() { return `sports-stats-role-${gameId}` }

;(async function boot() {
  if (!gameId) {
    gameId = crypto.randomUUID()
    history.replaceState(null, '', '?id=' + gameId)
  }

  const params = new URLSearchParams(location.search)
  const join = parseJoinParam(params.get('join'))
  if (join) {
    myKind = join.kind
    myRoleId = join.roleId
    sessionStorage.setItem(myRoleKey(), `${myKind}:${myRoleId}`)
    params.delete('join')
    history.replaceState(null, '', params.toString() ? `?${params}` : location.pathname)
  } else {
    const saved = sessionStorage.getItem(myRoleKey())
    if (saved) { const i = saved.indexOf(':'); myKind = saved.slice(0, i); myRoleId = saved.slice(i + 1) }
  }

  // awaiting the join snapshot before claiming: same fix plan1-hearts
  // needed for its own stateCache race — claiming before the snapshot
  // lands risks the snapshot's blind-replace merge silently stomping the
  // just-claimed role back out of this device's own local view.
  await linkState(tag, gameId)

  // nobody claimed a role via a join link and none was remembered from a
  // prior visit — this device becomes the session's first receiver, same
  // as hearts' root-mints-the-table.
  if (!myKind) {
    myKind = 'receiver'
    myRoleId = mintRoleId()
    sessionStorage.setItem(myRoleKey(), `${myKind}:${myRoleId}`)
  }

  claimRole()
  $.whisper({ view: myKind })
})()

function claimRole() {
  const name = myKind === 'transmitter'
    ? (sessionStorage.getItem(`sports-stats-name-${gameId}`) || (() => {
        const n = prompt("What's your operator name?") || 'Transmitter'
        sessionStorage.setItem(`sports-stats-name-${gameId}`, n)
        return n
      })())
    : (sessionStorage.getItem(`sports-stats-name-${gameId}`) || 'Receiver')
  commit({ [`${myKind}s`]: { [myRoleId]: { name, lastSeen: Date.now() } } })
}

function heartbeat() {
  if (!myKind) return
  const role = $.learn()[`${myKind}s`][myRoleId]
  if (!role) return
  commit({ [`${myKind}s`]: { [myRoleId]: { ...role, lastSeen: Date.now() } } })
}
setInterval(heartbeat, 2000)

// runs on every connected client — harmless if more than one notices the
// same stale id in the same tick, the tombstone is idempotent.
function releaseStale() {
  const now = Date.now()
  const state = $.learn()
  const patch = {}
  for (const kind of ['receiver', 'transmitter']) {
    const field = `${kind}s`
    const stale = Object.keys(state[field]).filter(id => now - (state[field][id].lastSeen || 0) > ROLE_TIMEOUT_MS[kind])
    if (stale.length) patch[field] = Object.fromEntries(stale.map(id => [id, null]))
  }
  if (Object.keys(patch).length) commit(patch)
}
setInterval(releaseStale, 1000)

function editMyName() {
  if (myKind !== 'transmitter') return
  const n = prompt("What's your operator name?")
  if (!n) return
  sessionStorage.setItem(`sports-stats-name-${gameId}`, n)
  const role = $.learn().transmitters[myRoleId]
  if (role) commit({ transmitters: { [myRoleId]: { ...role, name: n } } })
}

const EMPTY_CAST = { full: null, left: null, right: null }

// any transmitter can cast to any receiver — no exclusive lock, see the
// file header. targetReceiverId defaults to whichever receiver comes
// first if none has been explicitly picked, so Send works immediately
// even before anyone's touched the picker.
function deckTeams(sport) { return sport === 'NFL' ? NFL_TEAMS : MLB_TEAMS }

// activeDeck.mode is 'team' (one roster) or 'slice' (a position group
// flattened across every loaded team, sorted by team so it reads like a
// real comparison sheet, not shuffled roster order).
function resolveDeck(activeDeck) {
  const teams = deckTeams(activeDeck.sport)
  if (!teams) return null
  if (activeDeck.mode === 'team') {
    const team = teams[activeDeck.key]
    return team ? { name: team.name, roster: team.roster } : null
  }
  const slices = activeDeck.sport === 'NFL' ? NFL_SLICES : MLB_SLICES
  const slice = slices.find(s => s.key === activeDeck.key)
  if (!slice) return null
  return { name: slice.label, roster: teams.flatMap(t => t.roster.filter(c => slice.match(c.position))) }
}

function castTo(zone) {
  const { activeDeck, stagedCardIdx, targetReceiverId, receivers } = $.learn()
  if (!activeDeck || stagedCardIdx == null) return
  const targetId = targetReceiverId || Object.keys(receivers)[0]
  if (!targetId || !receivers[targetId]) return
  const card = resolveDeck(activeDeck)?.roster?.[stagedCardIdx]
  if (!card) return
  // sport rides along with the card, not just its bare position string —
  // MLB's Pitcher and NFL's Punter are both position 'P' (and MLB's
  // ShortStop / NFL's Strong Safety are both 'SS'), so cardLines() needs
  // real sport context, not a guess from an ambiguous position code.
  const cast = { sport: activeDeck.sport, card }
  const role = receivers[targetId]
  const nextCast = zone === 'full'
    ? { full: cast, left: null, right: null }
    : { ...(role.cast || EMPTY_CAST), full: null, [zone]: cast }
  commit({ receivers: { [targetId]: { ...role, cast: nextCast } } })
}

function clearCast(zone) {
  const { targetReceiverId, receivers } = $.learn()
  const targetId = targetReceiverId || Object.keys(receivers)[0]
  if (!targetId || !receivers[targetId]) return
  const role = receivers[targetId]
  commit({ receivers: { [targetId]: { ...role, cast: { ...(role.cast || EMPTY_CAST), [zone]: null } } } })
}

// === rendering ===
function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])) }

function roleRow(id, role, actions = '') {
  return `<div class="ss-role-row"><span class="ss-role-name">${esc(role.name)}</span>${actions}</div>`
}

// which <details> accordions are open, tracked OUTSIDE $ state on purpose
// — same fix lore-game already needed for its own accordions. re-rendering
// the template (heartbeat alone does this every 2s) regenerates a plain
// <details> with no memory of whether it was open, snapping it shut on
// every tick. <details>'s own `toggle` event doesn't bubble, so it can't
// go through the usual delegated $.when(...) click handling either —
// afterUpdate attaches a direct .ontoggle per element instead.
const openAccordions = new Set()
function accordionOpenAttr(key) { return openAccordions.has(key) ? 'open' : '' }

function cardCard({ sport, card }) {
  return `
    <div class="ss-cast-card">
      <div class="ss-cast-name">${esc(card.name)}</div>
      <div class="ss-cast-meta">${esc(card.team)} · ${esc(card.position)}</div>
      <div class="ss-cast-lines">${cardLines(card, sport).map(l => `<div>${esc(l)}</div>`).join('')}</div>
    </div>`
}

// bare=true is the pre-connection state: this IS the whole screen (no
// live zones behind it yet), so no backdrop click-to-close and no Close
// button — there's nothing to reveal or hide, only something to wait for.
function receiverSetupPanel(bare) {
  const { transmitters } = $.learn()
  const transmitterRows = Object.entries(transmitters)
    .map(([id, role]) => roleRow(id, role)).join('') || `<div class="ss-empty">no transmitters connected yet</div>`
  return `
    <div class="ss-modal">
      <h2>Receiver setup</h2>
      <div class="ss-qr-block -small">
        <div class="ss-qr-mount" data-qr-mount="invite-transmitter"></div>
        <div class="ss-qr-label">scan to unlock transmitter</div>
      </div>
      <h3>Connected transmitters</h3>
      <div class="ss-role-list">${transmitterRows}</div>
      <details class="ss-recover" data-acc-key="receiver-recover" ${accordionOpenAttr('receiver-recover')}>
        <summary>Recover / add another receiver</summary>
        <div class="ss-qr-block -small">
          <div class="ss-qr-mount" data-qr-mount="reconnect-self"></div>
          <div class="ss-qr-label">scan on a new device to replace THIS receiver</div>
        </div>
        <div class="ss-qr-block -small">
          <div class="ss-qr-mount" data-qr-mount="invite-receiver"></div>
          <div class="ss-qr-label">scan to add a NEW, separate receiver</div>
        </div>
      </details>
      ${bare ? '' : '<button class="ss-mini-btn" data-toggle-setup>Close</button>'}
    </div>`
}

function receiverSetupOverlay() {
  return `<div class="ss-modal-bg" data-toggle-setup>${receiverSetupPanel(false)}</div>`
}

// this receiver's own always-live invite for new transmitters to join the
// trust pool — regenerated fresh once the CURRENT pending one gets
// claimed, so there's always exactly one open invite on screen, forever.
let _pendingTransmitterInvite = mintRoleId()

function receiverView() {
  const { transmitters, receivers, showSetup } = $.learn()
  if (transmitters[_pendingTransmitterInvite]) _pendingTransmitterInvite = mintRoleId()

  // no transmitter has ever connected — this IS the setup screen.
  if (Object.keys(transmitters).length === 0) return `<div class="ss-shell -receiver">${receiverSetupPanel(true)}</div>`

  const myRole = receivers[myRoleId] || {}
  const cast = myRole.cast || EMPTY_CAST
  const body = cast.full
    ? `<div class="ss-zone -full">${cardCard(cast.full)}</div>`
    : `
      <div class="ss-zones">
        <div class="ss-zone -half ${cast.left ? '' : '-key'}">${cast.left ? cardCard(cast.left) : ''}</div>
        <div class="ss-zone -half ${cast.right ? '' : '-key'}">${cast.right ? cardCard(cast.right) : ''}</div>
      </div>`

  return `
    <div class="ss-live">
      ${body}
      <button class="ss-corner-btn" data-toggle-setup title="Setup / recovery">⚙</button>
      ${showSetup ? receiverSetupOverlay() : ''}
    </div>`
}

function receiverListRows(receivers, effectiveTarget) {
  return Object.entries(receivers).map(([id, role]) => `
    <div class="ss-role-row ${id === effectiveTarget ? '-active' : ''}">
      <button class="ss-role-select" data-pick-receiver="${id}">${effectiveTarget && id === effectiveTarget ? '● ' : ''}${esc(role.name)}</button>
      <button class="ss-mini-btn" data-show-reconnect="${id}">reconnect</button>
    </div>`).join('') || `<div class="ss-empty">no receivers online yet</div>`
}

// decks ARE teams now — picking a deck means picking which team's full
// roster to browse. MLB kicks off its live fetch the first time this
// view is ever shown (not on boot — no reason to hit the network before
// anyone's actually browsing decks); NFL's vendored file loads the same
// lazy way.
function teamGrid(teams, sport, loadingLabel) {
  if (!teams) return `<div class="ss-empty">${loadingLabel}</div>`
  return `<div class="ss-deck-grid">${teams.map((t, i) => `<button class="ss-deck-card" data-open-deck="${sport}:team:${i}">${esc(t.name)}</button>`).join('')}</div>`
}

function sliceGrid(teams, sport, slices, loadingLabel) {
  if (!teams) return `<div class="ss-empty">${loadingLabel}</div>`
  return `<div class="ss-deck-grid">${slices.map(s => `<button class="ss-deck-card" data-open-deck="${sport}:slice:${s.key}">${esc(s.label)}</button>`).join('')}</div>`
}

function deckListView() {
  ensureMlbLoaded()
  ensureNflLoaded()
  return `
    <div class="ss-deck-picker">
      <h3>⚾ MLB — quick slices</h3>
      ${sliceGrid(MLB_TEAMS, 'MLB', MLB_SLICES, 'loading live MLB rosters…')}
      <h3>⚾ MLB Teams (live)</h3>
      ${teamGrid(MLB_TEAMS, 'MLB', 'loading live MLB rosters…')}
      <h3>🏈 NFL — quick slices</h3>
      ${sliceGrid(NFL_TEAMS, 'NFL', NFL_SLICES, 'loading NFL rosters…')}
      <h3>🏈 NFL Teams (2025 season)</h3>
      ${teamGrid(NFL_TEAMS, 'NFL', 'loading NFL rosters…')}
    </div>`
}

// staging (back button + staged preview + send row) is sticky at the top
// of the ONE scrolling box the whole panel already is — the roster list
// just flows underneath it in normal document flow, not a second nested
// scroll container of its own.
function handView(activeDeck, stagedCardIdx) {
  const deck = resolveDeck(activeDeck)
  if (!deck) return `<div class="ss-empty">team not loaded</div>`
  const cards = deck.roster
  const staged = stagedCardIdx != null ? cards[stagedCardIdx] : null
  return `
    <div class="ss-hand">
      <div class="ss-hand-sticky">
        <div class="ss-hand-header">
          <button class="ss-back-btn" data-back-to-decks>← Back</button>
          <span class="ss-hand-title">${esc(deck.name)}</span>
        </div>
        <div class="ss-staging">
          ${staged ? `
            <div class="ss-staged-preview">
              <div class="ss-staged-name">${esc(staged.name)}</div>
              <div class="ss-staged-lines">${cardLines(staged, activeDeck.sport).map(l => `<span>${esc(l)}</span>`).join(' · ')}</div>
            </div>
            <div class="ss-send-row">
              <button class="ss-send-btn" data-send="left">Send Left</button>
              <button class="ss-send-btn -full" data-send="full">Send Full</button>
              <button class="ss-send-btn" data-send="right">Send Right</button>
            </div>` : `<div class="ss-empty">tap a card to stage it</div>`}
        </div>
      </div>
      <div class="ss-card-list">
        ${cards.map((c, i) => `
          <button class="ss-card-row ${i === stagedCardIdx ? '-selected' : ''}" data-select-card="${i}">
            <span class="ss-card-name">${esc(c.name)}</span>
            <span class="ss-card-meta">${esc(c.team)} · ${esc(c.position)}</span>
          </button>`).join('')}
      </div>
    </div>`
}

// "casting to" (receiver picker + reconnect) and "pass the torch" are
// top-level-only — once a deck is open the screen is just back + staging
// + roster, nothing else competing for the sticky header's space.
function transmitterView() {
  const { receivers, transmitters, activeDeck, stagedCardIdx, targetReceiverId } = $.learn()
  if (receivers[_pendingReceiverInvite]) _pendingReceiverInvite = mintRoleId()

  if (activeDeck) {
    return `
      <div class="ss-shell -transmitter">
        <div class="ss-panel">${handView(activeDeck, stagedCardIdx)}</div>
      </div>`
  }

  const receiverIds = Object.keys(receivers)
  const effectiveTarget = targetReceiverId || receiverIds[0] || null
  const me = transmitters[myRoleId]

  return `
    <div class="ss-shell -transmitter">
      <div class="ss-panel">
        <div class="ss-tx-header">
          <span class="ss-role-name">${esc(me ? me.name : '')}</span>
          <button class="ss-edit-name" data-edit-name title="Change operator name">✎</button>
        </div>
        <h3>Casting to</h3>
        <div class="ss-role-list">${receiverListRows(receivers, effectiveTarget)}</div>
        ${deckListView()}
        <details class="ss-recover" data-acc-key="transmitter-recover" ${accordionOpenAttr('transmitter-recover')}>
          <summary>Pass the torch (share my control)</summary>
          <div class="ss-qr-block -small">
            <div class="ss-qr-mount" data-qr-mount="reconnect-self"></div>
            <div class="ss-qr-label">scan on a new device to take over as this transmitter</div>
          </div>
        </details>
      </div>
      ${renderReconnectModal()}
    </div>`
}

let _pendingReceiverInvite = mintRoleId()

function renderReconnectModal() {
  const { modalReceiverId } = $.learn()
  if (!modalReceiverId) return ''
  const role = $.learn().receivers[modalReceiverId]
  if (!role) return ''
  return `
    <div class="ss-modal-bg" data-close-modal>
      <div class="ss-modal">
        <h3>${esc(role.name)} — reconnect code</h3>
        <div class="ss-qr-mount" data-qr-mount="reconnect-${modalReceiverId}"></div>
        <div class="ss-qr-label">scan on the replacement device</div>
        <button class="ss-mini-btn" data-close-modal>Close</button>
      </div>
    </div>`
}

function renderApp() {
  const { view } = $.learn()
  if (view === 'receiver') return receiverView()
  if (view === 'transmitter') return transmitterView()
  return `<div class="ss-empty">loading…</div>`
}

// four kinds of persistent, per-purpose QR elements, created once and
// moved into place rather than re-created from a template string — the
// exact fix plan1-hearts needed when diffHTML's un-keyed reconciliation
// bound a corner's qr-code to the wrong seat once churn got frequent
// enough. Keyed by a stable purpose string instead of a fixed seat index,
// since this elf's roles are open-ended, not fixed-4.
const _qrElements = new Map()
function mountQr(target, key, url) {
  const mount = target.querySelector(`[data-qr-mount="${key}"]`)
  if (!mount) return
  if (!_qrElements.has(key)) _qrElements.set(key, document.createElement('qr-code'))
  const el = _qrElements.get(key)
  if (el.getAttribute('src') !== url) el.setAttribute('src', url)
  if (mount.firstElementChild !== el) mount.appendChild(el)
}

function afterUpdate(target) {
  target.querySelectorAll('details[data-acc-key]').forEach(d => {
    d.ontoggle = () => {
      const key = d.dataset.accKey
      if (d.open) openAccordions.add(key)
      else openAccordions.delete(key)
    }
  })

  const origin = location.origin
  if (myKind === 'receiver') {
    mountQr(target, 'invite-transmitter', joinUrl(origin, tag, gameId, 'transmitter', _pendingTransmitterInvite))
    mountQr(target, 'reconnect-self', joinUrl(origin, tag, gameId, 'receiver', myRoleId))
    mountQr(target, 'invite-receiver', joinUrl(origin, tag, gameId, 'receiver', _pendingReceiverInvite))
  } else if (myKind === 'transmitter') {
    mountQr(target, 'reconnect-self', joinUrl(origin, tag, gameId, 'transmitter', myRoleId))
    const modalReceiverId = $.learn().modalReceiverId
    if (modalReceiverId) mountQr(target, `reconnect-${modalReceiverId}`, joinUrl(origin, tag, gameId, 'receiver', modalReceiverId))
  }
}

$.draw(() => {
  try { return renderApp() } catch (e) {
    console.error('sports-stats render error:', e)
    return `<div class="ss-empty">render error — ${esc(e.message)}</div>`
  }
}, { afterUpdate })

export default $

$.when('click', '[data-edit-name]', editMyName)
$.when('click', '[data-show-reconnect]', e => {
  $.whisper({ modalReceiverId: e.target.closest('[data-show-reconnect]').dataset.showReconnect })
})
$.when('click', '[data-close-modal]', () => $.whisper({ modalReceiverId: null }))
$.when('click', '[data-toggle-setup]', () => $.whisper({ showSetup: !$.learn().showSetup }))
$.when('click', '[data-open-deck]', e => {
  const [sport, mode, key] = e.target.closest('[data-open-deck]').dataset.openDeck.split(':')
  $.whisper({ activeDeck: { sport, mode, key: mode === 'team' ? Number(key) : key }, stagedCardIdx: null })
})
$.when('click', '[data-back-to-decks]', () => $.whisper({ activeDeck: null, stagedCardIdx: null }))
$.when('click', '[data-select-card]', e => $.whisper({ stagedCardIdx: Number(e.target.closest('[data-select-card]').dataset.selectCard) }))
$.when('click', '[data-send]', e => castTo(e.target.closest('[data-send]').dataset.send))
$.when('click', '[data-pick-receiver]', e => $.whisper({ targetReceiverId: e.target.closest('[data-pick-receiver]').dataset.pickReceiver }))

// black, white, Courier New — same base accessibility-mode already uses
// (plain text, thin black rules, no color doing the work of hierarchy).
// the one deliberate exception is CHROMA_GREEN: that fill isn't a design
// choice, it's a broadcast requirement (a real keying color for OBS/
// compositing), so it stays exactly what it is regardless of theme.
$.style(`
  & { display: block; height: 100%; width: 100%; overflow: auto; font-family: Courier, 'Courier New', monospace; background: white; color: black; }
  & .ss-shell { min-height: 100%; padding: 1.2rem; box-sizing: border-box; }
  & .ss-panel { width: min(100%, 26rem); margin: 0 auto; display: flex; flex-direction: column; gap: .8rem; }
  & h2 { margin: 0; font-weight: normal; } & h3 { margin: .4rem 0 0; font-size: .85rem; font-weight: normal; text-transform: uppercase; letter-spacing: .04em; opacity: .55; }
  & .ss-qr-block { display: flex; flex-direction: column; align-items: center; gap: .4rem; background: white; border: 1px solid black; padding: 1rem; }
  & .ss-qr-block.-small qr-code { width: 7rem; height: 7rem; }
  & .ss-qr-mount { width: 11rem; height: 11rem; }
  & .ss-qr-mount qr-code { width: 11rem; height: 11rem; display: block; }
  & .ss-qr-label { font-size: .78rem; opacity: .6; text-align: center; }
  & .ss-role-list { display: flex; flex-direction: column; gap: .3rem; }
  & .ss-role-row { display: flex; align-items: center; justify-content: space-between; gap: .5rem; border: 1px solid black; padding: .5rem .7rem; }
  & .ss-role-name { font-weight: normal; }
  & .ss-empty { opacity: .5; font-size: .85rem; padding: .3rem 0; }
  & .ss-recover { border: 1px solid black; padding: .5rem .7rem; }
  & .ss-recover summary { cursor: pointer; font-size: .85rem; opacity: .75; }
  & .ss-mini-btn { font-size: .78rem; background: white; color: black; border: 1px solid black; padding: .3rem .6rem; cursor: pointer; font-family: inherit; }
  & .ss-mini-btn:hover { background: black; color: white; }
  & .ss-tx-header { display: flex; align-items: center; gap: .5rem; }
  & .ss-edit-name { background: none; border: none; color: inherit; opacity: .6; cursor: pointer; font-family: inherit; }
  & .ss-edit-name:hover { opacity: 1; }
  & .ss-deck-picker { border-top: 1px solid black; padding-top: .8rem; }
  & .ss-deck-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(8rem, 1fr)); gap: .4rem; }
  & .ss-deck-card { font-size: .85rem; padding: .6rem .5rem; border: 1px solid black; background: white; color: black; cursor: pointer; font-family: inherit; }
  & .ss-deck-card:hover { background: black; color: white; }
  & .ss-modal-bg { position: fixed; inset: 0; background: rgba(255,255,255,.85); display: flex; align-items: center; justify-content: center; z-index: 50; }
  & .ss-modal { background: white; border: 1px solid black; padding: 1.2rem; display: flex; flex-direction: column; align-items: center; gap: .6rem; max-height: 90vh; overflow-y: auto; }

  & .ss-role-row.-active { outline: 2px solid black; outline-offset: -1px; }
  & .ss-role-select { background: none; border: none; color: inherit; cursor: pointer; padding: 0; text-align: left; font-family: inherit; }

  /* === receiver: live zones, chroma-key when empty === */
  & .ss-live { position: relative; height: 100%; width: 100%; background: white; }
  & .ss-zones { display: flex; height: 100%; width: 100%; }
  & .ss-zone { flex: 1; display: flex; align-items: center; justify-content: center; padding: 1rem; box-sizing: border-box; }
  & .ss-zone.-full { height: 100%; width: 100%; }
  & .ss-zone.-key { background: ${CHROMA_GREEN}; }
  & .ss-cast-card { background: white; border: 1px solid black; padding: 1.4rem 1.8rem; text-align: center; }
  & .ss-cast-name { font-size: 1.4rem; }
  & .ss-cast-meta { opacity: .6; font-size: .85rem; margin-top: .2rem; text-transform: uppercase; letter-spacing: .04em; }
  & .ss-cast-lines { margin-top: .6rem; display: flex; flex-direction: column; gap: .2rem; font-size: 1rem; }
  & .ss-corner-btn { position: absolute; top: .8rem; right: .8rem; background: white; color: black; border: 1px solid black; width: 2.2rem; height: 2.2rem; cursor: pointer; font-size: 1.1rem; }

  /* === transmitter: deck browsing + hand + staging ===
     the panel itself is the only scroll box (see &, overflow: auto,
     above) — the roster list is plain flow content, and the sticky
     block just pins itself to the top of that same scroll as it passes,
     rather than owning a second overflow area of its own. */
  & .ss-hand { display: flex; flex-direction: column; }
  & .ss-hand-sticky { position: sticky; top: 0; background: white; z-index: 5; padding-bottom: .6rem; margin-bottom: .6rem; border-bottom: 1px solid black; display: flex; flex-direction: column; gap: .6rem; }
  & .ss-hand-header { display: flex; align-items: center; gap: .6rem; }
  & .ss-back-btn { background: white; border: 1px solid black; color: black; padding: .3rem .6rem; cursor: pointer; font-family: inherit; }
  & .ss-back-btn:hover { background: black; color: white; }
  & .ss-hand-title { font-weight: normal; }
  & .ss-card-list { display: flex; flex-direction: column; gap: .3rem; }
  & .ss-card-row { display: flex; justify-content: space-between; gap: .5rem; background: white; border: 1px solid black; padding: .5rem .7rem; color: inherit; cursor: pointer; text-align: left; font-family: inherit; }
  & .ss-card-row.-selected { background: black; color: white; }
  & .ss-card-name { font-weight: normal; }
  & .ss-card-meta { opacity: .6; font-size: .85rem; }
  & .ss-staging { border: 1px solid black; padding: .7rem; display: flex; flex-direction: column; gap: .5rem; align-items: center; }
  & .ss-staged-name { font-weight: normal; }
  & .ss-staged-lines { opacity: .75; font-size: .85rem; margin-top: .2rem; }
  & .ss-send-row { display: flex; gap: .5rem; width: 100%; }
  & .ss-send-btn { flex: 1; padding: .55rem 0; border: 1px solid black; background: white; color: black; cursor: pointer; font-family: inherit; }
  & .ss-send-btn:hover { background: black; color: white; }
  & .ss-send-btn.-full { background: black; color: white; }
  & .ss-send-btn.-full:hover { background: white; color: black; }
`)
