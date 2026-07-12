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
  GLYPH, RED, rankOf, suitOf, isHeart, sortHand,
  orderedHand, clampFocus, nextRankFocus, nextSuitFocus,
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
  selected: [],
  focusIdx: 0,       // which card in orderedHand(myHand) is centered in the hand carousel
  pendingPlay: null, // { card, armedAt } — set by a hold, cleared by Undo or by actually playing
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

// hold-to-play: a hold ARMS the play (this function) but doesn't commit it
// — a periodic tick (see the setInterval near the bottom) actually calls
// playCard() once PLAY_UNDO_MS has passed with no Undo tap. Short enough
// to keep the table's pace, long enough to catch a wrong card or a "wait,
// no" — the same trade-off a hold-to-delete confirmation makes anywhere
// else, just aimed at a card table's specific way of going wrong (bumped
// the table, meant a different card, someone else needed a beat).
const PLAY_UNDO_MS = 3000
function armPlay(card) { $.whisper({ pendingPlay: { card, armedAt: Date.now() } }) }
function cancelPendingPlay() { $.whisper({ pendingPlay: null }) }

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
function cardFace(card, extraClass = '') {
  return `<div class="h-card ${RED[suitOf(card)] ? '-red' : '-black'} ${extraClass}">${esc(glyph(card))}</div>`
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

function handView() {
  const { phase, turn, myHand, selected, trickCount, heartsBroken, trick, seats, pendingPlay, focusIdx } = $.learn()
  const isPassing = phase === 'passing'
  const passedAlready = !!$.learn().passSubmitted[mySeat]
  const legal = phase === 'playing' && turn === mySeat ? legalPlays(myHand, trick, heartsBroken, trickCount === 0) : []
  const mySeatData = seats[mySeat]
  const iAmReady = !!(mySeatData && mySeatData.ready)

  const cards = orderedHand(myHand)
  const idx = clampFocus(focusIdx, cards)
  const focused = cards[idx]
  const isSelected = focused && selected.includes(focused)
  const isLegal = focused && legal.includes(focused)
  const faceClass = isPassing ? (isSelected ? '-selected' : '') : (legal.length ? (isLegal ? '-legal' : '-illegal') : '')

  const focusHtml = focused
    ? `<div class="h-focus-card" data-hold-card="${esc(focused)}">${cardFace(focused, faceClass)}</div>
       ${cards.length > 1 ? `<div class="h-hand-hint">${idx + 1} / ${cards.length}</div>` : ''}`
    : `<div class="h-empty">no cards</div>`

  const pendingHtml = pendingPlay ? `
    <div class="h-pending">
      <div class="h-pending-text">playing ${esc(glyph(pendingPlay.card))} in <span>${Math.max(0, Math.ceil((PLAY_UNDO_MS - (Date.now() - pendingPlay.armedAt)) / 1000))}</span>…</div>
      <button class="h-undo-btn" data-undo-play>Undo</button>
    </div>` : ''

  const action = pendingHtml ? pendingHtml
    : isPassing && !passedAlready
    ? `<button class="h-pass-btn" ${selected.length === 3 ? '' : 'disabled'} data-pass>Pass ${selected.length}/3 →</button>`
    : isPassing ? `<div class="h-waiting">passed — waiting on the table…</div>`
    : phase === 'playing' ? `<div class="h-waiting">${turn === mySeat ? 'hold your card to play it' : (seats[turn] ? esc(seats[turn].name) : 'waiting') + '…'}</div>`
    : ''

  // the ready toggle shows before every deal (fresh each hand, not just
  // the game's first) — see dealHand()'s ready reset and maybeAutoDeal().
  const readyBlock = (phase === 'waiting' || phase === 'hand-end' || phase === 'game-end') ? `
    <button class="h-ready-btn -${iAmReady ? 'green' : 'yellow'}" data-ready>${iAmReady ? '✓ Ready' : 'Ready?'}</button>
    <div class="h-roster">${readyRoster(seats)}</div>` : ''

  return `
    <div class="h-felt -hand">
      <div class="h-hand-header">
        <span class="h-hand-name">${esc(mySeatData ? mySeatData.name : '')}</span>
        <button class="h-edit-name" data-edit-name title="Change game name">✎</button>
      </div>
      <div class="h-status-bar">${readyBlock}</div>
      <div class="h-hand-focus">${focusHtml}</div>
      <div class="h-hand-actions">${action}</div>
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
$.when('click', '[data-undo-play]', cancelPendingPlay)
// a plain tap on the focused card only does something during passing
// (toggle it into/out of the 3 you're sending) — during play, a tap is
// just a tap; playing a card takes a hold, handled below by raw pointer
// events since it needs to measure a HOLD duration, not react to a click.
$.when('click', '[data-hold-card]', e => {
  const card = e.target.closest('[data-hold-card]').dataset.holdCard
  const { phase, selected } = $.learn()
  if (phase !== 'passing') return
  if (selected.includes(card)) $.whisper({ selected: selected.filter(c => c !== card) })
  else if (selected.length < 3) $.whisper({ selected: [...selected, card] })
})

// === swipe (rank/suit) + hold (play) ===
// $.when only delegates via exact matches(), not closest() (see saga-pitch's
// own swipe comment for the same limitation) — raw document listeners plus
// closest() sidestep it, and give both gestures a shared pointerdown/up/move
// lifecycle without fighting each other: a hold requires the finger to stay
// essentially still past HOLD_MS (movement cancels it, same threshold logic
// protects a swipe from ever being misread as a hold), a swipe requires it
// to travel past SWIPE_THRESHOLD before release. They can't both fire from
// the same gesture.
const SWIPE_THRESHOLD = 40
const HOLD_MS = 550
let _gestureStart = null
let _holdTimer = null

document.addEventListener('pointerdown', (event) => {
  const holdEl = event.target.closest('[data-hold-card]')
  const zone = event.target.closest('.h-hand-focus')
  if (!zone || !zone.closest($.link)) return
  _gestureStart = { x: event.clientX, y: event.clientY, card: holdEl ? holdEl.dataset.holdCard : null }
  clearTimeout(_holdTimer)
  if (!holdEl) return
  _holdTimer = setTimeout(() => {
    const { phase, turn, myHand, heartsBroken, trick, trickCount, pendingPlay } = $.learn()
    if (pendingPlay || mySeat === null) return
    if (phase !== 'playing' || turn !== mySeat) return
    const card = holdEl.dataset.holdCard
    if (!legalPlays(myHand, trick, heartsBroken, trickCount === 0).includes(card)) return
    armPlay(card)
  }, HOLD_MS)
})

document.addEventListener('pointermove', (event) => {
  if (!_gestureStart) return
  const dx = event.clientX - _gestureStart.x, dy = event.clientY - _gestureStart.y
  if (Math.hypot(dx, dy) > 15) clearTimeout(_holdTimer)
})

document.addEventListener('pointerup', (event) => {
  clearTimeout(_holdTimer)
  if (!_gestureStart) return
  const { x, y } = _gestureStart
  _gestureStart = null
  const dx = event.clientX - x, dy = event.clientY - y
  const mag = Math.max(Math.abs(dx), Math.abs(dy))
  if (mag < SWIPE_THRESHOLD) return
  if (Math.abs(dx) > Math.abs(dy)) moveRank(dx < 0 ? 1 : -1)
  else moveSuit(dy < 0 ? 1 : -1)
})

document.addEventListener('pointercancel', () => { clearTimeout(_holdTimer); _gestureStart = null })

function scheduleFlashExpiry() {
  clearTimeout(_flashTimer)
  const { lastEvent } = $.learn()
  if (!lastEvent) return
  const remaining = FLASH_MS - (Date.now() - lastEvent.ts)
  if (remaining > 0) _flashTimer = setTimeout(redraw, remaining + 50)
}

// resolves an armed play once its undo window has actually elapsed, and
// redraws every tick in between so the visible countdown keeps ticking.
function tickPendingPlay() {
  const { pendingPlay } = $.learn()
  if (!pendingPlay) return
  if (Date.now() - pendingPlay.armedAt >= PLAY_UNDO_MS) {
    $.whisper({ pendingPlay: null })
    playCard(pendingPlay.card)
  } else {
    redraw()
  }
}

setInterval(() => { scheduleFlashExpiry(); maybeAutoDeal(); tickPendingPlay() }, 250)

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
    width: 3.6rem; height: 5rem; border-radius: .5rem; background: #fffdf5;
    display: grid; place-items: center; font-size: 1.4rem; font-weight: 800;
    box-shadow: 0 .15rem .4rem rgba(0,0,0,.35);
  }
  & .h-card.-red { color: #b3273c; }
  & .h-card.-black { color: #1a1a1a; }
  & .h-card.-flash { width: 7rem; height: 9.6rem; font-size: 2.6rem; }

  & .h-felt.-hand { display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 1.2rem; padding: 4.5rem 1rem 1.5rem; box-sizing: border-box; }
  & .h-card.-selected { outline: .25rem solid gold; transform: translateY(-.6rem); }
  & .h-card.-legal { outline: .2rem solid #46d369; }
  & .h-card.-illegal { opacity: .35; }
  & .h-hand-actions { display: flex; justify-content: center; min-height: 3rem; align-items: center; }
  & .h-pass-btn { font-size: 1.1rem; font-weight: 700; padding: .6rem 1.4rem; border-radius: 999px; border: none; background: lemonchiffon; cursor: pointer; }
  & .h-pass-btn:disabled { opacity: .4; cursor: default; }
  & .h-waiting { color: lemonchiffon; opacity: .8; }

  & .h-hand-header { position: absolute; top: 1rem; left: 0; right: 0; display: flex; align-items: center; justify-content: center; gap: .5rem; }
  & .h-hand-name { color: lemonchiffon; font-weight: 700; font-size: 1.05rem; }
  & .h-edit-name { background: none; border: none; color: lemonchiffon; opacity: .7; font-size: 1rem; cursor: pointer; padding: 0; }
  & .h-edit-name:hover { opacity: 1; }

  & .h-hand-focus { touch-action: none; user-select: none; display: flex; flex-direction: column; align-items: center; gap: .6rem; }
  & .h-focus-card .h-card { width: 7rem; height: 9.8rem; font-size: 2.6rem; cursor: pointer; }
  & .h-hand-hint { color: lemonchiffon; opacity: .55; font-size: .8rem; }

  & .h-pending { display: flex; flex-direction: column; align-items: center; gap: .4rem; }
  & .h-pending-text { color: gold; font-weight: 700; }
  & .h-undo-btn { font-size: 1rem; font-weight: 700; padding: .45rem 1.4rem; border-radius: 999px; border: none; background: #e74c3c; color: #fff; cursor: pointer; }

  & .h-status-bar { position: absolute; top: 3.6rem; left: 0; right: 0; display: flex; flex-direction: column; align-items: center; gap: .6rem; }
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
