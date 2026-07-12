// plan1-hearts.js — a card falls, a trick is taken, a heart costs a point.
//
// one tag, one store, one file. the same shape lore-game already proved
// (registry-free here — a table is disposable, nobody needs to reopen last
// week's hand) but golfed down to what a card game actually needs: a public
// table anyone can watch, a private hand only its owner can read, and a
// deck that gets reshuffled by hand.
//
// four seats, numbered clockwise from the corner they occupy on the table
// screen: 0 top-left, 1 top-right, 2 bottom-right, 3 bottom-left. whoever
// opens the root URL with no ?id= at all becomes the table — a spectator,
// not a fifth seat, minted the instant the page loads, no button — and
// hands out a QR per empty corner. scanning one claims that seat forever
// (for this browser tab's lifetime) and nowhere else in the whole app does
// a device hold more than one seat. the table itself never takes an
// action: consensus (see maybeAutoDeal) is the only thing that moves it.
//
// === imports ===
import Self, { linkState, broadcastElf, channel } from '@plan98/elf'
import Cache from '@silly/cache'
import {
  GLYPH, RED, rankOf, suitOf, isHeart, sortHand, HAND_SUIT_ORDER,
  orderedHand, clampFocus, nextRankFocus, nextSuitFocus, suitRun,
  shuffledDeck, dealHands, legalPlays, trickWinner, trickPoints, handDeltas, passRecipient,
  generateKeypair, encryptFor, decryptMine,
} from './hearts-engine.js'

const tag = 'plan1-hearts'
const cache = Cache('hearts-keys') // one record per seat's RSA keypair, keyed `${gameId}:${seat}`

function moveRank(dir) { $.whisper({ focusIdx: nextRankFocus(orderedHand($.learn().myHand), $.learn().focusIdx, dir) }) }
function moveSuit(dir) { $.whisper({ focusIdx: nextSuitFocus(orderedHand($.learn().myHand), $.learn().focusIdx, dir) }) }

// this device's own keypair never leaves it — IndexedDB persistence (via
// Cache, browser-only) is the one part of the crypto flow that belongs
// here rather than in hearts-engine.js, which stays platform-agnostic.
async function ensureKeypair(gameId, seat) {
  const cacheKey = `${gameId}:${seat}`
  const found = await cache.get(cacheKey)
  if (found && found.data) return found.data
  const pair = await generateKeypair()
  await cache.put(cacheKey, pair)
  return pair
}

// === state ===
// seats/dealCipher/passCipher/passSubmitted are keyed "0".."3" and merged
// entry-by-entry (see ROOM_MERGE) so four devices claiming different
// corners, or passing to four different neighbors, in the same second
// never clobber each other. everything else — phase, trick, turn, scores —
// only ever has one legitimate writer at a time (whoever's turn it is,
// or the table dealing), so a plain overwrite is correct, not just simple.
const $ = Self(tag, {
  view: 'boot',       // boot | table | hand
  seats: {},           // { [seat]: { name, publicKeyJwk } }
  phase: 'waiting',    // waiting | passing | playing | hand-end | game-end
  round: 0,
  turn: null,
  trickLeader: null,
  trick: [],           // [{ seat, card }]
  trickCount: 0,
  heartsBroken: false,
  dealCipher: {},
  passCipher: {},
  passSubmitted: {},
  tricksWon: { 0: [], 1: [], 2: [], 3: [] },
  scores: [0, 0, 0, 0],
  lastEvent: null,      // { type, ts, ... } — drives the full-screen flash
  myHand: [],
  selected: [],  // staged for action — up to 3 cards mid-pass, exactly 1 card mid-play
  focusIdx: 0,   // which card in orderedHand(myHand) is centered in the hand carousel
})

const ROOM_MERGE = `(state, payload) => {
  var out = Object.assign({}, state, payload)
  ;['seats','dealCipher','passCipher','passSubmitted'].forEach(function (field) {
    if (payload[field]) out[field] = Object.assign({}, state[field] || {}, payload[field])
  })
  return out
}`

function commit(patch) {
  $.teach(patch, ROOM_MERGE)
  try { broadcastElf(tag, patch, ROOM_MERGE) } catch (e) { console.warn('hearts sync:', e) }
}

// === identity ===
// gameId/mySeat are navigation identity, not shared data — same reasoning
// lore-game gives currentId: every device computes them independently from
// its own URL/sessionStorage, so they have no business living in $ (and no
// business being merged across a network that doesn't know what a "device"
// is).
let gameId = new URLSearchParams(location.search).get('id') || null
let mySeat = null
let myKeypair = null
let _lastDealSeen = null
let _lastPassSeen = null
let _passFlipRound = -1

