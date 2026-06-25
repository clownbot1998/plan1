import Self from '@plan98/elf'
import Cache from '@silly/cache'

// pot-luck — a local "swap for good" gift trade.
// my-computer-style shell: top bar (Offer/Wish/Match), sidebar (new user /
// picker / list), homepage sections. 100% local: all state in IndexedDB via
// cache.js. The Match screen assembles a TradeMaximizer wants-file from
// offerings + per-participant wishes, runs the ported web worker, and shows
// who you give to / receive from.

const tag = 'pot-luck'
const cache = Cache(tag)

const CUT = '__cut__' // the "won't trade" divider token in a wish list

// worker message constants (mirror trade-maximizer/trademax-util.js)
const RUN = 1, OUTPUT = 10, PROGRESS = 11, ERROR = 12, DONE = 13

// --- local store: one IndexedDB record per potluck, keyed by its id.
// cache 'index' holds the registry of all potlucks; each potluck id holds its
// own isolated data. ?id selects the row — 'index' (or none) shows the list.
const newDb = () => ({ seq: 1, users: [], offerings: [], wishes: {}, activeUserId: null, lastMatch: null })

let currentId = new URLSearchParams(location.search).get('id') || 'index'
let registry = { potlucks: [] }   // cache key 'index'
let db = newDb()                  // current potluck (idle while on the index)

const $ = Self(tag, { screen: 'home', modal: null, matching: false, rev: 0, loading: true })

function redraw() { $.teach({ rev: $.learn().rev + 1 }) }
function persist() { if (currentId !== 'index') cache.put(currentId, db); redraw() }
function persistRegistry() { cache.put('index', registry); redraw() }

async function loadPotluck(id) {
  const r = await cache.get(id)
  db = r && r.data ? { ...newDb(), ...r.data } : newDb()
  if (!db.activeUserId && db.users.length) db.activeUserId = db.users[0].id
}

;(async function boot() {
  const r = await cache.get('index')
  if (r && r.data) registry = r.data
  if (currentId !== 'index') {
    // deep-link / refresh on a potluck id we don't know yet — register it
    if (!registry.potlucks.find(p => p.id === currentId)) {
      registry.potlucks.push({ id: currentId, name: 'Potluck ' + (registry.potlucks.length + 1), created: Date.now() })
      cache.put('index', registry)
    }
    await loadPotluck(currentId)
  }
  $.teach({ loading: false, rev: $.learn().rev + 1 })
})()

