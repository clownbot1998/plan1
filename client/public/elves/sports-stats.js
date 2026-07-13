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
// decks/staging/casting are wired now too — see plans/sports-stats/
// data-research-log.md for where the real-data side stands. THESE CARDS
// ARE PLACEHOLDER FICTIONAL STAT LINES, not vendored real data — that's
// still the next step. What's real here is the entity shape (they're
// built through the actual sports-engine.js casts, not ad hoc objects).
import Self, { linkState, broadcastElf } from '@plan98/elf'
import { ROLE_TIMEOUT_MS, mintRoleId, joinUrl, parseJoinParam, ROOM_MERGE } from './sports-stats-engine.js'
import { Pitcher, Catcher, Batter, QuarterBack, RunningBack, WideReceiver, TightEnd } from './sports-engine.js'

const tag = 'sports-stats'

// chroma green — the same hex v-log.js already established for this
// exact purpose (its own background-color palette calls it out by name,
// distinct from plan98-camera.js's casual 'dodgerblue' default for an
// unrelated live-draw feature). reused, not reinvented.
const CHROMA_GREEN = '#00b140'

const DECKS = {
  baseball: {
    label: '⚾ Baseball',
    cards: [
      Pitcher({ name: 'Spencer Strider', team: 'ATL', era: 3.86, whip: 1.09, wins: 5, strikeouts: 122 }),
      Catcher({ name: 'Will Smith', team: 'LAD', avg: 0.262, homeRuns: 18, rbi: 58 }),
      Batter({ name: 'Freddie Freeman', team: 'LAD', position: '1B', avg: 0.282, homeRuns: 16, rbi: 55 }),
    ],
  },
  football: {
    label: '🏈 Football',
    cards: [
      QuarterBack({ name: 'Josh Allen', team: 'BUF', passYards: 2450, passTouchdowns: 20, rushYards: 300 }),
      RunningBack({ name: 'Bijan Robinson', team: 'ATL', rushYards: 700, rushTouchdowns: 6, receptions: 30 }),
      WideReceiver({ name: 'CeeDee Lamb', team: 'DAL', receptions: 60, receivingYards: 780, receivingTouchdowns: 5 }),
      TightEnd({ name: 'Sam LaPorta', team: 'DET', receptions: 45, receivingYards: 520, receivingTouchdowns: 4 }),
    ],
  },
}

// position-aware — a Pitcher and a QuarterBack don't share a stat line,
// so this just asks the card what it is instead of assuming a shape.
function cardLines(card) {
  switch (card.position) {
    case 'P': return [`ERA ${card.era}`, `WHIP ${card.whip}`, `W ${card.wins}`, `K ${card.strikeouts}`]
    case 'C': return [`AVG ${card.avg}`, `HR ${card.homeRuns}`, `RBI ${card.rbi}`]
    case 'QB': return [`Pass Yds ${card.passYards}`, `Pass TD ${card.passTouchdowns}`, `Rush Yds ${card.rushYards}`]
    case 'RB': return [`Rush Yds ${card.rushYards}`, `Rush TD ${card.rushTouchdowns}`, `Rec ${card.receptions}`]
    case 'WR': case 'TE': return [`Rec ${card.receptions}`, `Rec Yds ${card.receivingYards}`, `Rec TD ${card.receivingTouchdowns}`]
    default: return [`AVG ${card.avg}`, `HR ${card.homeRuns}`, `RBI ${card.rbi}`]
  }
}

const $ = Self(tag, {
  view: 'boot',        // boot | receiver | transmitter
  receivers: {},       // { [id]: { name, lastSeen, cast: { full, left, right } } }
  transmitters: {},    // { [id]: { name, lastSeen } }
  modalReceiverId: null, // local-only — which receiver's reconnect code is on screen
  activeDeck: null,      // local-only — which deck the transmitter has open
  stagedCardIdx: null,   // local-only — index into the active deck's cards
  targetReceiverId: null, // local-only — which receiver Send acts on
  showSetup: false,       // local-only — receiver's setup/recovery overlay
})