function consumeClaimParam() {
  const params = new URLSearchParams(location.search)
  const claim = params.get('claim')
  if (claim === null) return
  mySeat = Number(claim)
  sessionStorage.setItem('hearts-seat-' + gameId, String(mySeat))
  params.delete('claim')
  const qs = params.toString()
  history.replaceState(null, '', qs ? `?${qs}` : location.pathname)
}

// "what's your game name?" — the one prompt every plan1-hearts player sees,
// worth keeping as a fixed phrase rather than reinventing "your name"/
// "display name"/"username" per elf. if another card-table-shaped elf ever
// asks a player to name themselves, borrow this line verbatim.
function gameNamePrompt(seat) { return prompt("What's your game name?") || `Seat ${seat + 1}` }

async function claimSeat() {
  myKeypair = await ensureKeypair(gameId, mySeat)
  const name = sessionStorage.getItem('hearts-name-' + gameId) || (() => {
    const n = gameNamePrompt(mySeat)
    sessionStorage.setItem('hearts-name-' + gameId, n)
    return n
  })()
  const publicKeyJwk = await crypto.subtle.exportKey('jwk', myKeypair.publicKey)
  commit({ seats: { [mySeat]: { name, publicKeyJwk, ready: false } } })
}

function toggleReady() {
  if (mySeat === null) return
  const seat = $.learn().seats[mySeat]
  if (!seat) return
  commit({ seats: { [mySeat]: { ...seat, ready: !seat.ready } } })
}

function editGameName() {
  if (mySeat === null) return
  const seat = $.learn().seats[mySeat]
  if (!seat) return
  const n = gameNamePrompt(mySeat)
  sessionStorage.setItem('hearts-name-' + gameId, n)
  commit({ seats: { [mySeat]: { ...seat, name: n } } })
}

// staging: a tap (or hold) on any visible card moves it into the top-half staging
// tray — one card at a time while playing (holding a different card
// swaps it), up to three while passing. nothing commits to the network
// until Confirm; tapping a staged card in the tray un-stages it back to
// the hand, no timer, no auto-commit. one mechanism, one Confirm button,
// for both modalities — see confirmAction().
function stageCard(card) {
  const { phase, selected, passSubmitted } = $.learn()
  if (phase === 'passing') {
    if (passSubmitted[mySeat] || selected.includes(card) || selected.length >= 3) return
    $.whisper({ selected: [...selected, card] })
  } else if (phase === 'playing') {
    $.whisper({ selected: [card] })
  }
}
function unstageCard(card) { $.whisper({ selected: $.learn().selected.filter(c => c !== card) }) }

function canConfirm() {
  const { phase, selected, turn, myHand, heartsBroken, trick, trickCount, passSubmitted } = $.learn()
  if (phase === 'passing') return selected.length === 3 && !passSubmitted[mySeat]
  if (phase === 'playing') return selected.length === 1 && turn === mySeat && legalPlays(myHand, trick, heartsBroken, trickCount === 0).includes(selected[0])
  return false
}

function confirmAction() {
  if (!canConfirm()) return
  const { phase, selected } = $.learn()
  if (phase === 'passing') { submitPass(); return }
  $.whisper({ selected: [] })
  playCard(selected[0])
}

function redraw() { $.whisper({ tick: ($.learn().tick || 0) + 1 }) }

;(async function boot() {
  // no ?id= at all means nobody's claiming a seat — this device IS about
  // to become the table. minting one here and rewriting the URL to match
  // is the same thing PLAY used to do by hand; there's no reason a human
  // needs to be the one who presses it. "JUST FING HRTS" then shows up
  // on the very first paint as the live status screen, not a separate
  // splash in front of it.
  if (!gameId) {
    gameId = crypto.randomUUID()
    history.replaceState(null, '', '?id=' + gameId)
  }
  consumeClaimParam()
  if (mySeat === null) {
    const saved = sessionStorage.getItem('hearts-seat-' + gameId)
    if (saved !== null) mySeat = Number(saved)
  }
  // awaiting the join snapshot before claiming: claimSeat()'s commit() can
  // no longer race stateCache's blind-replace merge, because the snapshot
  // is already applied by the time claimSeat() writes anything.
  await linkState(tag, gameId)
  if (mySeat !== null) await claimSeat()
  $.whisper({ view: mySeat === null ? 'table' : 'hand' })
})()