// --- navigation: in-page ?id switch (mirrors accessibility-mode switchSession) ---
async function openPotluck(id) {
  currentId = id
  history.replaceState(null, '', `?id=${id}`)
  await loadPotluck(id)
  $.teach({ screen: 'home', modal: null, rev: $.learn().rev + 1 })
}
function gotoIndex() {
  currentId = 'index'
  history.replaceState(null, '', `?id=index`)
  $.teach({ screen: 'home', modal: null, rev: $.learn().rev + 1 })
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

function nextId(prefix) { return prefix + (db.seq++) }
function userById(id) { return db.users.find(u => u.id === id) || null }
function activeUser() { return userById(db.activeUserId) }
function offeringById(id) { return db.offerings.find(o => o.id === id) || null }

// --- wish list maintenance ---
// each user's wish is an ordered list of offering ids (not their own) plus the
// CUT divider. Items before CUT are wanted (ranked); after CUT are won't-trade.
function ensureWish(userId) {
  const pool = db.offerings.filter(o => o.ownerId !== userId).map(o => o.id)
  let order = db.wishes[userId] || []
  // drop tokens for offerings that no longer exist (keep CUT)
  order = order.filter(t => t === CUT || pool.includes(t))
  if (!order.includes(CUT)) order.push(CUT)
  // insert any new offerings just above the divider (wanted, lowest priority)
  const present = new Set(order)
  const cutAt = order.indexOf(CUT)
  const fresh = pool.filter(id => !present.has(id))
  order.splice(cutAt, 0, ...fresh)
  db.wishes[userId] = order
  return order
}

function wantedIds(userId) {
  const order = ensureWish(userId)
  const cut = order.indexOf(CUT)
  return order.slice(0, cut).filter(t => t !== CUT)
}

// --- TradeMaximizer wants-file ---
function buildWants() {
  const lines = ['#! REQUIRE-USERNAMES', '#! HIDE-NONTRADES', '', '!BEGIN-OFFICIAL-NAMES']
  for (const o of db.offerings) {
    const desc = String(o.note || 'gift').replace(/["\n\r]/g, ' ').slice(0, 80)
    lines.push(`${o.id} ==> "${desc}" (from ${o.ownerId})`)
  }
  lines.push('!END-OFFICIAL-NAMES', '')
  for (const u of db.users) {
    const wants = wantedIds(u.id)
    if (!wants.length) continue
    for (const o of db.offerings.filter(o => o.ownerId === u.id)) {
      lines.push(`(${u.id}) ${o.id} : ${wants.join(' ')}`)
    }
  }
  return lines.join('\n')
}

function inputSignature() {
  return JSON.stringify({
    o: db.offerings.map(o => [o.id, o.ownerId, o.note]),
    w: db.users.map(u => wantedIds(u.id)),
  })
}

// --- run the match ---
// The page is cross-origin isolated (COEP: credentialless). A dedicated worker
// created directly from a same-origin .js URL fails there unless that script is
// served with COEP headers (plan1 only sets them on HTML pages). A blob worker
// inherits the document's COEP, so we bootstrap it with importScripts of the
// real engine — same effect, no server/header changes needed.
function spawnTradeWorker() {
  const abs = self.location.origin + '/elves/trade-maximizer/trademax-worker.js'
  const url = URL.createObjectURL(new Blob([`importScripts(${JSON.stringify(abs)});`], { type: 'text/javascript' }))
  const w = new Worker(url)
  setTimeout(() => URL.revokeObjectURL(url), 0) // worker keeps running after revoke
  return w
}

function runMatch() {
  if (db.offerings.length < 2) { $.teach({ matching: false }); return }
  $.teach({ matching: true })
  const input = buildWants()
  let out = ''
  let worker
  try {
    worker = spawnTradeWorker()
  } catch (e) {
    db.lastMatch = { edges: [], at: nowStamp(), sig: inputSignature(), error: String(e) }
    persist(); $.teach({ matching: false }); return
  }
  worker.onmessage = (e) => {
    const [t, a, nl] = e.data
    if (t === OUTPUT) out += a + (nl ? '\n' : '')
    else if (t === ERROR) out += '\n[error] ' + a + '\n'
    else if (t === DONE) {
      worker.terminate()
      db.lastMatch = { edges: parseLoops(out), at: nowStamp(), sig: inputSignature(), raw: out }
      persist()
      $.teach({ matching: false })
    }
  }
  worker.onerror = (err) => {
    worker.terminate()
    const detail = (err.message || '') + (err.filename ? ` @ ${err.filename}:${err.lineno}` : '')
    db.lastMatch = { edges: [], at: nowStamp(), sig: inputSignature(), error: detail.trim() || 'worker error (check console)' }
    persist(); $.teach({ matching: false })
  }
  worker.postMessage([RUN, input])
}

function nowStamp() { return new Date().toLocaleString() }

// parse "TRADE LOOPS" lines: "(USER) ITEMID receives (USER2) ITEMID2"
// edge {recvItem, givenItem}: owner(recvItem) receives item givenItem.
// item ids are uppercased by the engine — we key lookups uppercased too.
function parseLoops(out) {
  const edges = []
  let inLoops = false
  for (const line of out.split('\n')) {
    if (/^TRADE LOOPS/.test(line)) { inLoops = true; continue }
    if (!inLoops) continue
    if (/^ITEM SUMMARY/.test(line) || /^Num trades/.test(line)) break
    const m = line.match(/^\(([^)]+)\)\s+(\S+)\s+receives\s+\(([^)]+)\)\s+(\S+)\s*$/)
    if (m) edges.push({ recvItem: m[2].toUpperCase(), givenItem: m[4].toUpperCase() })
  }
  return edges
}

function offeringByUpper(id) {
  return db.offerings.find(o => o.id.toUpperCase() === id) || null
}

// ============================ rendering ============================

function thumb(pic, cls = '') {
  return pic
    ? `<span class="po-thumb ${cls}" style="background-image:url(${pic})"></span>`
    : `<span class="po-thumb po-thumb-empty ${cls}">🎁</span>`
}

function avatar(user, cls = '') {
  if (!user) return ''
  return user.pic
    ? `<span class="po-avatar ${cls}" style="background-image:url(${user.pic})"></span>`
    : `<span class="po-avatar po-avatar-empty ${cls}" style="background:${user.color || '#888'}">${(user.name || '?')[0]}</span>`
}

function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])) }

