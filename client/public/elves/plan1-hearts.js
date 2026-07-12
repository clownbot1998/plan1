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
// presses PLAY becomes the table — a spectator, not a fifth seat — and
// hands out a QR per empty corner. scanning one claims that seat forever
// (for this browser tab's lifetime) and nowhere else in the whole app does
// a device hold more than one seat.
//
// === imports ===
import Self, { linkState, broadcastElf, channel } from '@plan98/elf'
import Cache from '@silly/cache'

const tag = 'plan1-hearts'
const cache = Cache('hearts-keys') // one record per seat's RSA keypair, keyed `${gameId}:${seat}`

// === the deck ===
// ascii suit letters, not the unicode glyphs, all the way through shuffling,
// dealing, encryption and rules — the glyph only gets substituted in at
// render time (glyph()/color() below). three reasons: rank/suit slicing
// stays trivial (suit is always the last ascii char), the encrypted payload
// stays small (RSA-OAEP-2048 tops out at 190 bytes of plaintext — a
// unicode ♥/♠/♦/♣ costs 3 UTF-8 bytes each, ascii costs 1), and a diff of
// two card arrays is a diff of two ascii strings, nothing more.
const RANKS = ['2','3','4','5','6','7','8','9','10','J','Q','K','A']
const SUITS = ['S','H','D','C']
const DECK = RANKS.flatMap(r => SUITS.map(s => r + s))
const GLYPH = { S: '♠', H: '♥', D: '♦', C: '♣' }
const RED = { H: true, D: true }

function rankOf(card) { return card.slice(0, -1) }
function suitOf(card) { return card.slice(-1) }
function rankIndex(card) { return RANKS.indexOf(rankOf(card)) }
function isHeart(card) { return suitOf(card) === 'H' }
function isQueenSpades(card) { return card === 'QS' }
function sortHand(hand) { return [...hand].sort((a, b) => (suitOf(a) === suitOf(b) ? rankIndex(a) - rankIndex(b) : suitOf(a).localeCompare(suitOf(b)))) }

// Fisher-Yates over crypto.getRandomValues — this is the one place in the
// whole game where "good enough" randomness isn't good enough. a shuffled
// deck IS the secret; Math.random() is seedable/predictable in ways that
// would make "airtight" a lie the moment someone actually checked.
function shuffledDeck() {
  const deck = [...DECK]
  const rand = new Uint32Array(deck.length)
  crypto.getRandomValues(rand)
  for (let i = deck.length - 1; i > 0; i--) {
    const j = rand[i] % (i + 1)
    ;[deck[i], deck[j]] = [deck[j], deck[i]]
  }
  return deck
}

function dealHands(deck) { return [0, 1, 2, 3].map(seat => deck.slice(seat * 13, seat * 13 + 13)) }

// which cards a seat may legally play right now. the two house rules that
// exist purely to stop the first trick from being decided by luck of the
// draw (no hearts, no Q♠, unless that's literally all you were dealt) live
// here and nowhere else.
function legalPlays(hand, trick, heartsBroken, isFirstTrick) {
  if (trick.length === 0) {
    if (isFirstTrick) return hand.includes('2C') ? ['2C'] : hand
    if (!heartsBroken) {
      const nonHearts = hand.filter(c => !isHeart(c))
      return nonHearts.length ? nonHearts : hand
    }
    return hand
  }
  const ledSuit = suitOf(trick[0].card)
  const following = hand.filter(c => suitOf(c) === ledSuit)
  if (following.length) return following
  if (isFirstTrick) {
    const safe = hand.filter(c => !isHeart(c) && !isQueenSpades(c))
    return safe.length ? safe : hand
  }
  return hand
}

function trickWinner(trick) {
  const ledSuit = suitOf(trick[0].card)
  return trick.filter(p => suitOf(p.card) === ledSuit).sort((a, b) => rankIndex(b.card) - rankIndex(a.card))[0].seat
}

function trickPoints(cards) { return cards.filter(isHeart).length + (cards.some(isQueenSpades) ? 13 : 0) }

// shoot-the-moon: whoever swept every point card this hand gets 0, and
// hangs 26 on the other three instead of taking them.
function handDeltas(tricksWon) {
  const totals = [0, 1, 2, 3].map(s => trickPoints(tricksWon[s] || []))
  const moonSeat = totals.findIndex(t => t === 26)
  if (moonSeat === -1) return totals
  return totals.map((_, s) => (s === moonSeat ? 0 : 26))
}