// === dealing & passing (table-and-hand actions) ===
// the table never clicks anything — dealing is a consequence of consensus
// (see maybeAutoDeal), not an action. resetScores only ever means "the
// previous game just ended," never a manual choice.
async function dealHand(resetScores) {
  const { seats, round, scores } = $.learn()
  const hands = dealHands(shuffledDeck())
  const dealCipher = {}
  for (let seat = 0; seat < 4; seat++) dealCipher[seat] = await encryptFor(seats[seat].publicKeyJwk, hands[seat])
  const leader = hands.findIndex(h => h.includes('2C'))
  const nextRound = resetScores ? 0 : round
  const dir = nextRound % 4 // 0 left · 1 right · 2 across · 3 hold — see passRecipient()
  // ready is per-hand, not per-game: everyone confirms fresh before every
  // deal, this one included — it's the only gate left now that there's no
  // DEAL button anywhere to press instead.
  const seatsReset = Object.fromEntries([0, 1, 2, 3].map(i => [i, { ...seats[i], ready: false }]))
  commit({
    phase: dir === 3 ? 'playing' : 'passing',
    dealCipher, passCipher: {}, passSubmitted: {}, seats: seatsReset,
    trick: [], trickCount: 0, trickLeader: leader, turn: dir === 3 ? leader : null,
    heartsBroken: false, tricksWon: { 0: [], 1: [], 2: [], 3: [] },
    scores: resetScores ? [0, 0, 0, 0] : scores,
    round: nextRound,
    lastEvent: null,
  })
}

// runs on every connected client, but only the table (view === 'table')
// acts on it — exactly one such device exists per game, so there's no
// double-deal race to guard against beyond "don't re-trigger for a round
// we already dealt," which _autoDealtKey covers.
let _autoDealtKey = null
function maybeAutoDeal() {
  if ($.learn().view !== 'table') return
  const { seats, phase, round } = $.learn()
  if (Object.keys(seats).length !== 4) return
  if (![0, 1, 2, 3].every(i => seats[i].ready)) return
  if (phase !== 'waiting' && phase !== 'hand-end' && phase !== 'game-end') return
  const key = phase + ':' + round
  if (_autoDealtKey === key) return
  _autoDealtKey = key
  dealHand(phase === 'game-end')
}

async function submitPass() {
  const { selected, seats, round } = $.learn()
  if (selected.length !== 3) return
  const recipient = passRecipient(mySeat, round)
  const cipher = await encryptFor(seats[recipient].publicKeyJwk, selected)
  $.teach({ myHand: $.learn().myHand.filter(c => !selected.includes(c)), selected: [] })
  commit({ passCipher: { [recipient]: cipher }, passSubmitted: { [mySeat]: true } })
}

async function playCard(card) {
  const { trick, turn, heartsBroken, trickCount, tricksWon } = $.learn()
  if (turn !== mySeat) return
  const legal = legalPlays($.learn().myHand, trick, heartsBroken, trickCount === 0)
  if (!legal.includes(card)) return
  $.teach({ myHand: $.learn().myHand.filter(c => c !== card) })
  const nextTrick = [...trick, { seat: mySeat, card }]
  const brokenNow = heartsBroken || isHeart(card)

  if (nextTrick.length < 4) {
    commit({ trick: nextTrick, heartsBroken: brokenNow, turn: (mySeat + 1) % 4 })
    return
  }

  // fourth card of the trick: whoever plays it resolves the trick. this is
  // a public computation over public data (every card in a completed trick
  // is, definitionally, already revealed) — no privacy left to protect,
  // so any client finishing the trick may safely be the one to score it.
  const winner = trickWinner(nextTrick)
  const won = { ...tricksWon, [winner]: [...tricksWon[winner], ...nextTrick.map(p => p.card)] }
  const count = trickCount + 1

  if (count === 13) {
    const deltas = handDeltas(won)
    const scores = $.learn().scores.map((s, i) => s + deltas[i])
    const moonSeat = deltas.findIndex(d => d === 0) !== -1 && deltas.some(d => d === 26) ? deltas.indexOf(0) : null
    const gameOver = scores.some(s => s >= 100)
    commit({
      trick: [], trickCount: count, tricksWon: won, heartsBroken: brokenNow,
      scores, phase: gameOver ? 'game-end' : 'hand-end',
      round: $.learn().round + 1, // rotates next deal's pass direction — see passRecipient()
      lastEvent: gameOver
        ? { type: 'game-end', ts: Date.now(), winner: scores.indexOf(Math.min(...scores)) }
        : { type: moonSeat !== null ? 'moon-shot' : 'hand-end', ts: Date.now(), seat: moonSeat, deltas },
    })
    return
  }

  commit({
    trick: [], trickCount: count, tricksWon: won, heartsBroken: brokenNow,
    turn: winner, trickLeader: winner,
    lastEvent: { type: 'trick-won', ts: Date.now(), seat: winner, card },
  })
}