function homeScreen() {
  const cards = [
    ['offer', '🎁 Offer', 'Share a gift that you\'re willing to trade'],
    ['wish', '⭐ Wish', 'For items in the potluck offering pool'],
    ['match', '🔀 Match', 'With who you will give to and who you will receive from'],
  ]
  return `
    <div class="po-home">
      <div class="po-hero">
        <h1>pot-luck</h1>
        <p>a swap for good — bring a gift, wish for others', let the table find the trades.</p>
      </div>
      <div class="po-cards">
        ${cards.map(([s, t, d]) => `
          <button class="po-card" data-screen="${s}">
            <span class="po-card-title">${t}</span>
            <span class="po-card-desc">${d}</span>
          </button>`).join('')}
      </div>
    </div>`
}

function needUser() {
  return `<div class="po-empty">Pick or create a participant in the sidebar to begin.</div>`
}

function offerScreen() {
  const me = activeUser()
  if (!me) return needUser()
  const mine = db.offerings.filter(o => o.ownerId === me.id)
  const others = db.offerings.filter(o => o.ownerId !== me.id)
  const all = [...mine, ...others]

  const card = (o) => `
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
    if (token === CUT) {
      return `<div class="po-cut"><span>won't trade ↓</span></div>`
    }
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
      <div class="po-sec-head"><h2>Wish</h2><span class="po-hint">rank what you want · tap ▲▼ to move · hold to send to top/bottom · drag below the line to refuse</span></div>
      <div class="po-wishlist">${rows}</div>
    </div>`
}

function matchScreen() {
  const me = activeUser()
  if (!me) return needUser()
  const matching = $.learn().matching
  const lm = db.lastMatch

  const runBar = `<button class="po-btn po-btn-go" data-match ${matching ? 'disabled' : ''}>${matching ? 'Matching…' : (lm ? 'Re-run Match' : 'Match')}</button>`

  if (!lm) {
    return `
      <div class="po-screen">
        <div class="po-sec-head"><h2>Match</h2>${runBar}</div>
        <div class="po-empty">Press <strong>Match</strong> to find who gives to whom.</div>
      </div>`
  }
  if (lm.error) {
    return `<div class="po-screen"><div class="po-sec-head"><h2>Match</h2>${runBar}</div><div class="po-empty">Match failed: ${esc(lm.error)}</div></div>`
  }

  const stale = lm.sig !== inputSignature()
  const edges = lm.edges || []
  const giveTo = edges.filter(e => offeringByUpper(e.givenItem)?.ownerId === me.id)
    .map(e => ({ item: offeringByUpper(e.givenItem), to: userById(offeringByUpper(e.recvItem)?.ownerId) }))
    .filter(x => x.item && x.to)
  const receiveFrom = edges.filter(e => offeringByUpper(e.recvItem)?.ownerId === me.id)
    .map(e => ({ item: offeringByUpper(e.givenItem), from: userById(offeringByUpper(e.givenItem)?.ownerId) }))
    .filter(x => x.item && x.from)
  const trades = edges.map(e => ({
    giver: userById(offeringByUpper(e.givenItem)?.ownerId),
    item: offeringByUpper(e.givenItem),
    receiver: userById(offeringByUpper(e.recvItem)?.ownerId),
  })).filter(t => t.giver && t.item && t.receiver)

  const giftRow = (t) => `<div class="po-match-row">${avatar(t.giver)}<b>${esc(t.giver.name)}</b> gives ${thumb(t.item.pic, 'sm')}${esc(t.item.note) || 'gift'} → ${avatar(t.receiver)}<b>${esc(t.receiver.name)}</b></div>`

  return `
    <div class="po-screen">
      <div class="po-sec-head"><h2>Match</h2>${runBar}</div>
      ${stale ? `<div class="po-stale">offerings or wishes changed since this run — results may be out of date.</div>` : ''}
      <div class="po-sub">last run ${esc(lm.at)} · ${trades.length} trade(s)</div>

      <h3>Give To</h3>
      <div class="po-matches">${giveTo.length ? giveTo.map(x => `<div class="po-match-row">${thumb(x.item.pic, 'sm')}${esc(x.item.note) || 'gift'} → ${avatar(x.to)}<b>${esc(x.to.name)}</b></div>`).join('') : '<div class="po-empty">None of your gifts found a home this run.</div>'}</div>

      <h3>Receive From</h3>
      <div class="po-matches">${receiveFrom.length ? receiveFrom.map(x => `<div class="po-match-row">${avatar(x.from)}<b>${esc(x.from.name)}</b> → ${thumb(x.item.pic, 'sm')}${esc(x.item.note) || 'gift'}</div>`).join('') : '<div class="po-empty">You receive nothing this run.</div>'}</div>

      <h3>All Matches</h3>
      <div class="po-allmatch">
        <div class="po-col"><h4>Gifts</h4>${trades.length ? trades.map(giftRow).join('') : '<div class="po-empty">No trades.</div>'}</div>
        <div class="po-col"><h4>Receipts</h4>${trades.length ? trades.map(t => `<div class="po-match-row">${avatar(t.receiver)}<b>${esc(t.receiver.name)}</b> receives ${thumb(t.item.pic, 'sm')}${esc(t.item.note) || 'gift'} from ${esc(t.giver.name)}</div>`).join('') : '<div class="po-empty">No trades.</div>'}</div>
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
      <label class="po-pfield">
        ${avatar(u, 'big')}
        <input type="file" accept="image/*" class="po-file" data-pic-for="${u.id}" />
        <span>change picture</span>
      </label>
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
  const list = registry.potlucks
  return `
    <div class="po-screen po-index">
      <div class="po-sec-head"><h2>Potlucks</h2><button class="po-btn po-btn-go" data-new-potluck>+ New pot-luck</button></div>
      <div class="po-pl-list">
        ${list.length ? list.map(p => `
          <div class="po-pl-row">
            <button class="po-pl-open" data-open-potluck="${p.id}">
              <span class="po-pl-name">${esc(p.name)}</span>
              <span class="po-pl-id">${esc(String(p.id).slice(0, 8))}</span>
            </button>
            <button class="po-pl-edit" data-rename-potluck="${p.id}" title="rename potluck">✎</button>
            <button class="po-pl-trash" data-del-potluck="${p.id}" title="delete potluck">🗑</button>
          </div>`).join('') : '<div class="po-empty">No potlucks yet — make one.</div>'}
      </div>
      <div class="po-index-foot">
        <a class="po-blog-link" href="/blog/the-table-that-finds-the-trades/" target="_blank">📖 how pot-luck works →</a>
      </div>
    </div>`
}

