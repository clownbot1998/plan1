// pot-luck.js — a swap for good
//
// single-file app architecture: one tag, one store, one module.
// no bundler. no build step. the importmap in index.html resolves bare
// specifiers to local paths — that's the whole module system.
// everything else is plain javascript running directly in the browser.

// === imports ===
// Self gives us the elf lifecycle: draw, teach, whisper, when, style, learn.
// linkState joins a geckos WebRTC room so the store syncs across devices.
// broadcastElf pushes a delta to every peer in the room.
// channel is the live geckos connection object (null until connected).
// Cache wraps IndexedDB — one record per potluck, keyed by its ?id.

import Self, { linkState, broadcastElf, channel } from '@plan98/elf'
import Cache from '@silly/cache'

// === module variables ===
// these live for the lifetime of the page.
// anything that must NOT sync across devices lives here, not in the store.

const tag = 'pot-luck'
const cache = Cache(tag)

// images are kept OUT of the synced store — base64 is large and would lag
// every store write and broadcast. bytes live in a side cache keyed by a
// short ref. `images` is an in-memory map so we only hit IndexedDB once per ref.
const imgCache = Cache(tag + '-img')
const images = {}
function newImgId() { return 'img_' + crypto.randomUUID().replace(/-/g, '').slice(0, 12) }
function imgUrl(id) {
  if (!id) return ''
  if (id in images) return images[id] || ''
  images[id] = null // mark loading — prevents duplicate fetches
  imgCache.get(id).then(r => { images[id] = (r && r.data) || ''; redraw() })
  return ''
}

// worker message protocol (mirrors trade-maximizer/trademax-util.js)
const CUT = '__cut__' // the "won't trade" divider token in a wish list
const RUN = 1, OUTPUT = 10, ERROR = 12, DONE = 13

// currentId is which potluck we're viewing — set from the ?id param.
// registry is the local list of potlucks (stored in cache under 'index').
// both live here, not in the store, because they're navigation state.
let currentId = new URLSearchParams(location.search).get('id') || 'index'
let registry = { potlucks: [] }

// the per-key merge function for shared data.
// users/offerings/wishes merge entry-by-entry so concurrent additions by
// different people both survive — no last-write-wins clobber.
// a null value is a tombstone (deletion). lastMatch is last-write-wins.
// this string is eval'd in a QuickJS sandbox both locally and on peers.
const ROOM_MERGE = `(state, payload) => {
  var out = Object.assign({}, state)
  ;['users','offerings','wishes'].forEach(function(field){
    if (payload[field]) {
      var base = Object.assign({}, state[field] || {})
      var inc = payload[field]
      Object.keys(inc).forEach(function(k){ if (inc[k] === null) { delete base[k] } else { base[k] = inc[k] } })
      out[field] = base
    }
  })
  if (payload.lastMatch !== undefined) out.lastMatch = payload.lastMatch
  return out
}`

const newData = () => ({ users: {}, offerings: {}, wishes: {}, lastMatch: null })

// normalize a legacy array or a map into an id-keyed map
function toMap(v) { if (Array.isArray(v)) { const o = {}; v.forEach(x => { if (x && x.id) o[x.id] = x }); return o } return v || {} }

// commit: write to local store → persist to IndexedDB → broadcast delta to room.
// this is the only path that touches the network — keep it small.
function commit(patch) {
  $.teach(patch, ROOM_MERGE)
  if (currentId === 'index') return
  cache.put(currentId, sharedData())
  try { broadcastElf(tag, patch, ROOM_MERGE) } catch (e) { console.warn('pot-luck sync:', e) }
}

function redraw() { $.whisper({ rev: $.learn().rev + 1 }) }
function sharedData() { const s = $.learn(); return { users: s.users, offerings: s.offerings, wishes: s.wishes, lastMatch: s.lastMatch } }
function persistRegistry() { cache.put('index', registry); redraw() }
function nextId(prefix) { return prefix + crypto.randomUUID().replace(/-/g, '').slice(0, 8) }
function userById(id) { return $.learn().users[id] || null }
function activeUser() { return userById($.learn().activeUserId) }
function offeringById(id) { return $.learn().offerings[id] || null }

async function loadPotluck(id) {
  const r = await cache.get(id)
  const d = r && r.data ? r.data : newData()
  $.teach({ users: toMap(d.users), offerings: toMap(d.offerings), wishes: d.wishes || {}, lastMatch: d.lastMatch || null })
  $.whisper({ activeUserId: sessionStorage.getItem('potluck-me-' + id) || null })
  linkState(tag, id) // join the room; our loaded data seeds it, room state merges back
  // re-assert our per-tab identity once the room join settles — stateCache can
  // briefly carry the seeder's activeUserId. one-off, never inside render.
  setTimeout(() => { if (currentId === id) $.whisper({ activeUserId: sessionStorage.getItem('potluck-me-' + id) || null }) }, 800)
}

async function openPotluck(id) {
  currentId = id
  history.replaceState(null, '', `?id=${id}`)
  await loadPotluck(id)
  $.whisper({ screen: 'home', modal: null })
}

function gotoIndex() {
  currentId = 'index'
  history.replaceState(null, '', `?id=index`)
  $.whisper({ screen: 'home', modal: null })
}

async function newPotluck() {
  const id = crypto.randomUUID()
  registry.potlucks.push({ id, name: 'Potluck ' + (registry.potlucks.length + 1), created: Date.now() })
  persistRegistry()
  await openPotluck(id)
}