// === per-tick local effects ===
// decrypting a fresh deal, absorbing an incoming pass, and flipping
// 'passing' → 'playing' once all four seats have submitted are all things
// only the hand that owns them can do (or, for the phase flip, anyone can
// notice — it's a public fact, not a secret one) — none of them belong in
// commit()'s reducer, so they run here, once per render, cheaply.
async function syncPrivateState() {
  if (mySeat === null || !myKeypair) return
  const { dealCipher, passCipher, phase, passSubmitted, round } = $.learn()

  const mine = dealCipher[mySeat]
  if (mine && mine !== _lastDealSeen) {
    _lastDealSeen = mine
    _lastPassSeen = null
    const hand = await decryptMine(myKeypair.privateKey, mine)
    $.teach({ myHand: sortHand(hand) })
  }

  const incoming = passCipher[mySeat]
  if (incoming && incoming !== _lastPassSeen) {
    _lastPassSeen = incoming
    const cards = await decryptMine(myKeypair.privateKey, incoming)
    $.teach({ myHand: sortHand([...$.learn().myHand, ...cards]) })
  }

  if (phase === 'passing' && Object.keys(passSubmitted).length === 4 && _passFlipRound !== round) {
    _passFlipRound = round
    commit({ phase: 'playing', turn: $.learn().trickLeader })
  }
}

// === rendering ===
function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])) }
function glyph(card) { return rankOf(card) + GLYPH[suitOf(card)] }

// the big, focused card: a center pip plus top-left/bottom-right corner
// marks, same idea real cards use so a partially-covered one is still
// identifiable — here mostly relevant for the -flash variant on the
// table, where the card gets shown large but briefly.
function cardFace(card, extraClass = '') {
  const g = esc(glyph(card))
  return `<div class="h-card ${RED[suitOf(card)] ? '-red' : '-black'} ${extraClass}">
    <span class="h-corner-mark -tl">${g}</span>
    <span class="h-card-pip">${g}</span>
    <span class="h-corner-mark -br">${g}</span>
  </div>`
}

// the small "just a corner" card used for every non-focused card in the
// stack — the whole point of it is to be identifiable at a glance without
// taking up room, so it's plain text with no nested elements (a click's
// target has to BE this button, not a span inside it — $.when matches the
// literal event.target, not closest(), same gotcha documented elsewhere
// in this file and in saga-pitch/lore-game).
function cardMini(card, extraClass = '') {
  return `<button class="h-mini-card ${RED[suitOf(card)] ? '-red' : '-black'} ${extraClass}" data-jump-card="${esc(card)}" data-hold-card="${esc(card)}">${esc(glyph(card))}</button>`
}

const CORNER_CLASS = ['-tl', '-tr', '-br', '-bl']

// red/yellow/green is the one status paradigm this whole elf uses for a
// seat: red = nobody's claimed it yet, yellow = claimed (this device did
// successfully reach the room at least once — broadcastElf only lands a
// seat here after its own connection was live) but hasn't readied up,
// green = readied up. There's no live "went back to red" detection for a
// seat that claimed and then closed their phone mid-game — that would need
// server-side presence tracking for linkState rooms, which doesn't exist
// yet — named here rather than silently pretended away.
function seatStatus(seat) { return !seat ? 'red' : seat.ready ? 'green' : 'yellow' }
function statusDot(seat) { return `<span class="h-dot -${seatStatus(seat)}"></span>` }

function seatCorner(seat) {
  const s = $.learn().seats[seat]
  if (!s) {
    const url = `${location.origin}/app/${$.link}?id=${gameId}&claim=${seat}`
    return `<div class="h-corner ${CORNER_CLASS[seat]}"><qr-code src="${esc(url)}"></qr-code><div class="h-corner-label">Seat ${seat + 1}</div></div>`
  }
  const { turn, tricksWon } = $.learn()
  return `
    <div class="h-corner ${CORNER_CLASS[seat]} ${turn === seat ? '-turn' : ''}">
      <div class="h-corner-name">${statusDot(s)}${esc(s.name)}</div>
      <div class="h-corner-tricks">${(tricksWon[seat] || []).length} pts: ${trickPoints(tricksWon[seat] || [])}</div>
    </div>`
}

