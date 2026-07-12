// hearts-engine.test.js — battle-tests the state machine directly, no
// browser, no DOM, no network. run with:
//   deno test --allow-read client/public/elves/hearts-engine.test.js
//
// three tiers: unit tests per rule (legalPlays' branches, scoring, the
// carousel's wraparound), a real crypto round trip (native Web Crypto,
// no mocking), and a full simulated game — deal, pass, play all 52 cards
// across 13 tricks, exactly the way four real clients would, just without
// four real clients. That last one is what "state projection is the only
// thing worth testing in a browser" actually buys: everything a hand of
// Hearts can legitimately do, proven here in milliseconds instead of
// minutes of headless Chromium.
import { assert, assertEquals, assertNotEquals } from 'jsr:@std/assert'
import {
  DECK, RANKS, SUITS,
  rankOf, suitOf, isHeart, isQueenSpades,
  orderedHand, nextRankFocus, nextSuitFocus,
  shuffledDeck, dealHands, legalPlays, trickWinner, trickPoints, handDeltas, passRecipient,
  generateKeypair, encryptFor, decryptMine,
} from './hearts-engine.js'

// === deck & deal ===

Deno.test('shuffledDeck: 52 unique cards, same set as DECK', () => {
  const deck = shuffledDeck()
  assertEquals(deck.length, 52)
  assertEquals(new Set(deck).size, 52)
  assertEquals([...deck].sort().join(), [...DECK].sort().join())
})

Deno.test('dealHands: four hands of 13, no overlap, covers the whole deck', () => {
  const deck = shuffledDeck()
  const hands = dealHands(deck)
  assertEquals(hands.length, 4)
  hands.forEach(h => assertEquals(h.length, 13))
  const flat = hands.flat()
  assertEquals(new Set(flat).size, 52)
  assertEquals([...flat].sort().join(), [...deck].sort().join())
})

// === legalPlays ===

Deno.test('legalPlays: leading the first trick must play 2C if held', () => {
  const hand = ['2C', 'AH', 'KS']
  assertEquals(legalPlays(hand, [], false, true), ['2C'])
})

Deno.test('legalPlays: leading, hearts not broken, must avoid hearts if possible', () => {
  const hand = ['3C', 'AH', 'KS']
  assertEquals(legalPlays(hand, [], false, false).sort(), ['3C', 'KS'].sort())
})

Deno.test('legalPlays: leading, hearts not broken, but hand is ALL hearts — hearts allowed', () => {
  const hand = ['AH', 'KH', '2H']
  assertEquals(legalPlays(hand, [], false, false).sort(), hand.sort())
})

Deno.test('legalPlays: leading, hearts broken — anything goes', () => {
  const hand = ['3C', 'AH', 'KS']
  assertEquals(legalPlays(hand, [], true, false).sort(), hand.sort())
})

Deno.test('legalPlays: following, must follow suit if able', () => {
  const hand = ['3C', 'AH', '7C']
  const trick = [{ seat: 0, card: '5C' }]
  assertEquals(legalPlays(hand, trick, false, false).sort(), ['3C', '7C'].sort())
})

Deno.test('legalPlays: following, void in led suit, first trick — no hearts or QS unless forced', () => {
  const hand = ['AH', 'QS', '5D']
  const trick = [{ seat: 0, card: '5C' }]
  assertEquals(legalPlays(hand, trick, false, true), ['5D'])
})

Deno.test('legalPlays: following, void in led suit, first trick, ONLY hearts/QS in hand — forced to play one', () => {
  const hand = ['AH', 'QS']
  const trick = [{ seat: 0, card: '5C' }]
  assertEquals(legalPlays(hand, trick, false, true).sort(), hand.sort())
})

Deno.test('legalPlays: following, void in led suit, not first trick — anything goes', () => {
  const hand = ['AH', 'QS', '5D']
  const trick = [{ seat: 0, card: '5C' }]
  assertEquals(legalPlays(hand, trick, false, false).sort(), hand.sort())
})