function deletePotluck(id) {
  const p = registry.potlucks.find(x => x.id === id)
  if (!confirm(`Delete potluck "${p ? p.name : id}"? This removes all its gifts and participants.`)) return
  registry.potlucks = registry.potlucks.filter(x => x.id !== id)
  persistRegistry()
  cache.del(id)
}

// wish list: each user's wish is an ordered list of offering ids (not their own)
// plus the CUT divider. items before CUT are wanted (ranked); after are won't-trade.
function ensureWish(userId) {
  const pool = Object.values($.learn().offerings).filter(o => o.ownerId !== userId).map(o => o.id)
  let order = ($.learn().wishes[userId] || []).slice()
  order = order.filter(t => t === CUT || pool.includes(t))
  if (!order.includes(CUT)) order.push(CUT)
  const present = new Set(order)
  const cutAt = order.indexOf(CUT)
  order.splice(cutAt, 0, ...pool.filter(id => !present.has(id)))
  return order
}

function wantedIds(userId) {
  const order = ensureWish(userId)
  return order.slice(0, order.indexOf(CUT)).filter(t => t !== CUT)
}

function buildWants() {
  const lines = ['#! REQUIRE-USERNAMES', '#! HIDE-NONTRADES', '', '!BEGIN-OFFICIAL-NAMES']
  for (const o of Object.values($.learn().offerings)) {
    lines.push(`${o.id} ==> "${String(o.note || 'gift').replace(/["\n\r]/g, ' ').slice(0, 80)}" (from ${o.ownerId})`)
  }
  lines.push('!END-OFFICIAL-NAMES', '')
  for (const u of Object.values($.learn().users)) {
    const wants = wantedIds(u.id)
    if (!wants.length) continue
    for (const o of Object.values($.learn().offerings).filter(o => o.ownerId === u.id)) {
      lines.push(`(${u.id}) ${o.id} : ${wants.join(' ')}`)
    }
  }
  return lines.join('\n')
}

function inputSignature() {
  return JSON.stringify({
    o: Object.values($.learn().offerings).map(o => [o.id, o.ownerId, o.note]),
    w: Object.values($.learn().users).map(u => wantedIds(u.id)),
  })
}

// the match engine (TradeMaximizer) runs in a Web Worker. the page is
// cross-origin isolated (COEP: credentialless), which blocks same-origin
// worker scripts unless they carry COEP headers. a blob worker inherits
// the document's COEP — so we bootstrap it with importScripts of the real
// engine URL instead of passing the URL directly to new Worker().
function spawnTradeWorker() {
  const abs = self.location.origin + '/elves/trade-maximizer/trademax-worker.js'
  const blob = new Blob([`importScripts(${JSON.stringify(abs)});`], { type: 'text/javascript' })
  const url = URL.createObjectURL(blob)
  const w = new Worker(url)
  setTimeout(() => URL.revokeObjectURL(url), 0)
  return w
}

function runMatch() {
  if (Object.keys($.learn().offerings).length < 2) { $.whisper({ matching: false }); return }
  $.whisper({ matching: true })
  const input = buildWants()
  let out = '', worker
  try { worker = spawnTradeWorker() } catch (e) {
    commit({ lastMatch: { edges: [], at: nowStamp(), sig: inputSignature(), error: String(e) } })
    $.whisper({ matching: false }); return
  }
  worker.onmessage = ({ data: [t, a, nl] }) => {
    if (t === OUTPUT) out += a + (nl ? '\n' : '')
    else if (t === ERROR) out += '\n[error] ' + a + '\n'
    else if (t === DONE) {
      worker.terminate()
      commit({ lastMatch: { edges: parseLoops(out), at: nowStamp(), sig: inputSignature(), raw: out } })
      $.whisper({ matching: false })
    }
  }
  worker.onerror = (err) => {
    worker.terminate()
    const detail = (err.message || '') + (err.filename ? ` @ ${err.filename}:${err.lineno}` : '')
    commit({ lastMatch: { edges: [], at: nowStamp(), sig: inputSignature(), error: detail.trim() || 'worker error (check console)' } })
    $.whisper({ matching: false })
  }
  worker.postMessage([RUN, input])
}

function nowStamp() { return new Date().toLocaleString() }

function parseLoops(out) {
  const edges = []; let inLoops = false
  for (const line of out.split('\n')) {
    if (/^TRADE LOOPS/.test(line)) { inLoops = true; continue }
    if (!inLoops) continue
    if (/^ITEM SUMMARY|^Num trades/.test(line)) break
    const m = line.match(/^\(([^)]+)\)\s+(\S+)\s+receives\s+\(([^)]+)\)\s+(\S+)\s*$/)
    if (m) edges.push({ recvItem: m[2].toUpperCase(), givenItem: m[4].toUpperCase() })
  }
  return edges
}

function offeringByUpper(id) { return Object.values($.learn().offerings).find(o => o.id.toUpperCase() === id) || null }

// boot: load registry, then load the current potluck if we're not on index
;(async function boot() {
  const r = await cache.get('index')
  if (r && r.data) registry = r.data
  if (currentId !== 'index') {
    if (!registry.potlucks.find(p => p.id === currentId)) {
      registry.potlucks.push({ id: currentId, name: 'Potluck ' + (registry.potlucks.length + 1), created: Date.now() })
      cache.put('index', registry)
    }
    await loadPotluck(currentId)
  }
  $.whisper({ loading: false })
})()