// the table is a pure spectator display — nothing on it is ever clicked.
// dealing is a consequence of device consensus (maybeAutoDeal), not a
// button, so this only ever has two things to show: the branded "not
// dealt yet" screen (seats filling, then readying up), or the live hand.
function tableCenter() {
  const { phase, seats, trick, scores } = $.learn()
  const allClaimed = Object.keys(seats).length === 4
  const allReady = allClaimed && [0, 1, 2, 3].every(i => seats[i].ready)
  const dealt = phase === 'passing' || phase === 'playing'

  if (!dealt) {
    const open = 4 - Object.keys(seats).length
    const readyCount = allClaimed ? [0, 1, 2, 3].filter(i => seats[i].ready).length : 0
    const subtitle = !allClaimed ? `${open} Seat${open === 1 ? '' : 's'} Open`
      : !allReady ? `${readyCount}/4 Ready`
      : 'Dealing…'
    return `
      <div class="h-center">
        <div class="h-title">JUST<br>FING<br>HRTS</div>
        <div class="h-waiting-seats">${subtitle}</div>
        ${allClaimed ? `<div class="h-scores">${scores.map((s, i) => `<span>${esc(seats[i].name)}: ${s}</span>`).join('  ·  ')}</div>` : ''}
      </div>`
  }

  const trickHtml = trick.length
    ? `<div class="h-trick">${trick.map(p => `<div class="h-trick-slot ${CORNER_CLASS[p.seat]}">${cardFace(p.card)}</div>`).join('')}</div>`
    : ''

  return `
    <div class="h-center">
      <div class="h-scores">${scores.map((s, i) => `<span>${esc(seats[i].name)}: ${s}</span>`).join('  ·  ')}</div>
      ${trickHtml}
    </div>`
}

function tableView() {
  return `
    <div class="h-felt">
      ${[0, 1, 2, 3].map(seatCorner).join('')}
      ${tableCenter()}
      ${flashOverlay()}
    </div>`
}

function readyRoster(seats) {
  return [0, 1, 2, 3].map(i => {
    const s = seats[i]
    const label = s ? esc(s.name) : `Seat ${i + 1} — open`
    return `<div class="h-roster-row">${statusDot(s)}${label}</div>`
  }).join('')
}

// bottom half: see the whole hand at a glance, always. every suit you
// hold gets a row, always in the same fixed order (clubs, diamonds,
// spades, hearts) — nothing reshuffles position when you navigate. only
// one row is "open" at a time (the current suit): full-size cards, the
// actually-focused one biggest. the other rows stay put, just collapsed
// to a strip of corner-marked minis — an accordion, not a carousel.
// tapping or holding any card (open row or collapsed) stages it, see
// stageCard(); tapping a mini also jumps focus straight to it.
function handStack(myHand, focusIdx, faceClassFor) {
  const cards = orderedHand(myHand)
  if (!cards.length) return `<div class="h-empty">no cards</div>`
  const idx = clampFocus(focusIdx, cards)
  const curSuit = suitOf(cards[idx])

  return HAND_SUIT_ORDER.filter(suit => cards.some(c => suitOf(c) === suit)).map(suit => {
    const suitCards = cards.filter(c => suitOf(c) === suit)
    if (suit !== curSuit) {
      return `<div class="h-suit-row -collapsed">${suitCards.map(c => cardMini(c, faceClassFor(c))).join('')}</div>`
    }
    const openHtml = suitCards.map(c => cards.indexOf(c) === idx
      ? `<div class="h-focus-card" data-hold-card="${esc(c)}">${cardFace(c, faceClassFor(c))}</div>`
      : cardMini(c, faceClassFor(c) + ' -inrow')).join('')
    return `<div class="h-suit-row -open">${openHtml}</div>`
  }).join('')
}

function passDirLabel(round) {
  const dir = round % 4
  return dir === 0 ? 'left' : dir === 1 ? 'right' : dir === 2 ? 'across' : 'hold'
}

// top half: whatever's staged for the current phase, plus Confirm. one
// shape for both modalities — see stageCard()/confirmAction().
function stagingArea() {
  const { phase, selected, round, seats, turn } = $.learn()
  if (phase === 'passing') {
    if ($.learn().passSubmitted[mySeat]) return `<div class="h-waiting">passed — waiting on the table…</div>`
    const slots = [0, 1, 2].map(i => selected[i]
      ? `<button class="h-staged-card" data-unstage="${esc(selected[i])}">${cardFace(selected[i])}</button>`
      : `<div class="h-staged-slot"></div>`).join('')
    return `<div class="h-staged-row">${slots}</div><div class="h-hint-text">tap up to 3 cards to pass ${passDirLabel(round)}</div>`
  }
  if (phase === 'playing') {
    if (turn !== mySeat) return `<div class="h-waiting">${seats[turn] ? esc(seats[turn].name) : 'waiting'}…</div>`
    if (!selected.length) return `<div class="h-waiting">tap a card below to play it</div>`
    return `<button class="h-staged-card" data-unstage="${esc(selected[0])}">${cardFace(selected[0])}</button>`
  }
  // waiting | hand-end | game-end — ready toggle shows before every deal,
  // fresh each hand, not just the game's first (see dealHand()'s reset).
  const mySeatData = seats[mySeat]
  const iAmReady = !!(mySeatData && mySeatData.ready)
  return `
    <button class="h-ready-btn -${iAmReady ? 'green' : 'yellow'}" data-ready>${iAmReady ? '✓ Ready' : 'Ready?'}</button>
    <div class="h-roster">${readyRoster(seats)}</div>`
}