// === crypto ===
// each seat holds one RSA-OAEP keypair for the lifetime of a game: the
// public half rides in the room's broadcast state (safe — it's a lock, not
// a key), the private half never leaves the device that generated it and
// never touches the network. dealing = the table encrypting a hand FOR a
// seat's public key; passing = one seat doing the same thing for another
// seat. nobody but the intended reader can open either envelope — that's
// the whole security model, and it's the same primitive Signal-style
// clients use, just called directly instead of through a library, because
// the browser has shipped it natively for a decade.
const RSA_PARAMS = { name: 'RSA-OAEP', hash: 'SHA-256' }

async function ensureKeypair(gameId, seat) {
  const cacheKey = `${gameId}:${seat}`
  const found = await cache.get(cacheKey)
  if (found && found.data) return found.data
  const pair = await crypto.subtle.generateKey({ ...RSA_PARAMS, modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]) }, true, ['encrypt', 'decrypt'])
  await cache.put(cacheKey, pair)
  return pair
}

function buf2b64(buf) { return btoa(String.fromCharCode(...new Uint8Array(buf))) }
function b642buf(b64) { return Uint8Array.from(atob(b64), c => c.charCodeAt(0)).buffer }

async function encryptFor(publicJwk, cards) {
  const key = await crypto.subtle.importKey('jwk', publicJwk, RSA_PARAMS, false, ['encrypt'])
  const bytes = new TextEncoder().encode(JSON.stringify(cards))
  return buf2b64(await crypto.subtle.encrypt(RSA_PARAMS, key, bytes))
}

async function decryptMine(privateKey, cipherB64) {
  const bytes = await crypto.subtle.decrypt(RSA_PARAMS, privateKey, b642buf(cipherB64))
  return JSON.parse(new TextDecoder().decode(bytes))
}

