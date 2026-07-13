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
// this file is the connection layer only (decks/staging come next) — see
// plans/sports-stats/data-research-log.md for where the data side stands.
import Self, { linkState, broadcastElf } from '@plan98/elf'
import { ROLE_TIMEOUT_MS, mintRoleId, joinUrl, parseJoinParam, ROOM_MERGE } from './sports-stats-engine.js'

const tag = 'sports-stats'

const $ = Self(tag, {
  view: 'boot',        // boot | receiver | transmitter
  receivers: {},       // { [id]: { name, lastSeen } }
  transmitters: {},    // { [id]: { name, lastSeen } }
  modalReceiverId: null, // local-only — which receiver's reconnect code is on screen
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

// === rendering ===
function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])) }

function roleRow(id, role, actions = '') {
  return `<div class="ss-role-row"><span class="ss-role-name">${esc(role.name)}</span>${actions}</div>`
}

// this receiver's own always-live invite for new transmitters to join the
// trust pool — regenerated fresh once the CURRENT pending one gets
// claimed, so there's always exactly one open invite on screen, forever.
let _pendingTransmitterInvite = mintRoleId()

function receiverView() {
  const { transmitters } = $.learn()
  if (transmitters[_pendingTransmitterInvite]) _pendingTransmitterInvite = mintRoleId()

  const transmitterRows = Object.entries(transmitters)
    .map(([id, role]) => roleRow(id, role)).join('') || `<div class="ss-empty">no transmitters connected yet</div>`

  return `
    <div class="ss-shell -receiver">
      <div class="ss-panel">
        <h2>Receiver</h2>
        <div class="ss-qr-block">
          <div class="ss-qr-mount" data-qr-mount="invite-transmitter"></div>
          <div class="ss-qr-label">scan to unlock transmitter</div>
        </div>
        <h3>Connected transmitters</h3>
        <div class="ss-role-list">${transmitterRows}</div>
        <details class="ss-recover">
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
      </div>
    </div>`
}

let _pendingReceiverInvite = mintRoleId()

function transmitterView() {
  const { receivers, transmitters } = $.learn()
  if (receivers[_pendingReceiverInvite]) _pendingReceiverInvite = mintRoleId()

  const receiverRows = Object.entries(receivers).map(([id, role]) =>
    `<div class="ss-role-row">
      <span class="ss-role-name">${esc(role.name)}</span>
      <button class="ss-mini-btn" data-show-reconnect="${id}">reconnect code</button>
    </div>`).join('') || `<div class="ss-empty">no receivers online</div>`

  const me = transmitters[myRoleId]

  return `
    <div class="ss-shell -transmitter">
      <div class="ss-panel">
        <div class="ss-tx-header">
          <span class="ss-role-name">${esc(me ? me.name : '')}</span>
          <button class="ss-edit-name" data-edit-name title="Change operator name">✎</button>
        </div>
        <h3>Receivers</h3>
        <div class="ss-role-list">${receiverRows}</div>
        <details class="ss-recover">
          <summary>Pass the torch (share my control)</summary>
          <div class="ss-qr-block -small">
            <div class="ss-qr-mount" data-qr-mount="reconnect-self"></div>
            <div class="ss-qr-label">scan on a new device to take over as this transmitter</div>
          </div>
        </details>
        <div class="ss-deck-stub">
          <h3>Decks</h3>
          <div class="ss-deck-grid">
            <button class="ss-deck-card">⚾ Baseball Decks</button>
            <button class="ss-deck-card">🏈 Football Decks</button>
          </div>
          <div class="ss-empty">deck browsing + staging area: next up</div>
        </div>
      </div>
      ${renderReconnectModal()}
    </div>`
}

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
  & .ss-deck-stub { border-top: 1px solid rgba(255,255,255,.12); padding-top: .8rem; }
  & .ss-deck-grid { display: flex; gap: .6rem; flex-wrap: wrap; }
  & .ss-deck-card { flex: 1; min-width: 8rem; font-size: 1rem; font-weight: 700; padding: 1rem; border-radius: .6rem; border: none; background: lemonchiffon; color: #222; cursor: pointer; }
  & .ss-modal-bg { position: fixed; inset: 0; background: rgba(0,0,0,.6); display: flex; align-items: center; justify-content: center; z-index: 50; }
  & .ss-modal { background: #182432; border-radius: .6rem; padding: 1.2rem; display: flex; flex-direction: column; align-items: center; gap: .6rem; }
`)