const SCREENS = { home: homeScreen, offer: offerScreen, wish: wishScreen, match: matchScreen, settings: settingsScreen }

$.draw(() => {
  if ($.learn().loading) return `<div class="po-shell"><main class="po-main"><div class="po-empty" style="padding:2rem">loading…</div></main></div>`

  if (currentId === 'index') {
    return `
      <div class="po-shell">
        <div class="po-topbar"><span class="po-home-btn">pot-luck</span></div>
        <div class="po-body"><main class="po-main">${indexScreen()}</main></div>
      </div>`
  }

  const { screen } = $.learn()
  const me = activeUser()
  const nav = ['offer', 'wish', 'match', 'settings']
  const pl = registry.potlucks.find(p => p.id === currentId)
  return `
    <div class="po-shell">
      <div class="po-topbar">
        <button class="po-home-btn" data-goto-index>↤ Potlucks</button>
        <button class="po-pl-title" data-screen="home">${esc(pl ? pl.name : 'Potluck')}</button>
        <nav class="po-nav">
          ${nav.map(s => `<button class="po-tab ${screen === s ? 'on' : ''}" data-screen="${s}">${s[0].toUpperCase() + s.slice(1)}</button>`).join('')}
        </nav>
        <span class="po-active">${me ? `${avatar(me)} ${esc(me.name)}` : 'no participant'}</span>
      </div>
      <div class="po-body">
        <aside class="po-sidebar">
          <button class="po-btn po-new" data-new-user>+ New user</button>
          <div class="po-sidebar-label">participants — click to make active</div>
          <div class="po-userlist">
            ${db.users.map(u => `<button class="po-userrow ${u.id === db.activeUserId ? 'on' : ''}" data-set-active="${u.id}">${avatar(u)} <span class="po-userrow-name">${esc(u.name)}</span>${u.id === db.activeUserId ? '<span class="po-dot">active</span>' : ''}</button>`).join('') || '<div class="po-empty">no participants</div>'}
          </div>
        </aside>
        <main class="po-main">${(SCREENS[screen] || homeScreen)()}</main>
      </div>
      ${modalView()}
    </div>`
})