// bump rev every 2s so the live/offline indicator stays fresh
setInterval(redraw, 2000)

// === Self ===
// Self(tag, initialState) registers the custom element and returns $ —
// the elf's control surface. the initial state seeds the store on first load.
// shared fields sync to the geckos room via commit().
// local-only fields are written with $.whisper — never leaves this window.

const $ = Self(tag, {
  rev: 0,
  // shared — synced via commit() → broadcastElf()
  users: {}, offerings: {}, wishes: {}, lastMatch: null,
  // local-only — written with $.whisper, never goes over the wire
  screen: 'home', modal: null, matching: false, loading: true, activeUserId: null,
})

// === draw ===
// $.draw() registers a render function. it runs once on mount and again
// whenever the store changes. the return value is diffed against the DOM —
// only the changed nodes update. keep it pure: read from $.learn(), return HTML.

$.draw(() => {
  if ($.learn().loading) return `<div class="po-shell"><main class="po-main"><div class="po-empty" style="padding:2rem">loading…</div></main></div>`

  if (currentId === 'index') return `
    <div class="po-shell">
      <div class="po-topbar"><span class="po-home-btn">pot-luck</span></div>
      <div class="po-body"><main class="po-main">${indexScreen()}</main></div>
    </div>`

  const { screen, activeUserId } = $.learn()
  const me = activeUser()
  const pl = registry.potlucks.find(p => p.id === currentId)
  const live = !!(typeof channel !== 'undefined' && channel && channel.id)
  return `
    <div class="po-shell">
      <div class="po-topbar">
        <button class="po-home-btn" data-goto-index>↤ Potlucks</button>
        <button class="po-pl-title" data-screen="home">${esc(pl ? pl.name : 'Potluck')}</button>
        <nav class="po-nav">
          ${['offer','wish','match','settings'].map(s => `<button class="po-tab ${screen === s ? 'on' : ''}" data-screen="${s}">${s[0].toUpperCase() + s.slice(1)}</button>`).join('')}
        </nav>
        <span class="po-live ${live ? 'on' : ''}" title="realtime connection">${live ? '● live' : '○ offline'}</span>
        <span class="po-active">${me ? `${avatar(me)} ${esc(me.name)}` : 'no participant'}</span>
      </div>
      <div class="po-body">
        <aside class="po-sidebar">
          <button class="po-btn po-new" data-new-user>+ New user</button>
          <div class="po-sidebar-label">participants — click to make active</div>
          <div class="po-userlist">
            ${Object.values($.learn().users).map(u => `
              <button class="po-userrow ${u.id === activeUserId ? 'on' : ''}" data-set-active="${u.id}">
                ${avatar(u)} <span class="po-userrow-name">${esc(u.name)}</span>
                ${u.id === activeUserId ? '<span class="po-dot">active</span>' : ''}
              </button>`).join('') || '<div class="po-empty">no participants</div>'}
          </div>
        </aside>
        <main class="po-main">${(SCREENS[screen] || homeScreen)()}</main>
      </div>
      ${modalView()}
    </div>`
})

// === event handlers ===
// $.when(type, selector, handler) delegates events on the elf's shadow.
// the selector is matched against event.target — not closest(), not bubbling.
// put button * { pointer-events: none } in $.style() so clicks land on
// the button itself, not a child element.

$.when('click', '[data-screen]',         onScreen)
$.when('click', '[data-goto-index]',     onGotoIndex)
$.when('click', '[data-new-potluck]',    onNewPotluck)
$.when('click', '[data-open-potluck]',   onOpenPotluck)
$.when('click', '[data-rename-potluck]', onRenamePotluck)
$.when('click', '[data-del-potluck]',    onDelPotluck)
$.when('click', '[data-new-user]',       onNewUser)
$.when('click', '[data-set-active]',     onSetActive)
$.when('click', '[data-del-user]',       onDelUser)
$.when('click', '[data-save-profile]',   onSaveProfile)
$.when('click', '[data-modal]',          onOpenModal)
$.when('click', '[data-close-modal]',    onCloseModal)
$.when('click', '[data-save-offer]',     onSaveOffer)
$.when('click', '[data-del-offer]',      onDelOffer)
$.when('click', '[data-match]',          onMatch)
$.when('change', '.po-file',             onPicChange)
$.when('pointerdown', '[data-hold]',     onHoldStart)
$.when('pointerup',     '[data-hold]',   onHoldEnd)
$.when('pointerleave',  '[data-hold]',   onHoldCancel)
$.when('pointercancel', '[data-hold]',   onHoldCancel)

// === hoisted handlers ===
// function declarations are hoisted — they can be listed above their
// definitions. handlers receive the DOM event; use .closest() to find
// the nearest ancestor with the data attribute.

function onScreen(e)        { $.whisper({ screen: e.target.closest('[data-screen]').dataset.screen }) }
function onGotoIndex()      { gotoIndex() }
function onNewPotluck()     { newPotluck() }
function onOpenPotluck(e)   { openPotluck(e.target.closest('[data-open-potluck]').dataset.openPotluck) }
function onDelPotluck(e)    { deletePotluck(e.target.closest('[data-del-potluck]').dataset.delPotluck) }
function onMatch()          { runMatch() }