function handView() {
  const { phase, turn, myHand, selected, trickCount, heartsBroken, trick, seats, focusIdx } = $.learn()
  const isPassing = phase === 'passing'
  const legal = phase === 'playing' && turn === mySeat ? legalPlays(myHand, trick, heartsBroken, trickCount === 0) : []
  const mySeatData = seats[mySeat]

  function faceClassFor(card) {
    if (isPassing) return selected.includes(card) ? '-selected' : ''
    if (legal.length) return legal.includes(card) ? '-legal' : '-illegal'
    return ''
  }

  const showConfirm = phase === 'passing' || phase === 'playing'

  return `
    <div class="h-felt -hand">
      <div class="h-top-half">
        <div class="h-hand-header">
          <span class="h-hand-name">${esc(mySeatData ? mySeatData.name : '')}</span>
          <button class="h-edit-name" data-edit-name title="Change game name">✎</button>
          ${showConfirm ? `<button class="h-confirm-btn" data-confirm ${canConfirm() ? '' : 'disabled'}>Confirm</button>` : ''}
        </div>
        <div class="h-staging">${stagingArea()}</div>
      </div>
      <div class="h-bottom-half">${handStack(myHand, focusIdx, faceClassFor)}</div>
      ${flashOverlay()}
    </div>`
}

const FLASH_MS = 2500
function flashOverlay() {
  const { lastEvent, seats } = $.learn()
  if (!lastEvent || Date.now() - lastEvent.ts > FLASH_MS) return ''
  const name = s => (seats[s] ? esc(seats[s].name) : 'Seat ' + (s + 1))
  const body = lastEvent.type === 'trick-won' ? `${cardFace(lastEvent.card, '-flash')}<div class="h-flash-text">${name(lastEvent.seat)} takes the trick</div>`
    : lastEvent.type === 'moon-shot' ? `<div class="h-flash-text -big">🌙 ${name(lastEvent.seat)} SHOT THE MOON</div>`
    : lastEvent.type === 'hand-end' ? `<div class="h-flash-text -big">Hand over</div><div class="h-flash-text">${lastEvent.deltas.map((d, i) => `${name(i)} +${d}`).join('  ·  ')}</div>`
    : lastEvent.type === 'game-end' ? `<div class="h-flash-text -big">🏆 ${name(lastEvent.winner)} WINS</div>`
    : ''
  return `<div class="h-flash">${body}</div>`
}

function renderApp() {
  const { view } = $.learn()
  if (view === 'table') return tableView()
  if (view === 'hand') return handView()
  return `<div class="h-empty">loading…</div>`
}

$.draw(() => {
  syncPrivateState()
  try { return renderApp() } catch (e) {
    console.error('hearts render error:', e)
    return `<div class="h-empty">render error — ${esc(e.message)}</div>`
  }
})

export default $

// a fresh flash schedules its own expiry redraw — nothing else in this
// file polls on a timer, so there's no periodic tick fighting this one.
let _flashTimer = null
$.when('click', '[data-pass]', submitPass)
$.when('click', '[data-ready]', toggleReady)
$.when('click', '[data-edit-name]', editGameName)
$.when('click', '[data-confirm]', confirmAction)
// unstage/jump are both plain buttons with no nested elements (see
// cardMini's own comment) — a real click target, safe for $.when's
// literal event.target match.
$.when('click', '[data-unstage]', e => unstageCard(e.target.closest('[data-unstage]').dataset.unstage))
$.when('click', '[data-jump-card]', e => {
  const card = e.target.closest('[data-jump-card]').dataset.jumpCard
  const cards = orderedHand($.learn().myHand)
  const i = cards.indexOf(card)
  if (i !== -1) $.whisper({ focusIdx: i })
})

// === swipe (rank/suit) + tap (stage) ===
// $.when only delegates via exact matches(), not closest() (see saga-pitch's
// own swipe comment for the same limitation) — that's exactly why "tap to
// select" never worked here before: the focused card's markup has nested
// spans (the corner marks), so a tap landing on one of those never matched
// [data-hold-card] at all. Raw document listeners plus closest() sidestep
// it: release with barely any movement is a tap (stage the card under the
// finger), release past SWIPE_THRESHOLD is a swipe (rank/suit nav). One
// gesture, one outcome — no separate hold timer to race against a swipe.
const SWIPE_THRESHOLD = 40
let _gestureStart = null

document.addEventListener('pointerdown', (event) => {
  const zone = event.target.closest('.h-bottom-half')
  if (!zone || !zone.closest($.link)) return
  const holdEl = event.target.closest('[data-hold-card]')
  _gestureStart = { x: event.clientX, y: event.clientY, card: holdEl ? holdEl.dataset.holdCard : null }
})

