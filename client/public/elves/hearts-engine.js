// hearts-engine.js — the state machine, with nothing else attached.
//
// no DOM, no @plan98/elf, no sessionStorage, no network. every export here
// is a pure function (same input, same output, no side effect) except the
// crypto trio and shuffledDeck, whose only "impurity" is calling the
// platform's own crypto — which is why this module can be imported and
// tested directly under `deno test`, no browser required. plan1-hearts.js
// is the thin, impure shell around this: state, rendering, network, DOM
// events. Everything a card game actually decides lives here instead.

// === the deck ===
// ascii suit letters, not the unicode glyphs, all the way through shuffling,
// dealing, encryption and rules — the glyph only gets substituted in at
// render time (by the UI shell). three reasons: rank/suit slicing stays
// trivial (suit is always the last ascii char), the encrypted payload
// stays small (RSA-OAEP-2048 tops out at 190 bytes of plaintext — a
// unicode ♥/♠/♦/♣ costs 3 UTF-8 bytes each, ascii costs 1), and a diff of
// two card arrays is a diff of two ascii strings, nothing more.
export const RANKS = ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A']
export const SUITS = ['S', 'H', 'D', 'C']
export const DECK = RANKS.flatMap(r => SUITS.map(s => r + s))
export const GLYPH = { S: '♠', H: '♥', D: '♦', C: '♣' }
export const RED = { H: true, D: true }

export function rankOf(card) { return card.slice(0, -1) }
export function suitOf(card) { return card.slice(-1) }
export function rankIndex(card) { return RANKS.indexOf(rankOf(card)) }
export function isHeart(card) { return suitOf(card) === 'H' }
export function isQueenSpades(card) { return card === 'QS' }
export function sortHand(hand) { return [...hand].sort((a, b) => (suitOf(a) === suitOf(b) ? rankIndex(a) - rankIndex(b) : suitOf(a).localeCompare(suitOf(b)))) }

// === hand carousel ===
// clubs, diamonds, spades, hearts — the fixed row order the hand paginates
// through. a hand's cards, sorted into this order, land in contiguous
// same-suit runs; the carousel is just one integer (an index into this
// sorted array) walking it, with up/down jumping to the start of the
// next/previous run and left/right wrapping within the current one. no
// per-suit memory, no 2D grid — one index, two ways to move it.
export const HAND_SUIT_ORDER = ['C', 'D', 'S', 'H']
export function orderedHand(hand) {
  return [...hand].sort((a, b) => {
    const sa = HAND_SUIT_ORDER.indexOf(suitOf(a)), sb = HAND_SUIT_ORDER.indexOf(suitOf(b))
    return sa !== sb ? sa - sb : rankIndex(a) - rankIndex(b)
  })
}
export function clampFocus(idx, cards) { return idx == null || idx < 0 || idx >= cards.length ? 0 : idx }
export function suitRun(cards, idx) {
  const suit = suitOf(cards[idx])
  let start = idx, end = idx
  while (start > 0 && suitOf(cards[start - 1]) === suit) start--
  while (end < cards.length - 1 && suitOf(cards[end + 1]) === suit) end++
  return { start, end, suit }
}
export function suitRunStarts(cards) {
  const starts = []
  for (let i = 0; i < cards.length;) { starts.push(i); i = suitRun(cards, i).end + 1 }
  return starts
}
// pure: (sorted cards, current index, +1/-1) -> next index. the UI shell's
// moveRank() is just `$.whisper({ focusIdx: nextRankFocus(...) })`.
export function nextRankFocus(cards, idx, dir) {
  if (!cards.length) return 0
  const i = clampFocus(idx, cards)
  const { start, end } = suitRun(cards, i)
  const span = end - start + 1
  return start + (((i - start) + dir + span) % span)
}
export function nextSuitFocus(cards, idx, dir) {
  if (!cards.length) return 0
  const i = clampFocus(idx, cards)
  const starts = suitRunStarts(cards)
  const curRun = starts.indexOf(suitRun(cards, i).start)
  return starts[(curRun + dir + starts.length) % starts.length]
}

// Fisher-Yates over crypto.getRandomValues — this is the one place in the
// whole game where "good enough" randomness isn't good enough. a shuffled
// deck IS the secret; Math.random() is seedable/predictable in ways that
// would make "airtight" a lie the moment someone actually checked.
export function shuffledDeck() {
  const deck = [...DECK]
  const rand = new Uint32Array(deck.length)
  crypto.getRandomValues(rand)
  for (let i = deck.length - 1; i > 0; i--) {
    const j = rand[i] % (i + 1)
    ;[deck[i], deck[j]] = [deck[j], deck[i]]
  }
  return deck
}

export function dealHands(deck) { return [0, 1, 2, 3].map(seat => deck.slice(seat * 13, seat * 13 + 13)) }

// which cards a seat may legally play right now. the two house rules that
// exist purely to stop the first trick from being decided by luck of the
// draw (no hearts, no Q♠, unless that's literally all you were dealt) live
// here and nowhere else.
export function legalPlays(hand, trick, heartsBroken, isFirstTrick) {
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

export function trickWinner(trick) {
  const ledSuit = suitOf(trick[0].card)
  return trick.filter(p => suitOf(p.card) === ledSuit).sort((a, b) => rankIndex(b.card) - rankIndex(a.card))[0].seat
}

export function trickPoints(cards) { return cards.filter(isHeart).length + (cards.some(isQueenSpades) ? 13 : 0) }

// shoot-the-moon: whoever swept every point card this hand gets 0, and
// hangs 26 on the other three instead of taking them.
export function handDeltas(tricksWon) {
  const totals = [0, 1, 2, 3].map(s => trickPoints(tricksWon[s] || []))
  const moonSeat = totals.findIndex(t => t === 26)
  if (moonSeat === -1) return totals
  return totals.map((_, s) => (s === moonSeat ? 0 : 26))
}

export function passRecipient(seat, round) {
  const dir = round % 4
  return dir === 0 ? (seat + 1) % 4 : dir === 1 ? (seat + 3) % 4 : (seat + 2) % 4
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
// the browser (and Deno, and every other modern JS host) has shipped it
// natively for years.
export const RSA_PARAMS = { name: 'RSA-OAEP', hash: 'SHA-256' }

export function generateKeypair() {
  return crypto.subtle.generateKey({ ...RSA_PARAMS, modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]) }, true, ['encrypt', 'decrypt'])
}

export function buf2b64(buf) { return btoa(String.fromCharCode(...new Uint8Array(buf))) }
export function b642buf(b64) { return Uint8Array.from(atob(b64), c => c.charCodeAt(0)).buffer }

export async function encryptFor(publicJwk, cards) {
  const key = await crypto.subtle.importKey('jwk', publicJwk, RSA_PARAMS, false, ['encrypt'])
  const bytes = new TextEncoder().encode(JSON.stringify(cards))
  return buf2b64(await crypto.subtle.encrypt(RSA_PARAMS, key, bytes))
}

export async function decryptMine(privateKey, cipherB64) {
  const bytes = await crypto.subtle.decrypt(RSA_PARAMS, privateKey, b642buf(cipherB64))
  return JSON.parse(new TextDecoder().decode(bytes))
}