function onRenamePotluck(e) {
  const p = registry.potlucks.find(x => x.id === e.target.closest('[data-rename-potluck]').dataset.renamePotluck)
  if (!p) return
  const name = prompt('Rename potluck', p.name)
  if (name == null) return
  p.name = name.trim() || p.name
  persistRegistry()
}

function onNewUser() {
  const id = nextId('u_')
  const n = Object.keys($.learn().users).length + 1
  commit({ users: { [id]: { id, name: 'Guest ' + n, color: '#5b8def', bio: '', pic: '' } } })
  $.whisper({ activeUserId: id })
  sessionStorage.setItem('potluck-me-' + currentId, id)
  $.whisper({ screen: 'settings' })
}

function onSetActive(e) {
  const aid = e.target.closest('[data-set-active]').dataset.setActive
  $.whisper({ activeUserId: aid })
  sessionStorage.setItem('potluck-me-' + currentId, aid)
}

function onDelUser(e) {
  const id = e.target.closest('[data-del-user]').dataset.delUser
  const u = userById(id)
  if (!u || !confirm(`Delete ${u.name} and their offerings? This can't be undone.`)) return
  const s = $.learn()
  const ownedIds = Object.values(s.offerings).filter(o => o.ownerId === id).map(o => o.id)
  const offeringsDelta = {}; ownedIds.forEach(oid => offeringsDelta[oid] = null)
  const wishesDelta = {}
  for (const uid of Object.keys(s.wishes)) wishesDelta[uid] = uid === id ? null : s.wishes[uid].filter(t => !ownedIds.includes(t))
  commit({ users: { [id]: null }, offerings: offeringsDelta, wishes: wishesDelta })
  if ($.learn().activeUserId === id) { $.whisper({ activeUserId: null }); sessionStorage.removeItem('potluck-me-' + currentId) }
  $.whisper({ screen: Object.keys($.learn().users).length ? 'settings' : 'home' })
}

function onSaveProfile(e) {
  const u = userById(e.target.closest('[data-save-profile]').dataset.saveProfile)
  if (!u) return
  const patch = {}
  e.target.closest('.po-profile').querySelectorAll('[data-field]').forEach(el => { patch[el.dataset.field] = el.value })
  commit({ users: { [u.id]: { ...u, ...patch } } })
}

let draft = { pic: '' }
function onOpenModal(e)  { draft = { pic: '' }; $.whisper({ modal: e.target.closest('[data-modal]').dataset.modal }) }
function onCloseModal(e) { if (e.target.matches('[data-close-modal]')) $.whisper({ modal: null }) }

function onSaveOffer(e) {
  const me = activeUser()
  if (!me) return
  const note = e.target.closest('.po-modal')?.querySelector('#po-add-note')?.value || ''
  const oid = nextId('o_')
  commit({ offerings: { [oid]: { id: oid, ownerId: me.id, note: note.trim(), pic: draft.pic || '' } } })
  draft = { pic: '' }
  $.whisper({ modal: null })
}

function onDelOffer(e) {
  const id = e.target.closest('[data-del-offer]').dataset.delOffer
  const s = $.learn()
  const wishes = {}
  for (const uid of Object.keys(s.wishes)) wishes[uid] = s.wishes[uid].filter(t => t !== id)
  commit({ offerings: { [id]: null }, wishes })
}

function onPicChange(e) {
  const input = e.target
  const file = input.files && input.files[0]
  if (!file) return
  const reader = new FileReader()
  reader.onload = () => {
    const dataUrl = reader.result
    const imgId = newImgId()
    imgCache.put(imgId, dataUrl)
    images[imgId] = dataUrl
    const forId = input.dataset.picFor
    if (forId === '__draft__') {
      draft.pic = imgId
      const prev = input.closest('.po-modal')?.querySelector('#po-add-preview')
      if (prev) { prev.style.backgroundImage = `url(${dataUrl})`; prev.textContent = ''; prev.classList.add('has-pic') }
    } else {
      commit({ users: { [forId]: { ...$.learn().users[forId], pic: imgId } } })
    }
  }
  reader.readAsDataURL(file)
}

let hold = null
function onHoldStart(e) {
  const btn = e.target.closest('[data-hold]')
  const token = btn.dataset.wid, dir = btn.dataset.hold
  hold = { token, dir, fired: false }
  hold.timer = setTimeout(() => {
    if (!hold) return
    hold.fired = true
    moveWish($.learn().activeUserId, token, dir === 'up' ? 'top' : 'bottom')
  }, 500)
}
function onHoldEnd()    { if (hold) { clearTimeout(hold.timer); if (!hold.fired) moveWish($.learn().activeUserId, hold.token, hold.dir); hold = null } }
function onHoldCancel() { if (hold) { clearTimeout(hold.timer); hold = null } }

function moveWish(userId, token, kind) {
  const order = ensureWish(userId)
  const i = order.indexOf(token)
  if (i === -1) return
  order.splice(i, 1)
  if (kind === 'up') order.splice(Math.max(0, i - 1), 0, token)
  else if (kind === 'down') order.splice(Math.min(order.length, i + 1), 0, token)
  else if (kind === 'top') order.unshift(token)
  else if (kind === 'bottom') order.push(token)
  commit({ wishes: { [userId]: order } })
}

// === rendering ===
// pure functions — read state, return HTML strings. no side effects.
// called from $.draw() and from each other. diffhtml diffs the output
// against the live DOM so only changed nodes are updated.