document.addEventListener('pointerup', (event) => {
  if (!_gestureStart) return
  const { x, y, card } = _gestureStart
  _gestureStart = null
  const dx = event.clientX - x, dy = event.clientY - y
  const mag = Math.max(Math.abs(dx), Math.abs(dy))
  if (mag < SWIPE_THRESHOLD) {
    if (!card) return
    // staging a card also makes it the active one — a mini you just tapped
    // shouldn't stay small, that reads as though nothing happened.
    stageCard(card)
    const i = orderedHand($.learn().myHand).indexOf(card)
    if (i !== -1) $.whisper({ focusIdx: i })
    return
  }
  if (Math.abs(dx) > Math.abs(dy)) moveRank(dx < 0 ? 1 : -1)
  else moveSuit(dy < 0 ? 1 : -1)
})

document.addEventListener('pointercancel', () => { _gestureStart = null })

function scheduleFlashExpiry() {
  clearTimeout(_flashTimer)
  const { lastEvent } = $.learn()
  if (!lastEvent) return
  const remaining = FLASH_MS - (Date.now() - lastEvent.ts)
  if (remaining > 0) _flashTimer = setTimeout(redraw, remaining + 50)
}

setInterval(() => { scheduleFlashExpiry(); maybeAutoDeal() }, 250)