// === state ===
// seats/dealCipher/passCipher/passSubmitted are keyed "0".."3" and merged
// entry-by-entry (see ROOM_MERGE) so four devices claiming different
// corners, or passing to four different neighbors, in the same second
// never clobber each other. everything else — phase, trick, turn, scores —
// only ever has one legitimate writer at a time (whoever's turn it is,
// or the table dealing), so a plain overwrite is correct, not just simple.
const $ = Self(tag, {
  view: 'boot',       // boot | splash | table | hand
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

async function claimSeat() {
  myKeypair = await ensureKeypair(gameId, mySeat)
  const name = sessionStorage.getItem('hearts-name-' + gameId) || (() => {
    const n = prompt('Your name at the table:') || `Seat ${mySeat + 1}`
    sessionStorage.setItem('hearts-name-' + gameId, n)
    return n
  })()
  const publicKeyJwk = await crypto.subtle.exportKey('jwk', myKeypair.publicKey)
  commit({ seats: { [mySeat]: { name, publicKeyJwk } } })
}

function redraw() { $.whisper({ tick: ($.learn().tick || 0) + 1 }) }

;(async function boot() {
  if (!gameId) { $.whisper({ view: 'splash' }); return }
  consumeClaimParam()
  if (mySeat === null) {
    const saved = sessionStorage.getItem('hearts-seat-' + gameId)
    if (saved !== null) mySeat = Number(saved)
  }
  linkState(tag, gameId)
  if (mySeat !== null) await claimSeat()
  $.whisper({ view: mySeat === null ? 'table' : 'hand' })
})()

function startTable() {
  gameId = crypto.randomUUID()
  history.replaceState(null, '', '?id=' + gameId)
  linkState(tag, gameId)
  $.whisper({ view: 'table' })
}

// === dealing & passing (table-and-hand actions) ===
async function dealHand(resetScores) {
  const { seats, round, scores } = $.learn()
  const hands = dealHands(shuffledDeck())
  const dealCipher = {}
  for (let seat = 0; seat < 4; seat++) dealCipher[seat] = await encryptFor(seats[seat].publicKeyJwk, hands[seat])
  const leader = hands.findIndex(h => h.includes('2C'))
  const dir = round % 4 // 0 left · 1 right · 2 across · 3 hold — see passRecipient()
  commit({
    phase: dir === 3 ? 'playing' : 'passing',
    dealCipher, passCipher: {}, passSubmitted: {},
    trick: [], trickCount: 0, trickLeader: leader, turn: dir === 3 ? leader : null,
    heartsBroken: false, tricksWon: { 0: [], 1: [], 2: [], 3: [] },
    scores: resetScores ? [0, 0, 0, 0] : scores,
    round: resetScores ? 0 : round,
    lastEvent: null,
  })
}

function passRecipient(seat, round) {
  const dir = round % 4
  return dir === 0 ? (seat + 1) % 4 : dir === 1 ? (seat + 3) % 4 : (seat + 2) % 4
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

function splashView() {
  return `
    <div class="h-splash">
      <div class="h-title">JUST<br>FING<br>HRTS</div>
      <button class="h-play" data-play>PLAY</button>
    </div>`
}

function seatCorner(seat) {
  const s = $.learn().seats[seat]
  if (!s) {
    const url = `${location.origin}/app/${$.link}?id=${gameId}&claim=${seat}`
    return `<div class="h-corner ${CORNER_CLASS[seat]}"><qr-code src="${esc(url)}"></qr-code><div class="h-corner-label">Seat ${seat + 1}</div></div>`
  }
  const { turn, tricksWon } = $.learn()
  return `
    <div class="h-corner ${CORNER_CLASS[seat]} ${turn === seat ? '-turn' : ''}">
      <div class="h-corner-name">${esc(s.name)}</div>
      <div class="h-corner-tricks">${(tricksWon[seat] || []).length} pts: ${trickPoints(tricksWon[seat] || [])}</div>
    </div>`
}

function tableCenter() {
  const { phase, seats, trick, scores } = $.learn()
  const allClaimed = Object.keys(seats).length === 4

  if (!allClaimed) {
    const open = 4 - Object.keys(seats).length
    return `
      <div class="h-center">
        <div class="h-waiting-hero">
          <div class="h-waiting-title">WAITING FOR PLAYERS</div>
          <div class="h-waiting-seats">${open} Seat${open === 1 ? '' : 's'} Open</div>
        </div>
      </div>`
  }

  const dealBtn = phase === 'waiting' ? `<button class="h-deal" data-deal>DEAL</button>`
    : phase === 'hand-end' ? `<button class="h-deal" data-deal>DEAL NEXT HAND</button>`
    : phase === 'game-end' ? `<button class="h-deal" data-new-game>NEW GAME</button>`
    : ''

  const trickHtml = trick.length
    ? `<div class="h-trick">${trick.map(p => `<div class="h-trick-slot ${CORNER_CLASS[p.seat]}">${cardFace(p.card)}</div>`).join('')}</div>`
    : ''

  return `
    <div class="h-center">
      <div class="h-scores">${scores.map((s, i) => `<span>${esc(seats[i] ? seats[i].name : 'Seat ' + (i + 1))}: ${s}</span>`).join('  ·  ')}</div>
      ${trickHtml}
      ${dealBtn}
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

function handView() {
  const { phase, turn, myHand, selected, trickCount, heartsBroken, trick, seats } = $.learn()
  const isPassing = phase === 'passing'
  const passedAlready = !!$.learn().passSubmitted[mySeat]
  const legal = phase === 'playing' && turn === mySeat ? legalPlays(myHand, trick, heartsBroken, trickCount === 0) : []

  const cards = myHand.map(card => {
    const isSelected = selected.includes(card)
    const isLegal = legal.includes(card)
    const cls = isPassing ? (isSelected ? '-selected' : '') : (legal.length ? (isLegal ? '-legal' : '-illegal') : '')
    return `<button class="h-hand-card" data-card="${esc(card)}">${cardFace(card, cls)}</button>`
  }).join('')

  const action = isPassing && !passedAlready
    ? `<button class="h-pass-btn" ${selected.length === 3 ? '' : 'disabled'} data-pass>Pass ${selected.length}/3 →</button>`
    : isPassing ? `<div class="h-waiting">passed — waiting on the table…</div>`
    : phase === 'playing' ? `<div class="h-waiting">${turn === mySeat ? 'your lead' : (seats[turn] ? esc(seats[turn].name) : 'waiting') + '…'}</div>`
    : ''

  return `
    <div class="h-felt -hand">
      <div class="h-hand-row">${cards}</div>
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
  if (view === 'splash') return splashView()
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
$.when('click', '[data-play]', startTable)
$.when('click', '[data-deal]', () => dealHand(false))
$.when('click', '[data-new-game]', () => dealHand(true))
$.when('click', '[data-pass]', submitPass)
$.when('click', '[data-card]', e => {
  const card = e.target.closest('[data-card]').dataset.card
  const { phase, selected } = $.learn()
  if (phase === 'passing') {
    if (selected.includes(card)) $.whisper({ selected: selected.filter(c => c !== card) })
    else if (selected.length < 3) $.whisper({ selected: [...selected, card] })
    return
  }
  playCard(card)
})

function scheduleFlashExpiry() {
  clearTimeout(_flashTimer)
  const { lastEvent } = $.learn()
  if (!lastEvent) return
  const remaining = FLASH_MS - (Date.now() - lastEvent.ts)
  if (remaining > 0) _flashTimer = setTimeout(redraw, remaining + 50)
}
setInterval(scheduleFlashExpiry, 500)

// === felt, cards, corners ===
$.style(`
  & { position: relative; display: block; height: 100%; width: 100%; overflow: hidden; font-family: inherit; }

  & .h-splash {
    height: 100%; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 2rem;
    background: radial-gradient(ellipse at center, #2f6f4f 0%, #1f4d34 65%, #123023 100%);
  }
  & .h-title { color: lemonchiffon; font-size: clamp(2.5rem, 12vw, 6rem); font-weight: 800; line-height: 1; text-align: center; letter-spacing: .05em; }
  & .h-play { font-size: 1.6rem; font-weight: 700; padding: .8rem 3rem; border-radius: 999px; border: none; background: lemonchiffon; cursor: pointer; }
  & .h-play:hover { transform: scale(1.04); }

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
  & .h-corner-name { font-weight: 700; }
  & .h-corner-tricks { font-size: .75rem; opacity: .7; }
  & .h-corner.-turn { text-shadow: 0 0 .6rem gold; }
  & .h-corner.-tl { top: 1rem; left: 1rem; }
  & .h-corner.-tr { top: 1rem; right: 1rem; }
  & .h-corner.-br { bottom: 1rem; right: 1rem; }
  & .h-corner.-bl { bottom: 1rem; left: 1rem; }

  & .h-center { position: absolute; inset: 0; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 1rem; }
  & .h-scores { color: lemonchiffon; font-size: .9rem; opacity: .85; }
  & .h-empty { color: lemonchiffon; opacity: .7; }

  & .h-waiting-hero { display: flex; flex-direction: column; align-items: center; gap: .5rem; text-align: center; }
  & .h-waiting-title { color: lemonchiffon; font-size: clamp(1.6rem, 6vw, 3.2rem); font-weight: 800; letter-spacing: .04em; line-height: 1.1; }
  & .h-waiting-seats { color: gold; font-size: clamp(2.4rem, 10vw, 5.5rem); font-weight: 800; line-height: 1; text-shadow: 0 0 1.2rem rgba(255,215,0,.5); }
  & .h-deal { font-size: 1.2rem; font-weight: 700; padding: .6rem 1.6rem; border-radius: 999px; border: none; background: lemonchiffon; cursor: pointer; }

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

  & .h-felt.-hand { display: flex; flex-direction: column; justify-content: flex-end; padding-bottom: 1rem; }
  & .h-hand-row { display: flex; justify-content: center; flex-wrap: wrap; gap: .4rem .3rem; padding: 0 .5rem; }
  & .h-hand-card { background: none; border: none; padding: 0; cursor: pointer; }
  & .h-hand-card:disabled, & .h-card.-illegal { opacity: .35; pointer-events: none; }
  & .h-card.-selected { outline: .25rem solid gold; transform: translateY(-.6rem); }
  & .h-card.-legal { outline: .2rem solid #46d369; }
  & .h-hand-actions { display: flex; justify-content: center; padding-top: .8rem; }
  & .h-pass-btn { font-size: 1.1rem; font-weight: 700; padding: .6rem 1.4rem; border-radius: 999px; border: none; background: lemonchiffon; cursor: pointer; }
  & .h-pass-btn:disabled { opacity: .4; cursor: default; }
  & .h-waiting { color: lemonchiffon; opacity: .8; }

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