function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])) }

function thumb(pic, cls = '') {
  const url = imgUrl(pic)
  return url
    ? `<span class="po-thumb ${cls}" style="background-image:url(${url})"></span>`
    : `<span class="po-thumb po-thumb-empty ${cls}">🎁</span>`
}

function avatar(user, cls = '') {
  if (!user) return ''
  const url = imgUrl(user.pic)
  return url
    ? `<span class="po-avatar ${cls}" style="background-image:url(${url})"></span>`
    : `<span class="po-avatar po-avatar-empty ${cls}" style="background:${user.color || '#888'}">${(user.name || '?')[0]}</span>`
}

function needUser() { return `<div class="po-empty">Pick or create a participant in the sidebar to begin.</div>` }

function homeScreen() {
  return `
    <div class="po-home">
      <div class="po-hero">
        <h1>pot-luck</h1>
        <p>a swap for good — bring a gift, wish for others', let the table find the trades.</p>
      </div>
      <div class="po-cards">
        ${[['offer','🎁 Offer','Share a gift that you\'re willing to trade'],
           ['wish','⭐ Wish','For items in the potluck offering pool'],
           ['match','🔀 Match','With who you will give to and who you will receive from']
          ].map(([s,t,d]) => `<button class="po-card" data-screen="${s}"><span class="po-card-title">${t}</span><span class="po-card-desc">${d}</span></button>`).join('')}
      </div>
    </div>`
}

function offerScreen() {
  const me = activeUser()
  if (!me) return needUser()
  const mine = Object.values($.learn().offerings).filter(o => o.ownerId === me.id)
  const all = Object.values($.learn().offerings)
  const card = o => `
    <div class="po-offer" data-oid="${o.id}">
      ${thumb(o.pic)}
      <span class="po-offer-note">${esc(o.note) || '<em>untitled</em>'}</span>
      <span class="po-offer-owner">${avatar(userById(o.ownerId))} ${esc(userById(o.ownerId)?.name)}</span>
      ${o.ownerId === me.id ? `<button class="po-del" data-del-offer="${o.id}" title="remove">✕</button>` : ''}
    </div>`
  return `
    <div class="po-screen">
      <div class="po-sec-head"><h2>My Offerings</h2><button class="po-btn" data-modal="add-offer">+ Add</button></div>
      <div class="po-grid">${mine.length ? mine.map(card).join('') : '<div class="po-empty">No offerings yet — add a gift.</div>'}</div>
      <div class="po-sec-head"><h2>All Offerings</h2></div>
      <div class="po-grid">${all.length ? all.map(card).join('') : '<div class="po-empty">The pool is empty.</div>'}</div>
    </div>`
}

function wishScreen() {
  const me = activeUser()
  if (!me) return needUser()
  const order = ensureWish(me.id)
  if (order.length <= 1) return `<div class="po-screen"><h2>Wish</h2><div class="po-empty">No one else has offered anything yet.</div></div>`
  let rank = 0
  const rows = order.map(token => {
    if (token === CUT) return `<div class="po-cut"><span>won't trade ↓</span></div>`
    const o = offeringById(token)
    if (!o) return ''
    rank++
    return `
      <div class="po-wish" data-wid="${token}">
        <span class="po-rank">${rank}</span>
        ${thumb(o.pic)}
        <span class="po-wish-note">${esc(o.note) || '<em>untitled</em>'}<small>${esc(userById(o.ownerId)?.name)}</small></span>
        <span class="po-wish-ctrl">
          <button class="po-arrow" data-hold="up" data-wid="${token}">▲</button>
          <button class="po-arrow" data-hold="down" data-wid="${token}">▼</button>
        </span>
      </div>`
  }).join('')
  return `
    <div class="po-screen">
      <div class="po-sec-head"><h2>Wish</h2><span class="po-hint">rank what you want · tap ▲▼ to move · hold to send to top/bottom</span></div>
      <div class="po-wishlist">${rows}</div>
    </div>`
}