// === felt, cards, corners ===
$.style(`
  & { position: relative; display: block; height: 100%; width: 100%; overflow: hidden; font-family: inherit; }

  & .h-title { color: lemonchiffon; font-size: clamp(2.5rem, 12vw, 6rem); font-weight: 800; line-height: 1; text-align: center; letter-spacing: .05em; }

  & .h-felt {
    position: relative; height: 100%; width: 100%;
    background:
      radial-gradient(ellipse at center, #2f6f4f 0%, #1f4d34 65%, #123023 100%);
  }
  & .h-felt::before {
    content: ''; position: absolute; inset: 0; pointer-events: none; opacity: .18; mix-blend-mode: overlay;
    background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='2'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E");
  }

  & .h-corner { position: absolute; width: 8rem; display: flex; flex-direction: column; align-items: center; gap: .3rem; color: lemonchiffon; }
  & .h-corner qr-code { width: 6rem; height: 6rem; border-radius: .6rem; overflow: hidden; }
  & .h-corner-label { font-size: .8rem; opacity: .8; }
  & .h-corner-name { font-weight: 700; display: flex; align-items: center; gap: .35rem; }
  & .h-dot { width: .65rem; height: .65rem; border-radius: 50%; display: inline-block; flex: none; }
  & .h-dot.-red { background: #e74c3c; }
  & .h-dot.-yellow { background: #f1c40f; box-shadow: 0 0 .4rem rgba(241,196,15,.7); }
  & .h-dot.-green { background: #2ecc40; box-shadow: 0 0 .4rem rgba(46,204,64,.7); }
  & .h-corner-tricks { font-size: .75rem; opacity: .7; }
  & .h-corner.-turn { text-shadow: 0 0 .6rem gold; }
  & .h-corner.-tl { top: 1rem; left: 1rem; }
  & .h-corner.-tr { top: 1rem; right: 1rem; }
  & .h-corner.-br { bottom: 1rem; right: 1rem; }
  & .h-corner.-bl { bottom: 1rem; left: 1rem; }

  & .h-center { position: absolute; inset: 0; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 1rem; }
  & .h-scores { color: lemonchiffon; font-size: .9rem; opacity: .85; }
  & .h-empty { color: lemonchiffon; opacity: .7; }

  & .h-waiting-seats { color: gold; font-size: clamp(1.6rem, 6vw, 3rem); font-weight: 800; line-height: 1; text-shadow: 0 0 1.2rem rgba(255,215,0,.5); }

  & .h-trick { position: relative; width: 14rem; height: 10rem; }
  & .h-trick-slot { position: absolute; }
  & .h-trick-slot.-tl { top: 0; left: 0; }
  & .h-trick-slot.-tr { top: 0; right: 0; }
  & .h-trick-slot.-br { bottom: 0; right: 0; }
  & .h-trick-slot.-bl { bottom: 0; left: 0; }

  & .h-card {
    position: relative;
    width: 3.6rem; height: 5rem; border-radius: .5rem; background: #fffdf5;
    display: grid; place-items: center; font-size: 1.4rem; font-weight: 800;
    box-shadow: 0 .15rem .4rem rgba(0,0,0,.35);
  }
  & .h-card.-red { color: #b3273c; }
  & .h-card.-black { color: #1a1a1a; }
  & .h-card.-flash { width: 7rem; height: 9.6rem; font-size: 2.6rem; }
  & .h-corner-mark { position: absolute; font-size: .62rem; font-weight: 800; line-height: 1; }
  & .h-corner-mark.-tl { top: .3rem; left: .3rem; }
  & .h-corner-mark.-br { bottom: .3rem; right: .3rem; transform: rotate(180deg); }
  & .h-card.-flash .h-corner-mark { font-size: 1rem; }

  & .h-card.-selected { outline: .25rem solid gold; }
  & .h-card.-legal { outline: .2rem solid #46d369; }
  & .h-card.-illegal { opacity: .35; }
  & .h-waiting { color: lemonchiffon; opacity: .8; }

  /* hand: top half (staging + confirm) / bottom half (the whole hand) */
  & .h-felt.-hand { display: flex; flex-direction: column; height: 100%; box-sizing: border-box; }
  & .h-top-half, & .h-bottom-half { flex: 1; min-height: 0; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: .8rem; padding: .8rem; box-sizing: border-box; }
  & .h-top-half { border-bottom: 1px solid rgba(255,255,255,.12); }

  & .h-hand-header { width: 100%; display: flex; align-items: center; justify-content: center; gap: .5rem; }
  & .h-hand-name { color: lemonchiffon; font-weight: 700; font-size: 1.05rem; }
  & .h-edit-name { background: none; border: none; color: lemonchiffon; opacity: .7; font-size: 1rem; cursor: pointer; padding: 0; }
  & .h-edit-name:hover { opacity: 1; }
  & .h-confirm-btn { margin-left: auto; font-size: 1rem; font-weight: 700; padding: .5rem 1.2rem; border-radius: 999px; border: none; background: #2ecc40; color: #06341a; cursor: pointer; }
  & .h-confirm-btn:disabled { background: rgba(255,255,255,.2); color: rgba(255,255,255,.5); cursor: default; }

  & .h-staging { display: flex; flex-direction: column; align-items: center; gap: .5rem; }
  & .h-staged-row { display: flex; gap: .5rem; }
  & .h-staged-slot { width: 3.6rem; height: 5rem; border-radius: .5rem; border: .15rem dashed rgba(255,255,255,.3); }
  & .h-staged-card { background: none; border: none; padding: 0; cursor: pointer; }
  & .h-hint-text { color: lemonchiffon; opacity: .6; font-size: .82rem; }

  & .h-bottom-half { touch-action: none; user-select: none; justify-content: space-evenly; overflow-y: auto; }
  & .h-suit-row.-open { display: flex; align-items: center; justify-content: center; gap: .4rem; flex-wrap: wrap; }
  & .h-focus-card .h-card { width: 6rem; height: 8.4rem; font-size: 2.15rem; cursor: pointer; }
  & .h-focus-card .h-corner-mark { font-size: .8rem; }
  & .h-mini-card {
    width: 2.4rem; height: 3.3rem; border-radius: .35rem; background: #fffdf5; border: none; cursor: pointer;
    font-size: .82rem; font-weight: 800; padding: 0;
  }
  & .h-mini-card.-red { color: #b3273c; }
  & .h-mini-card.-black { color: #1a1a1a; }
  & .h-mini-card.-selected { outline: .18rem solid gold; }
  & .h-mini-card.-legal { outline: .15rem solid #46d369; }
  & .h-mini-card.-illegal { opacity: .35; }
  & .h-suit-row.-collapsed { display: flex; justify-content: center; gap: .2rem; opacity: .6; }
  & .h-suit-row.-collapsed .h-mini-card { width: 2.1rem; height: 1.3rem; border-radius: .3rem; overflow: hidden; }

  & .h-ready-btn { font-size: 1.1rem; font-weight: 700; padding: .55rem 1.6rem; border-radius: 999px; border: none; cursor: pointer; }
  & .h-ready-btn.-yellow { background: #f1c40f; }
  & .h-ready-btn.-green { background: #2ecc40; color: #06341a; }
  & .h-roster { display: flex; flex-direction: column; gap: .3rem; background: rgba(0,0,0,.25); border-radius: .6rem; padding: .5rem .9rem; }
  & .h-roster-row { display: flex; align-items: center; gap: .5rem; color: lemonchiffon; font-size: .9rem; }

  & .h-flash { position: absolute; inset: 0; background: rgba(0,0,0,.85); display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 1rem; z-index: 20; }
  & .h-flash-text { color: #fff; font-size: 1.4rem; font-weight: 700; text-align: center; }
  & .h-flash-text.-big { font-size: 2.4rem; }
`)

// === card backs ===
// requested standalone so any future elf can render a face-down hearts
// card without importing this whole module — lemonchiffon, rounded, done.
$.style(`
  & .h-card-back { width: 3.6rem; height: 5rem; border-radius: .5rem; background: lemonchiffon; box-shadow: 0 .15rem .4rem rgba(0,0,0,.35); }
`)