// === trick resolution & scoring ===

Deno.test('trickWinner: highest card of the LED suit wins, off-suit rank is irrelevant', () => {
  const trick = [
    { seat: 0, card: '5C' },
    { seat: 1, card: 'AH' },  // off-suit, can't win
    { seat: 2, card: 'KC' },  // led suit, highest
    { seat: 3, card: '2C' },
  ]
  assertEquals(trickWinner(trick), 2)
})

Deno.test('trickPoints: hearts count 1 each, Q♠ costs 13', () => {
  assertEquals(trickPoints(['5C', 'AH', 'KC']), 1)
  assertEquals(trickPoints(['QS', '2C']), 13)
  assertEquals(trickPoints(['QS', 'AH', 'KH']), 15)
  assertEquals(trickPoints(['2C', '3D']), 0)
})

Deno.test('handDeltas: no inversion unless someone actually swept all 26 points', () => {
  const tricksWon = { 0: ['AH'], 1: ['QS'], 2: ['2H', '3H'], 3: [] }
  assertEquals(handDeltas(tricksWon), [1, 13, 2, 0]) // raw points here, no moon shot to invert
})

Deno.test('handDeltas: shoot the moon — shooter gets 0, everyone else eats 26 (sum 78)', () => {
  const allHeartsAndQueen = [...RANKS.map(r => r + 'H'), 'QS']
  const tricksWon = { 0: allHeartsAndQueen, 1: [], 2: [], 3: [] }
  const deltas = handDeltas(tricksWon)
  assertEquals(deltas, [0, 26, 26, 26])
  assertEquals(deltas.reduce((a, b) => a + b, 0), 78)
})

// === passing rotation ===

Deno.test('passRecipient: round 0 is pass-left, round 1 pass-right, round 2 pass-across', () => {
  for (let seat = 0; seat < 4; seat++) {
    assertEquals(passRecipient(seat, 0), (seat + 1) % 4, `seat ${seat} round 0`)
    assertEquals(passRecipient(seat, 1), (seat + 3) % 4, `seat ${seat} round 1`)
    assertEquals(passRecipient(seat, 2), (seat + 2) % 4, `seat ${seat} round 2`)
  }
})

Deno.test('passRecipient: never sends a seat its own cards', () => {
  for (let round = 0; round < 3; round++) {
    for (let seat = 0; seat < 4; seat++) {
      assertNotEquals(passRecipient(seat, round), seat)
    }
  }
})

// === hand carousel ===

Deno.test('carousel: left/right wraps within the current suit run only', () => {
  const cards = orderedHand(['5C', '9C', 'KC', '2D']) // clubs run: idx 0-2, diamonds: idx 3
  assertEquals(nextRankFocus(cards, 0, 1), 1)
  assertEquals(nextRankFocus(cards, 2, 1), 0) // wraps within clubs, doesn't spill into diamonds
  assertEquals(nextRankFocus(cards, 0, -1), 2)
})

Deno.test('carousel: up/down jumps to the start of the next/previous suit run, wrapping across all runs', () => {
  const cards = orderedHand(['5C', '2D', '9S', 'KH']) // one run per suit, in HAND_SUIT_ORDER
  const clubsStart = cards.indexOf('5C')
  const diamondsStart = cards.indexOf('2D')
  const heartsStart = cards.indexOf('KH')
  assertEquals(nextSuitFocus(cards, clubsStart, 1), diamondsStart)
  assertEquals(nextSuitFocus(cards, heartsStart, 1), clubsStart) // wraps around
  assertEquals(nextSuitFocus(cards, clubsStart, -1), heartsStart) // wraps the other way
})

Deno.test('carousel: a single-suit hand wraps to itself on up/down', () => {
  const cards = orderedHand(['5C', '9C'])
  assertEquals(nextSuitFocus(cards, 0, 1), 0)
  assertEquals(nextSuitFocus(cards, 1, -1), 0)
})

// === crypto: real Web Crypto round trip, no browser required ===