function matchScreen() {
  const me = activeUser()
  if (!me) return needUser()
  const { matching, lastMatch: lm } = $.learn()
  const runBar = `<button class="po-btn po-btn-go" data-match ${matching ? 'disabled' : ''}>${matching ? 'Matching…' : (lm ? 'Re-run Match' : 'Match')}</button>`
  if (!lm) return `<div class="po-screen"><div class="po-sec-head"><h2>Match</h2>${runBar}</div><div class="po-empty">Press <strong>Match</strong> to find who gives to whom.</div></div>`
  if (lm.error) return `<div class="po-screen"><div class="po-sec-head"><h2>Match</h2>${runBar}</div><div class="po-empty">Match failed: ${esc(lm.error)}</div></div>`
  const stale = lm.sig !== inputSignature()
  const edges = lm.edges || []
  const giveTo = edges.filter(e => offeringByUpper(e.givenItem)?.ownerId === me.id).map(e => ({ item: offeringByUpper(e.givenItem), to: userById(offeringByUpper(e.recvItem)?.ownerId) })).filter(x => x.item && x.to)
  const receiveFrom = edges.filter(e => offeringByUpper(e.recvItem)?.ownerId === me.id).map(e => ({ item: offeringByUpper(e.givenItem), from: userById(offeringByUpper(e.givenItem)?.ownerId) })).filter(x => x.item && x.from)
  const trades = edges.map(e => ({ giver: userById(offeringByUpper(e.givenItem)?.ownerId), item: offeringByUpper(e.givenItem), receiver: userById(offeringByUpper(e.recvItem)?.ownerId) })).filter(t => t.giver && t.item && t.receiver)
  const row = t => `<div class="po-match-row">${avatar(t.giver)}<b>${esc(t.giver.name)}</b> gives ${thumb(t.item.pic,'sm')}${esc(t.item.note)||'gift'} → ${avatar(t.receiver)}<b>${esc(t.receiver.name)}</b></div>`
  return `
    <div class="po-screen">
      <div class="po-sec-head"><h2>Match</h2>${runBar}</div>
      ${stale ? `<div class="po-stale">offerings or wishes changed since this run — results may be out of date.</div>` : ''}
      <div class="po-sub">last run ${esc(lm.at)} · ${trades.length} trade(s)</div>
      <h3>Give To</h3>
      <div class="po-matches">${giveTo.length ? giveTo.map(x => `<div class="po-match-row">${thumb(x.item.pic,'sm')}${esc(x.item.note)||'gift'} → ${avatar(x.to)}<b>${esc(x.to.name)}</b></div>`).join('') : '<div class="po-empty">None of your gifts found a home this run.</div>'}</div>
      <h3>Receive From</h3>
      <div class="po-matches">${receiveFrom.length ? receiveFrom.map(x => `<div class="po-match-row">${avatar(x.from)}<b>${esc(x.from.name)}</b> → ${thumb(x.item.pic,'sm')}${esc(x.item.note)||'gift'}</div>`).join('') : '<div class="po-empty">You receive nothing this run.</div>'}</div>
      <h3>All Matches</h3>
      <div class="po-allmatch">
        <div class="po-col"><h4>Gifts</h4>${trades.length ? trades.map(row).join('') : '<div class="po-empty">No trades.</div>'}</div>
        <div class="po-col"><h4>Receipts</h4>${trades.length ? trades.map(t => `<div class="po-match-row">${avatar(t.receiver)}<b>${esc(t.receiver.name)}</b> receives ${thumb(t.item.pic,'sm')}${esc(t.item.note)||'gift'} from ${esc(t.giver.name)}</div>`).join('') : '<div class="po-empty">No trades.</div>'}</div>
      </div>
    </div>`
}

function settingsScreen() {
  const u = activeUser()
  if (!u) return `<div class="po-screen"><h2>Settings</h2>${needUser()}</div>`
  return `
    <div class="po-screen po-profile">
      <div class="po-sec-head"><h2>Settings — ${esc(u.name)}</h2></div>
      <p class="po-hint">editing the active participant · click another participant in the sidebar to switch</p>
      <label class="po-pfield">${avatar(u, 'big')}<input type="file" accept="image/*" class="po-file" data-pic-for="${u.id}" /><span>change picture</span></label>
      <label class="po-pfield"><span>Name</span><input class="po-pinput" data-field="name" value="${esc(u.name)}" /></label>
      <label class="po-pfield"><span>Favorite color</span><input type="color" class="po-pcolor" data-field="color" value="${u.color || '#5b8def'}" /></label>
      <label class="po-pfield"><span>Bio</span><textarea class="po-pinput" data-field="bio" rows="4">${esc(u.bio)}</textarea></label>
      <div class="po-prow">
        <button class="po-btn po-btn-go" data-save-profile="${u.id}">Save</button>
        <button class="po-btn po-btn-danger" data-del-user="${u.id}">Delete participant</button>
      </div>
    </div>`
}

function modalView() {
  if ($.learn().modal !== 'add-offer') return ''
  return `
    <div class="po-modal-bg" data-close-modal>
      <div class="po-modal">
        <h3>Add an offering</h3>
        <label class="po-pfield">
          <span class="po-preview" id="po-add-preview">🎁</span>
          <input type="file" accept="image/*" class="po-file" data-pic-for="__draft__" />
          <span>choose a picture</span>
        </label>
        <textarea class="po-modal-note" id="po-add-note" rows="3" placeholder="a note about the gift…"></textarea>
        <div class="po-modal-actions">
          <button class="po-btn" data-close-modal>Cancel</button>
          <button class="po-btn po-btn-go" data-save-offer>Add</button>
        </div>
      </div>
    </div>`
}

function indexScreen() {
  return `
    <div class="po-screen po-index">
      <div class="po-sec-head"><h2>Potlucks</h2><button class="po-btn po-btn-go" data-new-potluck>+ New pot-luck</button></div>
      <div class="po-pl-list">
        ${registry.potlucks.length ? registry.potlucks.map(p => `
          <div class="po-pl-row">
            <button class="po-pl-open" data-open-potluck="${p.id}">
              <span class="po-pl-name">${esc(p.name)}</span>
              <span class="po-pl-id">${esc(String(p.id).slice(0, 8))}</span>
            </button>
            <button class="po-pl-edit" data-rename-potluck="${p.id}" title="rename">✎</button>
            <button class="po-pl-trash" data-del-potluck="${p.id}" title="delete">🗑</button>
          </div>`).join('') : '<div class="po-empty">No potlucks yet — make one.</div>'}
      </div>
      <div class="po-index-foot">
        <span class="po-related-label">Related Links</span>
        <a class="po-edit-link" href="/app/was-code?src=/public/elves/pot-luck.js" target="_blank">Edit Source</a>
        <a class="po-blog-link" href="/blog/the-table-that-finds-the-trades/" target="_blank">Blog: The Table That Finds the Trades</a>
      </div>
    </div>`
}