// ============================ events ============================

$.when('click', '[data-screen]', (e) => $.teach({ screen: e.target.closest('[data-screen]').dataset.screen }))

// potluck index navigation
$.when('click', '[data-goto-index]', () => gotoIndex())
$.when('click', '[data-new-potluck]', () => newPotluck())
$.when('click', '[data-open-potluck]', (e) => openPotluck(e.target.closest('[data-open-potluck]').dataset.openPotluck))
$.when('click', '[data-rename-potluck]', (e) => {
  const p = registry.potlucks.find(x => x.id === e.target.closest('[data-rename-potluck]').dataset.renamePotluck)
  if (!p) return
  const name = prompt('Rename potluck', p.name)
  if (name == null) return
  p.name = name.trim() || p.name
  persistRegistry()
})
$.when('click', '[data-del-potluck]', (e) => deletePotluck(e.target.closest('[data-del-potluck]').dataset.delPotluck))

$.when('click', '[data-new-user]', () => {
  const id = nextId('u_')
  const n = db.users.length + 1
  db.users.push({ id, name: 'Guest ' + n, color: '#5b8def', bio: '', pic: '' })
  db.activeUserId = id
  persist()
  $.teach({ screen: 'settings' })
})

// clicking a participant makes them the active user
$.when('click', '[data-set-active]', (e) => {
  db.activeUserId = e.target.closest('[data-set-active]').dataset.setActive
  persist()
})

// delete a participant + cascade: their offerings and any wish-list references
$.when('click', '[data-del-user]', (e) => {
  const id = e.target.closest('[data-del-user]').dataset.delUser
  const u = userById(id)
  if (!u) return
  if (!confirm(`Delete ${u.name} and their offerings? This can't be undone.`)) return
  const ownedIds = db.offerings.filter(o => o.ownerId === id).map(o => o.id)
  db.users = db.users.filter(x => x.id !== id)
  db.offerings = db.offerings.filter(o => o.ownerId !== id)
  delete db.wishes[id]
  for (const uid of Object.keys(db.wishes)) db.wishes[uid] = db.wishes[uid].filter(t => !ownedIds.includes(t))
  if (db.activeUserId === id) db.activeUserId = db.users[0]?.id || null
  persist()
  $.teach({ screen: db.users.length ? 'settings' : 'home' })
})