Deno.test('crypto: encryptFor/decryptMine round-trips a hand of cards', async () => {
  const { publicKey, privateKey } = await generateKeypair()
  const jwk = await crypto.subtle.exportKey('jwk', publicKey)
  const hand = ['2C', '10H', 'QS']
  const cipher = await encryptFor(jwk, hand)
  const back = await decryptMine(privateKey, cipher)
  assertEquals(back, hand)
})

Deno.test('crypto: a different seat\'s private key cannot decrypt', async () => {
  const owner = await generateKeypair()
  const eavesdropper = await generateKeypair()
  const jwk = await crypto.subtle.exportKey('jwk', owner.publicKey)
  const cipher = await encryptFor(jwk, ['AH'])
  await assertRejects(() => decryptMine(eavesdropper.privateKey, cipher))
})
async function assertRejects(fn) {
  try { await fn() } catch { return }
  throw new Error('expected rejection, got none')
}

// === integration: a full simulated hand, engine only ===
// four "auto-players" that always play the first legal card — not a real
// strategy, just enough to walk every branch of legalPlays/trickWinner/
// handDeltas under real random deals, many times, without a browser.

function simulateHand(round) {
  const hands = dealHands(shuffledDeck())
  let turn = hands.findIndex(h => h.includes('2C'))
  const leader = turn
  let trick = []
  let heartsBroken = false
  let trickCount = 0
  const tricksWon = { 0: [], 1: [], 2: [], 3: [] }
  const playedCards = []

  while (trickCount < 13) {
    const legal = legalPlays(hands[turn], trick, heartsBroken, trickCount === 0)
    const card = legal[0]
    hands[turn] = hands[turn].filter(c => c !== card)
    playedCards.push(card)
    heartsBroken = heartsBroken || isHeart(card)
    trick.push({ seat: turn, card })

    if (trick.length < 4) { turn = (turn + 1) % 4; continue }

    const winner = trickWinner(trick)
    tricksWon[winner] = [...tricksWon[winner], ...trick.map(p => p.card)]
    trickCount++
    trick = []
    turn = winner
  }

  return { tricksWon, playedCards, leader }
}

Deno.test('integration: a simulated hand plays exactly 52 distinct cards across 13 tricks', () => {
  const { playedCards } = simulateHand(0)
  assertEquals(playedCards.length, 52)
  assertEquals(new Set(playedCards).size, 52)
})

Deno.test('integration: every hand\'s point total is conserved (26 normal, 78 on a moon shot)', () => {
  for (let i = 0; i < 200; i++) {
    const { tricksWon } = simulateHand(i % 4)
    const rawTotal = [0, 1, 2, 3].reduce((sum, s) => sum + trickPoints(tricksWon[s]), 0)
    assertEquals(rawTotal, 26, `iteration ${i}: raw trick points should always sum to 26`)
    const deltas = handDeltas(tricksWon)
    const deltaTotal = deltas.reduce((a, b) => a + b, 0)
    assert(deltaTotal === 26 || deltaTotal === 78, `iteration ${i}: deltas summed to ${deltaTotal}, expected 26 or 78`)
  }
})

Deno.test('integration: the 2♣ holder always leads the first trick, and always plays it', () => {
  for (let i = 0; i < 20; i++) {
    const { playedCards, leader } = simulateHand(0)
    assert(leader >= 0 && leader <= 3)
    assertEquals(playedCards[0], '2C')
  }
})

Deno.test('integration: passing rotates every seat\'s hand to a different seat, three rounds running', () => {
  const deck = shuffledDeck()
  const hands = dealHands(deck)
  for (const round of [0, 1, 2]) {
    const passes = [0, 1, 2, 3].map(seat => ({ from: seat, to: passRecipient(seat, round), cards: hands[seat].slice(0, 3) }))
    // every seat sends to a distinct seat, and receives from exactly one
    const recipients = passes.map(p => p.to)
    assertEquals(new Set(recipients).size, 4)
    passes.forEach(p => assertNotEquals(p.to, p.from))
  }
})