const SCREENS = { home: homeScreen, offer: offerScreen, wish: wishScreen, match: matchScreen, settings: settingsScreen }

// === styles ===
// $.style() injects a <style> tag scoped to this elf's tag name.
// & is replaced with the tag selector — no shadow DOM, no specificity games.

$.style(`
  & { display:block; height:100%; overflow:hidden; font-family:'Recursive',system-ui,sans-serif; color:#1a1a1a; background:#f3f1ea; }
  & button * { pointer-events:none; }
  & .po-shell { display:flex; flex-direction:column; height:100%; }
  & .po-topbar { display:flex; align-items:center; flex-wrap:wrap; gap:.5rem 1rem; padding:.5rem .9rem; background:#1a1a1a; color:#fff; }
  & .po-home-btn { background:none; border:none; color:#fff; font-weight:700; font-size:1.05rem; cursor:pointer; }
  & .po-nav { display:flex; flex-wrap:wrap; gap:.4rem; flex:1; }
  & .po-tab { background:rgba(255,255,255,.12); color:#fff; border:none; padding:.35rem .8rem; border-radius:.4rem; cursor:pointer; text-transform:capitalize; }
  & .po-tab.on { background:#5b8def; }
  & .po-active { display:flex; align-items:center; gap:.4rem; font-size:.85rem; opacity:.85; }
  & .po-live { font-size:.72rem; opacity:.6; }
  & .po-live.on { color:#46d369; opacity:1; }
  & .po-pl-title { background:rgba(255,255,255,.12); color:#fff; border:none; padding:.3rem .7rem; border-radius:.4rem; cursor:pointer; font-weight:600; }
  & .po-body { display:flex; flex:1; min-height:0; }
  & .po-sidebar { width:14rem; flex:0 0 14rem; background:#e7e3d8; border-right:1px solid #d3cdbd; padding:.7rem; display:flex; flex-direction:column; gap:.5rem; overflow-y:auto; }
  & .po-sidebar-label { font-size:.7rem; text-transform:uppercase; letter-spacing:.04em; opacity:.5; margin-top:.2rem; }
  & .po-userlist { display:flex; flex-direction:column; gap:.25rem; }
  & .po-userrow { display:flex; align-items:center; gap:.45rem; background:#fff; border:1px solid #d8d2c2; border-radius:.4rem; padding:.3rem .45rem; cursor:pointer; text-align:left; }
  & .po-userrow-name { flex:1; }
  & .po-userrow.on { border-color:#5b8def; box-shadow:0 0 0 1px #5b8def inset; }
  & .po-dot { font-size:.6rem; text-transform:uppercase; letter-spacing:.04em; color:#fff; background:#5b8def; border-radius:.25rem; padding:.1rem .35rem; }
  & .po-main { flex:1; min-width:0; overflow:auto; padding:1rem 1.2rem; }
  & .po-screen { display:flex; flex-direction:column; gap:.6rem; max-width:780px; }
  & .po-sec-head { display:flex; align-items:center; justify-content:space-between; gap:1rem; margin-top:.6rem; }
  & h1 { margin:.2rem 0; } & h2 { margin:.2rem 0; font-size:1.15rem; } & h3 { margin:.7rem 0 .1rem; } & h4 { margin:.2rem 0; opacity:.7; }
  & .po-hint, & .po-sub { font-size:.78rem; opacity:.6; }
  & .po-btn { background:#1a1a1a; color:#fff; border:none; border-radius:.4rem; padding:.4rem .8rem; cursor:pointer; }
  & .po-btn-go { background:#2e9e5b; } & .po-btn[disabled] { opacity:.5; cursor:default; }
  & .po-btn-danger { background:#b4452e; }
  & .po-prow { display:flex; gap:.5rem; flex-wrap:wrap; margin-top:.5rem; }
  & .po-new { background:#5b8def; }
  & .po-empty { opacity:.55; padding:.6rem 0; font-size:.9rem; }
  & .po-home { display:flex; flex-direction:column; gap:1.2rem; align-items:center; padding-top:1.5rem; }
  & .po-hero { text-align:center; } & .po-hero p { opacity:.65; max-width:34rem; }
  & .po-cards { display:flex; gap:1rem; flex-wrap:wrap; justify-content:center; }
  & .po-card { width:13rem; min-height:8rem; background:#fff; border:1px solid #d8d2c2; border-radius:.7rem; padding:1rem; display:flex; flex-direction:column; gap:.5rem; cursor:pointer; text-align:left; }
  & .po-card:hover { border-color:#5b8def; transform:translateY(-2px); transition:.12s; }
  & .po-card-title { font-size:1.1rem; font-weight:700; } & .po-card-desc { opacity:.7; font-size:.9rem; }
  & .po-grid { display:grid; grid-template-columns:repeat(auto-fill,minmax(11rem,1fr)); gap:.6rem; }
  & .po-offer { position:relative; background:#fff; border:1px solid #d8d2c2; border-radius:.5rem; padding:.5rem; display:flex; flex-direction:column; gap:.35rem; }
  & .po-offer-note { font-size:.9rem; } & .po-offer-owner { display:flex; align-items:center; gap:.3rem; font-size:.75rem; opacity:.7; }
  & .po-del { position:absolute; top:.3rem; right:.3rem; background:rgba(0,0,0,.55); color:#fff; border:none; border-radius:50%; width:1.3rem; height:1.3rem; cursor:pointer; }
  & .po-thumb { display:block; width:100%; height:6rem; border-radius:.35rem; background:#eee center/cover no-repeat; }
  & .po-thumb.sm { width:2.2rem; height:2.2rem; display:inline-block; vertical-align:middle; }
  & .po-thumb-empty { display:flex; align-items:center; justify-content:center; font-size:1.6rem; }
  & .po-avatar { display:inline-block; width:1.5rem; height:1.5rem; border-radius:50%; background:#ccc center/cover no-repeat; vertical-align:middle; }
  & .po-avatar.big { width:4rem; height:4rem; }
  & .po-avatar-empty { display:inline-flex; align-items:center; justify-content:center; color:#fff; font-weight:700; text-transform:uppercase; }
  & .po-wishlist { display:flex; flex-direction:column; gap:.3rem; }
  & .po-wish { display:flex; align-items:center; gap:.5rem; background:#fff; border:1px solid #d8d2c2; border-radius:.45rem; padding:.3rem .5rem; }
  & .po-rank { width:1.3rem; text-align:center; font-weight:700; opacity:.5; }
  & .po-wish .po-thumb { width:2.6rem; height:2.6rem; flex:0 0 auto; }
  & .po-wish-note { flex:1; display:flex; flex-direction:column; font-size:.9rem; } & .po-wish-note small { opacity:.55; font-size:.72rem; }
  & .po-wish-ctrl { display:flex; gap:.2rem; }
  & .po-arrow { background:#eee; border:1px solid #ccc; border-radius:.3rem; width:2rem; height:2rem; cursor:pointer; font-size:.8rem; touch-action:none; user-select:none; }
  & .po-cut { display:flex; align-items:center; margin:.3rem 0; color:#b4452e; font-size:.78rem; text-transform:uppercase; letter-spacing:.05em; }
  & .po-cut span { background:#f3f1ea; padding-right:.6rem; } & .po-cut:after { content:''; flex:1; border-top:2px dashed #c98; }
  & .po-matches, & .po-col { display:flex; flex-direction:column; gap:.3rem; }
  & .po-match-row { display:flex; align-items:center; gap:.35rem; background:#fff; border:1px solid #e0dac9; border-radius:.4rem; padding:.3rem .5rem; font-size:.88rem; }
  & .po-allmatch { display:flex; gap:1rem; flex-wrap:wrap; } & .po-allmatch .po-col { flex:1; min-width:14rem; }
  & .po-stale { background:#fff3cd; border:1px solid #e6d39a; border-radius:.4rem; padding:.4rem .6rem; font-size:.82rem; }
  & .po-profile { max-width:30rem; } & .po-pfield { display:flex; flex-direction:column; gap:.25rem; margin:.4rem 0; }
  & .po-pfield input[type=file] { font-size:.8rem; } & .po-pinput { padding:.4rem; border:1px solid #c9c2af; border-radius:.35rem; font:inherit; }
  & .po-preview { display:inline-flex; align-items:center; justify-content:center; width:4rem; height:4rem; border-radius:.4rem; background:#eee center/cover no-repeat; font-size:1.6rem; }
  & .po-modal-bg { position:absolute; inset:0; background:rgba(0,0,0,.45); display:flex; align-items:center; justify-content:center; z-index:50; }
  & .po-modal { background:#fff; border-radius:.6rem; padding:1rem; width:min(92%,22rem); display:flex; flex-direction:column; gap:.6rem; }
  & .po-modal-note { padding:.4rem; border:1px solid #c9c2af; border-radius:.35rem; font:inherit; }
  & .po-modal-actions { display:flex; justify-content:flex-end; gap:.5rem; }
  & .po-pl-list { display:flex; flex-direction:column; gap:.4rem; max-width:520px; }
  & .po-pl-row { display:flex; gap:.4rem; align-items:stretch; }
  & .po-pl-open { flex:1; display:flex; align-items:center; justify-content:space-between; gap:.6rem; background:#fff; border:1px solid #d8d2c2; border-radius:.5rem; padding:.6rem .8rem; cursor:pointer; text-align:left; }
  & .po-pl-open:hover { border-color:#5b8def; }
  & .po-pl-name { font-weight:600; } & .po-pl-id { font-family:ui-monospace,monospace; font-size:.72rem; opacity:.45; }
  & .po-pl-edit { background:#fff; border:1px solid #d8d2c2; border-radius:.5rem; padding:0 .7rem; cursor:pointer; font-size:1rem; }
  & .po-pl-edit:hover { border-color:#5b8def; }
  & .po-pl-trash { background:#fff; border:1px solid #e0c3bd; border-radius:.5rem; padding:0 .7rem; cursor:pointer; font-size:1rem; }
  & .po-pl-trash:hover { background:#fbeae6; border-color:#b4452e; }
  & .po-index-foot { display:flex; flex-direction:column; gap:.35rem; margin-top:1.5rem; max-width:520px; }
  & .po-related-label { font-size:.75rem; text-transform:uppercase; letter-spacing:.07em; opacity:.5; }
  & .po-edit-link, & .po-blog-link { color:#5b8def; text-decoration:none; font-size:.9rem; }
  & .po-edit-link:hover, & .po-blog-link:hover { text-decoration:underline; }
`)