function commit(patch) {
  $.teach(patch, ROOM_MERGE)
  try { broadcastElf(tag, patch, ROOM_MERGE) } catch (e) { console.warn('sports-stats sync:', e) }
}

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
function castTo(zone) {
  const { activeDeck, stagedCardIdx, targetReceiverId, receivers } = $.learn()
  if (!activeDeck || stagedCardIdx == null) return
  const targetId = targetReceiverId || Object.keys(receivers)[0]
  if (!targetId || !receivers[targetId]) return
  const card = DECKS[activeDeck].cards[stagedCardIdx]
  const role = receivers[targetId]
  const cast = zone === 'full'
    ? { full: card, left: null, right: null }
    : { ...(role.cast || EMPTY_CAST), full: null, [zone]: card }
  commit({ receivers: { [targetId]: { ...role, cast } } })
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

function cardCard(card) {
  return `
    <div class="ss-cast-card">
      <div class="ss-cast-name">${esc(card.name)}</div>
      <div class="ss-cast-meta">${esc(card.team)} · ${esc(card.position)}</div>
      <div class="ss-cast-lines">${cardLines(card).map(l => `<div>${esc(l)}</div>`).join('')}</div>
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

function deckListView() {
  return `
    <div class="ss-deck-picker">
      <h3>Decks</h3>
      <div class="ss-deck-grid">
        ${Object.entries(DECKS).map(([key, deck]) => `<button class="ss-deck-card" data-open-deck="${key}">${deck.label}</button>`).join('')}
      </div>
    </div>`
}

function handView(deckKey, stagedCardIdx) {
  const deck = DECKS[deckKey]
  const staged = stagedCardIdx != null ? deck.cards[stagedCardIdx] : null
  return `
    <div class="ss-hand">
      <div class="ss-hand-header">
        <button class="ss-back-btn" data-back-to-decks>← Back</button>
        <span class="ss-hand-title">${deck.label}</span>
      </div>
      <div class="ss-card-list">
        ${deck.cards.map((c, i) => `
          <button class="ss-card-row ${i === stagedCardIdx ? '-selected' : ''}" data-select-card="${i}">
            <span class="ss-card-name">${esc(c.name)}</span>
            <span class="ss-card-meta">${esc(c.team)} · ${esc(c.position)}</span>
          </button>`).join('')}
      </div>
      <div class="ss-staging">
        ${staged ? `
          <div class="ss-staged-preview">
            <div class="ss-staged-name">${esc(staged.name)}</div>
            <div class="ss-staged-lines">${cardLines(staged).map(l => `<span>${esc(l)}</span>`).join(' · ')}</div>
          </div>
          <div class="ss-send-row">
            <button class="ss-send-btn" data-send="left">Send Left</button>
            <button class="ss-send-btn -full" data-send="full">Send Full</button>
            <button class="ss-send-btn" data-send="right">Send Right</button>
          </div>` : `<div class="ss-empty">tap a card to stage it</div>`}
      </div>
    </div>`
}

function transmitterView() {
  const { receivers, transmitters, activeDeck, stagedCardIdx, targetReceiverId } = $.learn()
  if (receivers[_pendingReceiverInvite]) _pendingReceiverInvite = mintRoleId()

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
        ${activeDeck ? handView(activeDeck, stagedCardIdx) : deckListView()}
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
$.when('click', '[data-open-deck]', e => $.whisper({ activeDeck: e.target.closest('[data-open-deck]').dataset.openDeck, stagedCardIdx: null }))
$.when('click', '[data-back-to-decks]', () => $.whisper({ activeDeck: null, stagedCardIdx: null }))
$.when('click', '[data-select-card]', e => $.whisper({ stagedCardIdx: Number(e.target.closest('[data-select-card]').dataset.selectCard) }))
$.when('click', '[data-send]', e => castTo(e.target.closest('[data-send]').dataset.send))
$.when('click', '[data-pick-receiver]', e => $.whisper({ targetReceiverId: e.target.closest('[data-pick-receiver]').dataset.pickReceiver }))

$.style(`
  & { display: block; height: 100%; width: 100%; overflow: auto; font-family: inherit; background: #0f1720; color: #e8edf3; }
  & .ss-shell { min-height: 100%; display: flex; align-items: center; justify-content: center; padding: 1.2rem; box-sizing: border-box; }
  & .ss-panel { width: min(100%, 26rem); display: flex; flex-direction: column; gap: .8rem; }
  & h2 { margin: 0; } & h3 { margin: .4rem 0 0; font-size: .95rem; opacity: .75; }
  & .ss-qr-block { display: flex; flex-direction: column; align-items: center; gap: .4rem; background: #182432; border-radius: .6rem; padding: 1rem; }
  & .ss-qr-block.-small qr-code { width: 7rem; height: 7rem; }
  & .ss-qr-mount { width: 11rem; height: 11rem; }
  & .ss-qr-mount qr-code { width: 11rem; height: 11rem; display: block; border-radius: .5rem; overflow: hidden; }
  & .ss-qr-label { font-size: .8rem; opacity: .7; text-align: center; }
  & .ss-role-list { display: flex; flex-direction: column; gap: .35rem; }
  & .ss-role-row { display: flex; align-items: center; justify-content: space-between; gap: .5rem; background: #182432; border-radius: .4rem; padding: .5rem .7rem; }
  & .ss-role-name { font-weight: 600; }
  & .ss-empty { opacity: .55; font-size: .85rem; padding: .3rem 0; }
  & .ss-recover { background: #182432; border-radius: .5rem; padding: .5rem .7rem; }
  & .ss-recover summary { cursor: pointer; font-size: .85rem; opacity: .8; }
  & .ss-mini-btn { font-size: .78rem; background: lemonchiffon; color: #222; border: none; border-radius: .4rem; padding: .3rem .6rem; cursor: pointer; }
  & .ss-tx-header { display: flex; align-items: center; gap: .5rem; }
  & .ss-edit-name { background: none; border: none; color: inherit; opacity: .7; cursor: pointer; }
  & .ss-edit-name:hover { opacity: 1; }
  & .ss-deck-picker { border-top: 1px solid rgba(255,255,255,.12); padding-top: .8rem; }
  & .ss-deck-grid { display: flex; gap: .6rem; flex-wrap: wrap; }
  & .ss-deck-card { flex: 1; min-width: 8rem; font-size: 1rem; font-weight: 700; padding: 1rem; border-radius: .6rem; border: none; background: lemonchiffon; color: #222; cursor: pointer; }
  & .ss-modal-bg { position: fixed; inset: 0; background: rgba(0,0,0,.6); display: flex; align-items: center; justify-content: center; z-index: 50; }
  & .ss-modal { background: #182432; border-radius: .6rem; padding: 1.2rem; display: flex; flex-direction: column; align-items: center; gap: .6rem; max-height: 90vh; overflow-y: auto; }

  & .ss-role-row.-active { outline: .12rem solid lemonchiffon; }
  & .ss-role-select { background: none; border: none; color: inherit; font-weight: 600; cursor: pointer; padding: 0; text-align: left; }

  /* === receiver: live zones, chroma-key when empty === */
  & .ss-live { position: relative; height: 100%; width: 100%; }
  & .ss-zones { display: flex; height: 100%; width: 100%; }
  & .ss-zone { flex: 1; display: flex; align-items: center; justify-content: center; padding: 1rem; box-sizing: border-box; }
  & .ss-zone.-full { height: 100%; width: 100%; }
  & .ss-zone.-key { background: ${CHROMA_GREEN}; }
  & .ss-cast-card { background: rgba(15,23,32,.9); border-radius: .8rem; padding: 1.4rem 1.8rem; text-align: center; }
  & .ss-cast-name { font-size: 1.4rem; font-weight: 800; }
  & .ss-cast-meta { opacity: .7; font-size: .9rem; margin-top: .2rem; }
  & .ss-cast-lines { margin-top: .6rem; display: flex; flex-direction: column; gap: .2rem; font-size: 1.05rem; }
  & .ss-corner-btn { position: absolute; top: .8rem; right: .8rem; background: rgba(0,0,0,.4); color: #fff; border: none; border-radius: 50%; width: 2.2rem; height: 2.2rem; cursor: pointer; font-size: 1.1rem; }

  /* === transmitter: deck browsing + hand + staging === */
  & .ss-hand { display: flex; flex-direction: column; gap: .6rem; border-top: 1px solid rgba(255,255,255,.12); padding-top: .8rem; }
  & .ss-hand-header { display: flex; align-items: center; gap: .6rem; }
  & .ss-back-btn { background: none; border: 1px solid rgba(255,255,255,.3); color: inherit; border-radius: .4rem; padding: .3rem .6rem; cursor: pointer; }
  & .ss-hand-title { font-weight: 700; }
  & .ss-card-list { display: flex; flex-direction: column; gap: .35rem; max-height: 12rem; overflow-y: auto; }
  & .ss-card-row { display: flex; justify-content: space-between; gap: .5rem; background: #182432; border: none; border-radius: .4rem; padding: .5rem .7rem; color: inherit; cursor: pointer; text-align: left; }
  & .ss-card-row.-selected { outline: .12rem solid lemonchiffon; }
  & .ss-card-name { font-weight: 600; }
  & .ss-card-meta { opacity: .65; font-size: .85rem; }
  & .ss-staging { background: #182432; border-radius: .5rem; padding: .7rem; display: flex; flex-direction: column; gap: .5rem; align-items: center; }
  & .ss-staged-name { font-weight: 700; }
  & .ss-staged-lines { opacity: .8; font-size: .85rem; margin-top: .2rem; }
  & .ss-send-row { display: flex; gap: .5rem; width: 100%; }
  & .ss-send-btn { flex: 1; font-weight: 700; padding: .55rem 0; border-radius: .4rem; border: none; background: lemonchiffon; color: #222; cursor: pointer; }
  & .ss-send-btn.-full { background: #2ecc40; }
`)