// profile picture / draft picture upload
$.when('change', '.po-file', (e) => {
  const input = e.target
  const file = input.files && input.files[0]
  if (!file) return
  const reader = new FileReader()
  reader.onload = () => {
    const dataUrl = reader.result
    const forId = input.dataset.picFor
    if (forId === '__draft__') {
      draft.pic = dataUrl
      const prev = input.closest('.po-modal')?.querySelector('#po-add-preview')
      if (prev) { prev.style.backgroundImage = `url(${dataUrl})`; prev.textContent = ''; prev.classList.add('has-pic') }
    } else {
      const u = userById(forId)
      if (u) { u.pic = dataUrl; persist() }
    }
  }
  reader.readAsDataURL(file)
})

$.when('click', '[data-save-profile]', (e) => {
  const u = userById(e.target.closest('[data-save-profile]').dataset.saveProfile)
  if (!u) return
  const root = e.target.closest('.po-profile')
  root.querySelectorAll('[data-field]').forEach(el => { u[el.dataset.field] = el.value })
  persist()
})

// add-offer modal
let draft = { pic: '' }
$.when('click', '[data-modal]', (e) => { draft = { pic: '' }; $.teach({ modal: e.target.closest('[data-modal]').dataset.modal }) })
$.when('click', '[data-close-modal]', (e) => { if (e.target.matches('[data-close-modal]')) $.teach({ modal: null }) })
$.when('click', '[data-save-offer]', (e) => {
  const me = activeUser()
  if (!me) return
  const note = e.target.closest('.po-modal')?.querySelector('#po-add-note')?.value || ''
  db.offerings.push({ id: nextId('o_'), ownerId: me.id, note: note.trim(), pic: draft.pic || '' })
  draft = { pic: '' }
  persist()
  $.teach({ modal: null })
})

$.when('click', '[data-del-offer]', (e) => {
  const id = e.target.closest('[data-del-offer]').dataset.delOffer
  db.offerings = db.offerings.filter(o => o.id !== id)
  for (const uid of Object.keys(db.wishes)) db.wishes[uid] = db.wishes[uid].filter(t => t !== id)
  persist()
})

// run match
$.when('click', '[data-match]', () => runMatch())

// --- wish list reorder: tap = step, hold = send to top/bottom ---
function moveWish(userId, token, kind) {
  const order = ensureWish(userId)
  const i = order.indexOf(token)
  if (i === -1) return
  order.splice(i, 1)
  if (kind === 'up') order.splice(Math.max(0, i - 1), 0, token)
  else if (kind === 'down') order.splice(Math.min(order.length, i + 1), 0, token)
  else if (kind === 'top') order.unshift(token)
  else if (kind === 'bottom') order.push(token)
  db.wishes[userId] = order
  persist()
}

let hold = null
$.when('pointerdown', '[data-hold]', (e) => {
  const btn = e.target.closest('[data-hold]')
  const token = btn.dataset.wid
  const dir = btn.dataset.hold
  hold = { token, dir, fired: false }
  hold.timer = setTimeout(() => {
    if (!hold) return
    hold.fired = true
    moveWish(db.activeUserId, token, dir === 'up' ? 'top' : 'bottom')
  }, 500)
})
function endHold(commitStep) {
  if (!hold) return
  clearTimeout(hold.timer)
  if (commitStep && !hold.fired) moveWish(db.activeUserId, hold.token, hold.dir)
  hold = null
}
$.when('pointerup', '[data-hold]', () => endHold(true))
$.when('pointerleave', '[data-hold]', () => endHold(false))
$.when('pointercancel', '[data-hold]', () => endHold(false))

$.style(`
  & { display:block; height:100%; overflow:hidden; font-family:'Recursive',system-ui,sans-serif; color:#1a1a1a; background:#f3f1ea; }
  & button * { pointer-events:none; } /* clicks land on the button, not its children ($.when matches the exact target) */
  & .po-shell { display:flex; flex-direction:column; height:100%; }
  & .po-topbar { display:flex; align-items:center; flex-wrap:wrap; gap:.5rem 1rem; padding:.5rem .9rem; background:#1a1a1a; color:#fff; }
  & .po-home-btn { background:none; border:none; color:#fff; font-weight:700; font-size:1.05rem; cursor:pointer; }
  & .po-nav { display:flex; flex-wrap:wrap; gap:.4rem; flex:1; }
  & .po-tab { background:rgba(255,255,255,.12); color:#fff; border:none; padding:.35rem .8rem; border-radius:.4rem; cursor:pointer; text-transform:capitalize; }
  & .po-tab.on { background:#5b8def; }
  & .po-active { display:flex; align-items:center; gap:.4rem; font-size:.85rem; opacity:.85; }
  & .po-pl-title { background:rgba(255,255,255,.12); color:#fff; border:none; padding:.3rem .7rem; border-radius:.4rem; cursor:pointer; font-weight:600; }
  & .po-pl-list { display:flex; flex-direction:column; gap:.4rem; max-width:520px; }
  & .po-pl-row { display:flex; gap:.4rem; align-items:stretch; }
  & .po-pl-open { flex:1; display:flex; align-items:center; justify-content:space-between; gap:.6rem; background:#fff; border:1px solid #d8d2c2; border-radius:.5rem; padding:.6rem .8rem; cursor:pointer; text-align:left; }
  & .po-pl-open:hover { border-color:#5b8def; }
  & .po-pl-name { font-weight:600; }
  & .po-pl-id { font-family:ui-monospace,monospace; font-size:.72rem; opacity:.45; }
  & .po-pl-edit { background:#fff; border:1px solid #d8d2c2; border-radius:.5rem; padding:0 .7rem; cursor:pointer; font-size:1rem; }
  & .po-pl-edit:hover { border-color:#5b8def; }
  & .po-pl-trash { background:#fff; border:1px solid #e0c3bd; border-radius:.5rem; padding:0 .7rem; cursor:pointer; font-size:1rem; }
  & .po-pl-trash:hover { background:#fbeae6; border-color:#b4452e; }
  & .po-index-foot { margin-top:1rem; max-width:520px; }
  & .po-blog-link { color:#5b8def; text-decoration:none; font-size:.9rem; }
  & .po-blog-link:hover { text-decoration:underline; }
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
  & .po-btn-go { background:#2e9e5b; } & .po-btn[disabled]{ opacity:.5; cursor:default; }
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
  & .po-badge { background:#2e9e5b; color:#fff; border-radius:.3rem; padding:.15rem .5rem; font-size:.75rem; }
  & .po-profile { max-width:30rem; } & .po-pfield { display:flex; flex-direction:column; gap:.25rem; margin:.4rem 0; }
  & .po-pfield input[type=file] { font-size:.8rem; } & .po-pinput { padding:.4rem; border:1px solid #c9c2af; border-radius:.35rem; font:inherit; }
  & .po-preview { display:inline-flex; align-items:center; justify-content:center; width:4rem; height:4rem; border-radius:.4rem; background:#eee center/cover no-repeat; font-size:1.6rem; }
  & .po-modal-bg { position:absolute; inset:0; background:rgba(0,0,0,.45); display:flex; align-items:center; justify-content:center; z-index:50; }
  & .po-modal { background:#fff; border-radius:.6rem; padding:1rem; width:min(92%,22rem); display:flex; flex-direction:column; gap:.6rem; }
  & .po-modal-note { padding:.4rem; border:1px solid #c9c2af; border-radius:.35rem; font:inherit; }
  & .po-modal-actions { display:flex; justify-content:flex-end; gap:.5rem; }
`)
