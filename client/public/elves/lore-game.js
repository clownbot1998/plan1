// lore-game.js — pot-luck's architecture, aimed at a tabletop instead of a table.
//
// single-file app: one tag, one store, one module — same shape as pot-luck.js.
// two roles share one instance (?id=): the Oracle (DM) sees every player and
// browses a local PF2e SRD reference (locations/monsters/items) with quick
// accordions, revealing entries to the table on demand. Players see their own
// character sheet plus the shared feed of what's been revealed — nothing else
// from the reference data leaks to them ahead of a reveal.
//
// === imports ===
// Self gives us the elf lifecycle: draw, teach, whisper, when, style, learn.
// linkState joins a geckos WebRTC room so the store syncs across devices.
// broadcastElf pushes a delta to every peer in the room.
// channel is the live geckos connection object (null until connected).
// Cache wraps IndexedDB — one record per lore-game, keyed by its ?id.

import Self, { linkState, broadcastElf, channel } from '@plan98/elf'
import Cache from '@silly/cache'

const tag = 'lore-game'
const cache = Cache(tag)

// character sheet field data — lifted straight from ~/.plan98's path-finder.js
// (a standalone PF2e character sheet elf), not reinvented. ANCESTRIES/CLASSES
// were already borrowed for the datalist suggestions; the ability scores,
// full 17-skill list (each tied to the ability that modifies it), and the
// ethics/morals alignment pair were the rest of that sheet and got dropped
// in the first pass — restoring them here, same shape, same labels.
const ABILITIES = ['STR', 'DEX', 'CON', 'INT', 'WIS', 'CHA']
const SKILLS = [
  { name: 'acrobatics',   label: 'Acrobatics',   mod: 'DEX' },
  { name: 'arcana',       label: 'Arcana',       mod: 'INT' },
  { name: 'athletics',    label: 'Athletics',    mod: 'STR' },
  { name: 'crafting',     label: 'Crafting',     mod: 'INT' },
  { name: 'deception',    label: 'Deception',    mod: 'CHA' },
  { name: 'diplomacy',    label: 'Diplomacy',    mod: 'CHA' },
  { name: 'intimidation', label: 'Intimidation', mod: 'CHA' },
  { name: 'lore',         label: 'Lore',         mod: 'INT' },
  { name: 'medicine',     label: 'Medicine',     mod: 'WIS' },
  { name: 'nature',       label: 'Nature',       mod: 'WIS' },
  { name: 'occultism',    label: 'Occultism',    mod: 'INT' },
  { name: 'performance',  label: 'Performance',  mod: 'CHA' },
  { name: 'religion',     label: 'Religion',     mod: 'WIS' },
  { name: 'society',      label: 'Society',      mod: 'INT' },
  { name: 'stealth',      label: 'Stealth',      mod: 'DEX' },
  { name: 'survival',     label: 'Survival',     mod: 'WIS' },
  { name: 'thievery',     label: 'Thievery',     mod: 'DEX' },
]
const ETHICS = ['Lawful', 'Neutral', 'Chaotic']
const MORALS = ['Good', 'Neutral', 'Evil']
const ANCESTRIES = ['Dwarf', 'Elf', 'Gnome', 'Halfling', 'Human', 'Leshy', 'Orc']
const CLASSES = ['Bard', 'Cleric', 'Druid', 'Fighter', 'Ranger', 'Rogue', 'Witch', 'Wizard']

function emptyCharacter(name) {
  return {
    name, ancestry: '', klass: '', level: 1, background: '',
    ethics: '', morals: '',
    hp: 10, maxHp: 10, ac: 10,
    abilities: Object.fromEntries(ABILITIES.map(a => [a, 0])),
    skills: Object.fromEntries(SKILLS.map(s => [s.name, 0])),
    skillNotes: Object.fromEntries(SKILLS.map(s => [s.name, ''])),
    notes: '', inventory: [],
  }
}

// currentId is which lore-game we're viewing — set from the ?id param.
// registry is the local list of lore-games (stored in cache under 'index').
// both live here, not in the store, because they're navigation state.
let currentId = new URLSearchParams(location.search).get('id') || 'index'
let registry = { games: [] }

// reference data — the vendored PF2e SRD slice (client/public/cdn/pf2e-srd/).
// loaded once, read-only, NEVER synced or written to the room: it's identical
// on every device already, so broadcasting it would just be a multi-megabyte
// waste. only the *reveal* (which entry, to whom, when) is shared state.
let refData = { monsters: [], items: [], places: [], actions: [], conditions: [], skills: [], loaded: false }

// which accordions are open, tracked OUTSIDE $ state on purpose. <details>'s
// own `toggle` event doesn't bubble, so it can't go through the usual
// delegated $.when(...) click handling — afterUpdate (below) attaches a
// direct listener per element instead. Kept out of $ entirely (not even
// $.whisper) because the periodic redraw (every 2s, for the live/offline
// dot) regenerates this same template with no other reason to change —
// putting this in reactive state would just make redraw fight itself.
const openAccordions = new Set()

// per-character undo/redo — same shape as flip-book's per-frame stacks
// (client/public/elves/flip-book.js: _getUndoStack/_getRedoStack/captureUndo),
// just keyed by player id instead of frame id. Local-only, in-memory, never
// synced: undo history is a per-device editing convenience, not shared game
// state — there's no expectation that the Oracle's undo stack should exist
// on a player's device or survive a reload.
const MAX_HISTORY = 30
const _undoStacks = {}
const _redoStacks = {}

function _getUndoStack(id) { return (_undoStacks[id] ||= []) }
function _getRedoStack(id) { return (_redoStacks[id] ||= []) }

// call once per edit session (on focus, not per-keystroke) so a whole typing
// burst collapses into a single undo step, the same way flip-book captures
// once per stroke rather than once per pixel.
function captureUndo(id) {
  const p = playerById(id)
  if (!p) return
  const undo = _getUndoStack(id)
  undo.push(JSON.parse(JSON.stringify(p)))
  if (undo.length > MAX_HISTORY) undo.shift()
  _redoStacks[id] = []
}

function undoCharacter(id) {
  const undo = _getUndoStack(id)
  if (!undo.length) return
  const p = playerById(id)
  if (!p) return
  _getRedoStack(id).push(JSON.parse(JSON.stringify(p)))
  commit({ players: { [id]: undo.pop() } })
}

function redoCharacter(id) {
  const redo = _getRedoStack(id)
  if (!redo.length) return
  const p = playerById(id)
  if (!p) return
  _getUndoStack(id).push(JSON.parse(JSON.stringify(p)))
  commit({ players: { [id]: redo.pop() } })
}

async function loadRefData() {
  const [monsters, items, places, actions, conditions, skills] = await Promise.all([
    fetch('/cdn/pf2e-srd/monsters.json').then(r => r.json()).catch(() => []),
    fetch('/cdn/pf2e-srd/items.json').then(r => r.json()).catch(() => []),
    fetch('/cdn/pf2e-srd/places.json').then(r => r.json()).catch(() => []),
    fetch('/cdn/pf2e-srd/actions.json').then(r => r.json()).catch(() => []),
    fetch('/cdn/pf2e-srd/conditions.json').then(r => r.json()).catch(() => []),
    fetch('/cdn/pf2e-srd/skills.json').then(r => r.json()).catch(() => []),
  ])
  refData = { monsters, items, places, actions, conditions, skills, loaded: true }
  redraw()
}

// the per-key merge function for shared data.
// players/reveals merge entry-by-entry so concurrent additions by different
// people both survive — no last-write-wins clobber. a null value is a
// tombstone (deletion). this string is eval'd in a QuickJS sandbox both
// locally and on peers — no closures over outer scope.
const ROOM_MERGE = `(state, payload) => {
  var out = Object.assign({}, state)
  ;['players','reveals'].forEach(function(field){
    if (payload[field]) {
      var base = Object.assign({}, state[field] || {})
      var inc = payload[field]
      Object.keys(inc).forEach(function(k){ if (inc[k] === null) { delete base[k] } else { base[k] = inc[k] } })
      out[field] = base
    }
  })
  return out
}`

const newData = () => ({ players: {}, reveals: {} })

function toMap(v) { if (Array.isArray(v)) { const o = {}; v.forEach(x => { if (x && x.id) o[x.id] = x }); return o } return v || {} }

// commit: write to local store → persist to IndexedDB → broadcast delta to room.
// this is the only path that touches the network — keep it small.
function commit(patch) {
  $.teach(patch, ROOM_MERGE)
  if (currentId === 'index') return
  cache.put(currentId, sharedData())
  try { broadcastElf(tag, patch, ROOM_MERGE) } catch (e) { console.warn('lore-game sync:', e) }
}

// live field edits (typing) go through here instead of commit(): the local
// $.teach happens on every keystroke so the field never lags behind what's
// on screen, but the network write (IndexedDB + broadcast to peers) is
// debounced — same two-tier split bulletin-board's card-body textarea
// already uses (updateCard() immediate + save() debounced 800ms). Without
// this, every keystroke would round-trip through the QuickJS sandbox eval
// AND hit the network, for no benefit — nobody needs mid-word updates.
let _liveSyncTimer = null
function commitLive(patch) {
  $.teach(patch, ROOM_MERGE)
  clearTimeout(_liveSyncTimer)
  _liveSyncTimer = setTimeout(() => {
    if (currentId === 'index') return
    cache.put(currentId, sharedData())
    try { broadcastElf(tag, patch, ROOM_MERGE) } catch (e) { console.warn('lore-game sync:', e) }
  }, 800)
}

function redraw() { $.whisper({ rev: $.learn().rev + 1 }) }
function sharedData() { const s = $.learn(); return { players: s.players, reveals: s.reveals } }
function persistRegistry() { cache.put('index', registry); redraw() }
function nextId(prefix) { return prefix + crypto.randomUUID().replace(/-/g, '').slice(0, 8) }
function playerById(id) { return $.learn().players[id] || null }
function activePlayer() { return playerById($.learn().activePlayerId) }

// claiming: the Oracle creates a character and reveals a QR/link encoding
// ?claim=<playerId>. Scanning it is the ONLY way a device attaches to a
// character — there's no more player-side "+ New character". A device can
// hold more than one claim (someone playing two characters, or the same
// person claiming on phone + laptop), tracked as a small id list per game
// in sessionStorage — NOT the full player roster, so a player's sidebar
// only ever shows characters *this device* actually claimed, never lets
// them switch into someone else's by clicking a name in a list.
function claimedIds(id) {
  try { return JSON.parse(sessionStorage.getItem('lore-game-claims-' + id) || '[]') } catch { return [] }
}
function addClaim(id, playerId) {
  const claims = claimedIds(id)
  if (!claims.includes(playerId)) claims.push(playerId)
  sessionStorage.setItem('lore-game-claims-' + id, JSON.stringify(claims))
}

function consumeClaimParam(id) {
  const params = new URLSearchParams(location.search)
  const claim = params.get('claim')
  if (!claim) return
  sessionStorage.setItem('lore-game-role-' + id, 'player')
  sessionStorage.setItem('lore-game-me-' + id, claim)
  addClaim(id, claim)
  params.delete('claim')
  const qs = params.toString()
  history.replaceState(null, '', qs ? `?${qs}` : location.pathname)
}

// role/activePlayerId/screen/sheetHandbookTab are all local-only fields
// (never synced) restored from sessionStorage — this reads all of them at
// once so the two call sites below (initial load, and the 800ms resync)
// can't drift out of sync with each other.
function restoreLocalIdentity(id) {
  return {
    role: sessionStorage.getItem('lore-game-role-' + id) || null,
    activePlayerId: sessionStorage.getItem('lore-game-me-' + id) || null,
    screen: sessionStorage.getItem('lore-game-screen-' + id) || 'home',
    sheetHandbookTab: sessionStorage.getItem('lore-game-hbtab-' + id) || 'actions',
  }
}

async function loadLoreGame(id) {
  const r = await cache.get(id)
  const d = r && r.data ? r.data : newData()
  $.teach({ players: toMap(d.players), reveals: d.reveals || {} })
  consumeClaimParam(id)
  $.whisper(restoreLocalIdentity(id))
  linkState(tag, id) // join the room; our loaded data seeds it, room state merges back
  // re-assert our per-tab identity once the room join settles — stateCache can
  // briefly carry the seeder's role/activePlayerId. one-off, never inside render.
  setTimeout(() => {
    if (currentId !== id) return
    $.whisper(restoreLocalIdentity(id))
  }, 800)
}

async function openLoreGame(id) {
  currentId = id
  history.replaceState(null, '', `?id=${id}`)
  await loadLoreGame(id)
  // loadLoreGame already restored `screen` from sessionStorage — don't
  // stomp it back to 'home' here, that would defeat the whole point of
  // persisting which tab you were on.
  $.whisper({ modal: null })
}

function gotoIndex() {
  currentId = 'index'
  history.replaceState(null, '', `?id=index`)
  $.whisper({ screen: 'home', modal: null })
}

async function newLoreGame() {
  const id = crypto.randomUUID()
  registry.games.push({ id, name: 'Lore Game ' + (registry.games.length + 1), created: Date.now() })
  persistRegistry()
  await openLoreGame(id)
}

function deleteLoreGame(id) {
  const g = registry.games.find(x => x.id === id)
  if (!confirm(`Delete lore-game "${g ? g.name : id}"? This removes all its players and reveals.`)) return
  registry.games = registry.games.filter(x => x.id !== id)
  persistRegistry()
  cache.del(id)
}

// boot: load registry, reference data, then load the current game if we're not on index
;(async function boot() {
  const r = await cache.get('index')
  if (r && r.data) registry = r.data
  loadRefData()
  if (currentId !== 'index') {
    if (!registry.games.find(g => g.id === currentId)) {
      registry.games.push({ id: currentId, name: 'Lore Game ' + (registry.games.length + 1), created: Date.now() })
      cache.put('index', registry)
    }
    await loadLoreGame(currentId)
  }
  $.whisper({ loading: false })
})()

// bump rev every 2s so the live/offline indicator stays fresh
setInterval(redraw, 2000)

// === Self ===
// shared fields (players, reveals) sync to the geckos room via commit().
// local-only fields are written with $.whisper — never leaves this window.
const $ = Self(tag, {
  rev: 0,
  players: {}, reveals: {},
  screen: 'home', role: null, activePlayerId: null, modal: null, sidebarOpen: true,
  matching: false, loading: true,
  search: '',
  sheetHandbookTab: 'actions', handbookSearch: '',
})

export default $

// === rendering ===
// pure functions — read state, return HTML strings. no side effects.

function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])) }

function needRole() {
  return `
    <div class="lg-rolepick">
      <h2>Who are you at this table?</h2>
      <div class="lg-rolecards">
        <button class="lg-rolecard" data-pick-role="oracle">
          <span class="lg-rolecard-title">🔮 Oracle</span>
          <span class="lg-rolecard-desc">Run the table — see every player, browse locations/monsters/items, reveal what the party discovers.</span>
        </button>
        <button class="lg-rolecard" data-pick-role="player">
          <span class="lg-rolecard-title">🗡️ Player</span>
          <span class="lg-rolecard-desc">Your own character sheet, plus the feed of everything the Oracle has revealed.</span>
        </button>
      </div>
    </div>`
}

function needPlayer() {
  return `<div class="lg-empty">Ask your Oracle for a claim link or QR code to attach a character to this device.</div>`
}

// --- accordions over vendored SRD entries ---

function levelBadge(entry) {
  if (entry.level == null) return ''
  return `<span class="lg-badge">Lv ${esc(entry.level)}</span>`
}

function traitBadges(entry) {
  if (!entry.traits || !entry.traits.length) return ''
  return entry.traits.slice(0, 6).map(t => `<span class="lg-trait">${esc(t)}</span>`).join('')
}

function priceBadge(entry) {
  if (!entry.price) return ''
  const p = entry.price
  const amount = typeof p === 'object' ? `${p.amount ?? ''} ${p.coin ?? ''}`.trim() : String(p)
  return amount ? `<span class="lg-badge">${esc(amount)}</span>` : ''
}

function monsterDetail(m) {
  const r = m.raw || {}
  const ac = r.defenses?.ac?.std
  const hp = (r.defenses?.hp || []).map(h => h.hp).filter(Boolean).join(' / ')
  const speed = r.speed ? Object.entries(r.speed).map(([k, v]) => `${k} ${v} ft.`).join(', ') : ''
  const abilities = [...(r.abilities?.top || []), ...(r.abilities?.bot || [])]
  return `
    <div class="lg-detail">
      ${ac != null ? `<div><b>AC</b> ${esc(ac)}</div>` : ''}
      ${hp ? `<div><b>HP</b> ${esc(hp)}</div>` : ''}
      ${speed ? `<div><b>Speed</b> ${esc(speed)}</div>` : ''}
      ${(r.attacks || []).map(a => `<div><b>${esc(a.range || '')} ${esc(a.name || '')}</b> +${esc(a.attack)} — ${stripTags(a.damage || '')}</div>`).join('')}
      ${abilities.map(a => `<div class="lg-ability"><b>${esc(a.name)}</b> ${stripTags((a.entries || []).join(' '))}</div>`).join('')}
      <div class="lg-source">${esc(m.source || '')}${r.page ? ` p.${r.page}` : ''}</div>
    </div>`
}

function itemDetail(it) {
  const r = it.raw || {}
  const entries = r.entries || []
  return `
    <div class="lg-detail">
      ${it.category ? `<div><b>Category</b> ${esc(it.category)}</div>` : ''}
      ${entries.map(e => `<div>${stripTags(typeof e === 'string' ? e : JSON.stringify(e))}</div>`).join('')}
      <div class="lg-source">${esc(it.source || '')}${r.page ? ` p.${r.page}` : ''}</div>
    </div>`
}

function placeDetail(p) {
  const r = p.raw || {}
  const entries = r.entries || []
  return `
    <div class="lg-detail">
      ${p.category ? `<div><b>${esc(p.category)}</b></div>` : ''}
      ${entries.filter(e => typeof e === 'string').slice(0, 3).map(e => `<div>${stripTags(e)}</div>`).join('')}
      <div class="lg-source">${esc(p.source || '')}${r.page ? ` p.${r.page}` : ''}</div>
    </div>`
}

// PF2e source data tags entries with {@tag content} for cross-references
// ({@damage 1d8+7}, {@condition invisible}, etc) — strip to plain text for a
// quick-reference accordion. losing the hyperlink-to-rule behavior on
// purpose: rendering it would mean building a tag-router we don't need yet.
// The captured content can itself contain literal <>/&/" (real example:
// "{@trait two-hand <d10>}" — the <d10> is the SRD's own text, not part of
// the {@...} bracket syntax) — esc() here, not at each call site, so this
// is safe by construction rather than by remembering to wrap every caller.
// Unescaped, that one item ("Griffon Cane") alone corrupted diffHTML's
// parser for the entire accordion list the moment it matched a search.
function stripTags(s) {
  return esc(String(s || '').replace(/\{@\w+ ([^}|]+)(\|[^}]*)?\}/g, '$1'))
}

const REF_KINDS = {
  locations: { label: 'Locations', icon: '🗺️', list: () => refData.places, detail: placeDetail, badges: e => traitBadges(e) },
  monsters:  { label: 'Monsters',  icon: '🐉', list: () => refData.monsters, detail: monsterDetail, badges: e => levelBadge(e) + traitBadges(e) },
  items:     { label: 'Items',     icon: '💰', list: () => refData.items, detail: itemDetail, badges: e => levelBadge(e) + priceBadge(e) },
}

// player handbook reference — general rules text (actions/conditions/
// skills), not spoiler-gated like REF_KINDS above. No reveal/grant buttons:
// nothing here is Oracle-controlled, it's the same book every player at the
// table already has open. Lives on the player's own sheet, below inventory.
const HANDBOOK_KINDS = {
  actions:    { label: 'Actions',    icon: '⚡', list: () => refData.actions,    detail: genericDetail, badges: e => traitBadges(e) },
  conditions: { label: 'Conditions', icon: '🩹', list: () => refData.conditions, detail: genericDetail, badges: () => '' },
  skills:     { label: 'Skills',     icon: '🎯', list: () => refData.skills,     detail: genericDetail, badges: () => '' },
}

// entries in this SRD data are either plain strings, or structured blocks
// like {type:'successDegree', entries:{'Critical Success':'...', ...}} —
// flatten recursively into display lines rather than building a renderer
// per block type (there are several; a generic reference lookup doesn't
// need to distinguish them typographically, just show the text).
function flattenEntry(e) {
  if (typeof e === 'string') return [stripTags(e)]
  if (e && typeof e === 'object') {
    if (Array.isArray(e.entries)) return e.entries.flatMap(flattenEntry)
    if (e.entries && typeof e.entries === 'object') {
      return Object.entries(e.entries).map(([k, v]) => `<b>${esc(k)}</b>: ${stripTags(typeof v === 'string' ? v : JSON.stringify(v))}`)
    }
  }
  return []
}

function genericDetail(entry) {
  const r = entry.raw || {}
  const lines = (r.entries || []).flatMap(flattenEntry)
  return `
    <div class="lg-detail">
      ${lines.map(l => `<div>${l}</div>`).join('')}
      <div class="lg-source">${esc(entry.source || '')}${r.page ? ` p.${r.page}` : ''}</div>
    </div>`
}

const REF_RESULT_CAP = 60

function referenceTab(kind) {
  const cfg = REF_KINDS[kind]
  const { search } = $.learn()
  const q = search.trim().toLowerCase()
  const all = cfg.list()
  const filtered = q ? all.filter(e => e.name.toLowerCase().includes(q)) : all
  const shown = filtered.slice(0, REF_RESULT_CAP)
  // Oracle's "focus" reuses activePlayerId (same field a player uses for
  // their own claimed character) — here it means "who am I granting to."
  const focus = kind === 'items' ? activePlayer() : null
  return `
    <div class="lg-screen">
      <div class="lg-sec-head">
        <h2>${cfg.icon} ${cfg.label}</h2>
        <input class="lg-search" type="text" placeholder="search ${cfg.label.toLowerCase()}…" value="${esc(search)}" data-ref-search />
      </div>
      ${kind === 'items' ? `<div class="lg-hint">granting to: ${focus ? `<b>${esc(focus.name)}</b>` : 'no one focused — click a player in the sidebar'}</div>` : ''}
      <div class="lg-hint">${filtered.length} match${filtered.length === 1 ? '' : 'es'}${filtered.length > REF_RESULT_CAP ? ` — showing first ${REF_RESULT_CAP}, refine your search` : ''}</div>
      <div class="lg-accordions">
        ${shown.length ? shown.map(e => `
          <details class="lg-accordion" data-acc-key="${kind}:${e.id}" ${openAccordions.has(kind + ':' + e.id) ? 'open' : ''}>
            <summary>
              <span class="lg-accordion-name">${esc(e.name)}</span>
              <span class="lg-accordion-badges">${cfg.badges(e)}</span>
              ${kind === 'items' && focus ? `<button class="lg-btn lg-btn-grant" data-grant="${e.id}">Grant to ${esc(focus.name)}</button>` : ''}
              <button class="lg-btn lg-btn-reveal" data-reveal="${kind}:${e.id}">Reveal to table</button>
            </summary>
            ${cfg.detail(e)}
          </details>
        `).join('') : `<div class="lg-empty">${refData.loaded ? 'No matches.' : 'Loading reference data…'}</div>`}
      </div>
    </div>`
}

// player handbook — same search+accordion shape as referenceTab, minus the
// reveal/grant machinery (nothing here is Oracle-gated). Its own tab state
// (sheetHandbookTab) and search field (handbookSearch) are separate from
// the Oracle reference tab's, since both can be open in different screens
// at once (Oracle on Items while focused-on-a-player's sheet also shows
// this section).
function handbookSection() {
  const { sheetHandbookTab, handbookSearch } = $.learn()
  const kind = sheetHandbookTab || 'actions'
  const cfg = HANDBOOK_KINDS[kind]
  const q = (handbookSearch || '').trim().toLowerCase()
  const all = cfg.list()
  const filtered = q ? all.filter(e => e.name.toLowerCase().includes(q)) : all
  const shown = filtered.slice(0, REF_RESULT_CAP)
  return `
    <div class="lg-sec-head"><h3>📖 Reference</h3></div>
    <div class="lg-hb-tabs">
      ${Object.entries(HANDBOOK_KINDS).map(([k, c]) => `<button class="lg-tab ${kind === k ? 'on' : ''}" data-hb-tab="${k}">${c.icon} ${c.label}</button>`).join('')}
    </div>
    <input class="lg-input lg-search" type="text" placeholder="search ${cfg.label.toLowerCase()}…" value="${esc(handbookSearch || '')}" data-hb-search />
    <div class="lg-hint">${filtered.length} match${filtered.length === 1 ? '' : 'es'}${filtered.length > REF_RESULT_CAP ? ` — showing first ${REF_RESULT_CAP}, refine your search` : ''}</div>
    <div class="lg-accordions">
      ${shown.length ? shown.map(e => `
        <details class="lg-accordion" data-acc-key="hb:${kind}:${e.id}" ${openAccordions.has('hb:' + kind + ':' + e.id) ? 'open' : ''}>
          <summary>
            <span class="lg-accordion-name">${esc(e.name)}</span>
            <span class="lg-accordion-badges">${cfg.badges(e)}</span>
          </summary>
          ${cfg.detail(e)}
        </details>
      `).join('') : `<div class="lg-empty">${refData.loaded ? 'No matches.' : 'Loading reference data…'}</div>`}
    </div>`
}

function playersTab() {
  const { activePlayerId } = $.learn()
  const players = Object.values($.learn().players)
  return `
    <div class="lg-screen">
      <div class="lg-sec-head"><h2>👥 Players</h2><button class="lg-btn lg-btn-go" data-new-player>+ New character</button></div>
      <div class="lg-hint">create a character, then reveal its claim QR so the actual player can attach their device to it.</div>
      ${players.length ? players.map(p => `
        <div class="lg-playercard ${p.id === activePlayerId ? 'lg-playercard-focused' : ''}">
          <div class="lg-playercard-name">${esc(p.name)} <span class="lg-hint">${esc(p.ancestry || '')} ${esc(p.klass || '')} ${p.level != null ? `· Lv ${esc(p.level)}` : ''}</span></div>
          <div class="lg-playercard-hp">HP ${esc(p.hp ?? '?')}/${esc(p.maxHp ?? '?')} · AC ${esc(p.ac ?? '?')} · ${(p.inventory || []).length} item${(p.inventory || []).length === 1 ? '' : 's'}</div>
          ${p.notes ? `<div class="lg-playercard-notes">${esc(p.notes)}</div>` : ''}
          <div class="lg-prow">
            <button class="lg-btn" data-set-active="${p.id}">${p.id === activePlayerId ? 'Focused' : 'Focus (grant items)'}</button>
            <button class="lg-btn" data-edit-player="${p.id}">Edit sheet</button>
            <button class="lg-btn lg-btn-go" data-claim-qr="${p.id}">Claim QR</button>
          </div>
        </div>`).join('') : `<div class="lg-empty">No characters yet — create one, then share its claim QR with a player.</div>`}
    </div>`
}

function feedTab() {
  const reveals = Object.values($.learn().reveals).sort((a, b) => b.revealedAt - a.revealedAt)
  return `
    <div class="lg-screen">
      <div class="lg-sec-head"><h2>📜 Feed</h2></div>
      ${reveals.length ? reveals.map(r => `
        <div class="lg-feed-row">
          <span class="lg-feed-kind">${REF_KINDS[r.kind]?.icon || ''}</span>
          <span class="lg-feed-name">${esc(r.name)}</span>
          <span class="lg-hint">${new Date(r.revealedAt).toLocaleTimeString()}</span>
        </div>`).join('') : `<div class="lg-empty">Nothing revealed yet.</div>`}
    </div>`
}

function sheetScreen() {
  const p = activePlayer()
  if (!p) return needPlayer()
  const abilities = p.abilities || {}
  const skills = p.skills || {}
  const skillNotes = p.skillNotes || {}
  return `
    <div class="lg-screen lg-sheet" data-player-id="${p.id}">
      <div class="lg-sec-head">
        <h2>🗡️ ${esc(p.name)}</h2>
        <div class="lg-prow">
          <button class="lg-btn" data-undo-character ${_getUndoStack(p.id).length ? '' : 'disabled'}>↶ Undo</button>
          <button class="lg-btn" data-redo-character ${_getRedoStack(p.id).length ? '' : 'disabled'}>↷ Redo</button>
        </div>
      </div>
      <label class="lg-field"><span>Name</span><input class="lg-input" data-field="name" value="${esc(p.name)}" /></label>
      <div class="lg-row2">
        <label class="lg-field"><span>Ancestry</span>
          <select class="lg-input" data-field="ancestry">
            <option value="" ${!p.ancestry ? 'selected' : ''}>--select--</option>
            ${ANCESTRIES.map(a => `<option value="${a}" ${p.ancestry === a ? 'selected' : ''}>${a}</option>`).join('')}
          </select>
        </label>
        <label class="lg-field"><span>Class</span>
          <select class="lg-input" data-field="klass">
            <option value="" ${!p.klass ? 'selected' : ''}>--select--</option>
            ${CLASSES.map(c => `<option value="${c}" ${p.klass === c ? 'selected' : ''}>${c}</option>`).join('')}
          </select>
        </label>
      </div>
      <label class="lg-field"><span>Background</span><textarea class="lg-input" rows="2" data-field="background">${esc(p.background)}</textarea></label>

      <div class="lg-row2">
        <div>
          <div class="lg-hint">Ethics</div>
          ${ETHICS.map(v => `
            <label class="lg-radio"><input type="radio" name="lg-ethics" value="${v}" ${p.ethics === v ? 'checked' : ''} /> ${v}</label>
          `).join('')}
        </div>
        <div>
          <div class="lg-hint">Morals</div>
          ${MORALS.map(v => `
            <label class="lg-radio"><input type="radio" name="lg-morals" value="${v}" ${p.morals === v ? 'checked' : ''} /> ${v}</label>
          `).join('')}
        </div>
      </div>

      <div class="lg-row3">
        <label class="lg-field"><span>Level</span><input class="lg-input" type="number" data-field="level" value="${esc(p.level)}" /></label>
        <label class="lg-field"><span>HP</span><input class="lg-input" type="number" data-field="hp" value="${esc(p.hp)}" /></label>
        <label class="lg-field"><span>Max HP</span><input class="lg-input" type="number" data-field="maxHp" value="${esc(p.maxHp)}" /></label>
      </div>
      <label class="lg-field"><span>AC</span><input class="lg-input" type="number" data-field="ac" value="${esc(p.ac)}" /></label>

      <div class="lg-sec-head"><h3>Abilities</h3></div>
      <div class="lg-abilities">
        ${ABILITIES.map(a => `
          <label class="lg-field lg-ability-field"><span>${a}</span><input class="lg-input" type="number" data-ability="${a}" value="${esc(abilities[a] ?? 0)}" /></label>
        `).join('')}
      </div>

      <div class="lg-sec-head"><h3>Skills</h3></div>
      <div class="lg-skills">
        ${SKILLS.map(s => {
          const value = parseInt(skills[s.name] ?? 0) || 0
          const mod = parseInt(abilities[s.mod] ?? 0) || 0
          return `
            <div class="lg-skill">
              <label class="lg-field"><span>${s.label} <small class="lg-hint">(${s.mod})</small></span><input class="lg-input" type="number" data-skill="${s.name}" value="${value}" /></label>
              <div class="lg-skill-total">${value + mod}</div>
              <input class="lg-input lg-skill-note" type="text" placeholder="notes…" data-skill-note="${s.name}" value="${esc(skillNotes[s.name])}" />
            </div>
          `
        }).join('')}
      </div>

      <label class="lg-field"><span>Notes</span><textarea class="lg-input" rows="4" data-field="notes">${esc(p.notes)}</textarea></label>
      <div class="lg-prow">
        <button class="lg-btn lg-btn-danger" data-del-player="${p.id}">Delete character</button>
      </div>
      <div class="lg-sec-head"><h3>Inventory</h3></div>
      <div class="lg-inventory">
        ${(p.inventory || []).length ? p.inventory.map(it => `
          <div class="lg-inv-row">
            <span class="lg-inv-name">${esc(it.name)}</span>
            <button class="lg-btn lg-btn-danger" data-discard-item="${it.id}" data-discard-owner="${p.id}">Discard</button>
          </div>`).join('') : `<div class="lg-empty">No items yet — your Oracle grants items from the Items reference.</div>`}
      </div>
      ${handbookSection()}
    </div>`
}

const ORACLE_SCREENS = { locations: () => referenceTab('locations'), monsters: () => referenceTab('monsters'), items: () => referenceTab('items'), players: playersTab, sheet: sheetScreen, feed: feedTab }
const PLAYER_SCREENS = { sheet: sheetScreen, feed: feedTab }

function modalView() {
  const { modal } = $.learn()
  if (!modal || !modal.startsWith('claim:')) return ''
  const p = playerById(modal.slice('claim:'.length))
  if (!p) return ''
  const url = `${location.origin}/app/lore-game?id=${currentId}&claim=${p.id}`
  return `
    <div class="lg-modal-bg" data-close-modal>
      <div class="lg-modal">
        <h3>Claim link — ${esc(p.name)}</h3>
        <p class="lg-hint">have the player scan this, or open the link on their device.</p>
        <qr-code src="${esc(url)}"></qr-code>
        <input class="lg-input" readonly value="${esc(url)}" />
        <div class="lg-modal-actions">
          <button class="lg-btn" data-close-modal>Close</button>
        </div>
      </div>
    </div>`
}

// full-height strip between sidebar and main, chevron centered vertically
// (flex align-items:center puts it "half way down" for free) — a sibling
// of .lg-sidebar rather than a child positioned on top of it, so collapsing
// the sidebar to width:0 + overflow:hidden can never clip the button that's
// supposed to bring it back.
function sidebarToggleButton(sidebarOpen) {
  return `<button class="lg-sidebar-toggle" data-toggle-sidebar title="${sidebarOpen ? 'collapse' : 'expand'} sidebar">${sidebarOpen ? '‹' : '›'}</button>`
}

function oracleShell() {
  const { screen, activePlayerId, sidebarOpen } = $.learn()
  return `
    <div class="lg-body" data-sidebar-open="${sidebarOpen}">
      <aside class="lg-sidebar">
        <div class="lg-sidebar-label">players — click to focus (edit / grant items)</div>
        <div class="lg-userlist">
          ${Object.values($.learn().players).map(p => `
            <button class="lg-userrow ${p.id === activePlayerId ? 'on' : ''}" data-set-active="${p.id}">
              <span class="lg-userrow-name">${esc(p.name)}</span>
              <span class="lg-hint">HP ${esc(p.hp ?? '?')}/${esc(p.maxHp ?? '?')}</span>
            </button>`).join('') || '<div class="lg-empty">No players yet.</div>'}
        </div>
      </aside>
      ${sidebarToggleButton(sidebarOpen)}
      <main class="lg-main">${(ORACLE_SCREENS[screen] || ORACLE_SCREENS.locations)()}</main>
    </div>
    ${modalView()}`
}

function playerShell() {
  const { screen, activePlayerId, sidebarOpen } = $.learn()
  const claimed = claimedIds(currentId)
  const players = Object.values($.learn().players).filter(p => claimed.includes(p.id))
  return `
    <div class="lg-body" data-sidebar-open="${sidebarOpen}">
      <aside class="lg-sidebar">
        <div class="lg-sidebar-label">your characters (claimed on this device)</div>
        <div class="lg-userlist">
          ${players.length ? players.map(p => `
            <button class="lg-userrow ${p.id === activePlayerId ? 'on' : ''}" data-set-active="${p.id}">
              <span class="lg-userrow-name">${esc(p.name)}</span>
              ${p.id === activePlayerId ? '<span class="lg-dot">active</span>' : ''}
            </button>`).join('') : '<div class="lg-empty">None claimed yet.</div>'}
        </div>
      </aside>
      ${sidebarToggleButton(sidebarOpen)}
      <main class="lg-main">${(PLAYER_SCREENS[screen] || PLAYER_SCREENS.sheet)()}</main>
    </div>`
}

function indexScreen() {
  return `
    <div class="lg-screen lg-index">
      <div class="lg-sec-head"><h2>Lore Games</h2><button class="lg-btn lg-btn-go" data-new-game>+ New lore-game</button></div>
      <div class="lg-pl-list">
        ${registry.games.length ? registry.games.map(g => `
          <div class="lg-pl-row">
            <button class="lg-pl-open" data-open-game="${g.id}">
              <span class="lg-pl-name">${esc(g.name)}</span>
              <span class="lg-pl-id">${esc(String(g.id).slice(0, 8))}</span>
            </button>
            <button class="lg-pl-edit" data-rename-game="${g.id}" title="rename">✎</button>
            <button class="lg-pl-trash" data-del-game="${g.id}" title="delete">🗑</button>
          </div>`).join('') : '<div class="lg-empty">No lore-games yet.</div>'}
      </div>
    </div>`
}

function renderApp() {
  if ($.learn().loading) return `<div class="lg-shell"><main class="lg-main"><div class="lg-empty" style="padding:2rem">loading…</div></main></div>`

  if (currentId === 'index') return `
    <div class="lg-shell">
      <div class="lg-topbar"><span class="lg-home-btn">lore-game</span></div>
      <div class="lg-body"><main class="lg-main">${indexScreen()}</main></div>
    </div>`

  const { role } = $.learn()
  const g = registry.games.find(p => p.id === currentId)
  const live = !!(typeof channel !== 'undefined' && channel && channel.id)
  return `
    <div class="lg-shell">
      <div class="lg-topbar">
        <button class="lg-home-btn" data-goto-index>Back</button>
        <button class="lg-pl-title" data-choose-role>${esc(g ? g.name : 'Lore Game')}</button>
        ${role === 'oracle' ? `
          <nav class="lg-nav">
            ${['locations', 'monsters', 'items', 'players', 'sheet', 'feed'].map(s => `<button class="lg-tab ${$.learn().screen === s ? 'on' : ''}" data-screen="${s}">${s[0].toUpperCase() + s.slice(1)}</button>`).join('')}
          </nav>` : role === 'player' ? `
          <nav class="lg-nav">
            ${['sheet', 'feed'].map(s => `<button class="lg-tab ${$.learn().screen === s ? 'on' : ''}" data-screen="${s}">${s[0].toUpperCase() + s.slice(1)}</button>`).join('')}
          </nav>` : ''}
        <span class="lg-live ${live ? 'on' : ''}" title="realtime connection">${live ? '● live' : '○ offline'}</span>
      </div>
      ${!role ? `<div class="lg-body"><main class="lg-main">${needRole()}</main></div>`
        : role === 'oracle' ? oracleShell()
        : playerShell()}
    </div>`
}

function afterUpdate(target) {
  // direct (non-delegated) listener per element, reassigned via .ontoggle
  // each render — plain assignment replaces any prior handler cleanly, no
  // manual removeEventListener bookkeeping needed across re-renders.
  target.querySelectorAll('.lg-accordion[data-acc-key]').forEach(d => {
    d.ontoggle = () => {
      const key = d.dataset.accKey
      if (d.open) openAccordions.add(key)
      else openAccordions.delete(key)
    }
  })
}

$.draw(() => {
  // a render-time throw here previously left the tag blank with no visible
  // error (diffhtml just never got a new innerHTML to apply) — this was
  // hard to root-cause after the fact from a bug report alone, so failing
  // loud beats failing blank.
  try {
    return renderApp()
  } catch (e) {
    console.error('lore-game render error:', e)
    return `<div class="lg-shell"><main class="lg-main"><div class="lg-empty" style="padding:2rem;color:#b4452e">
      Render error — ${esc(e.message)}<br><small>see console for the full stack; reload should recover once the underlying state is fixed.</small>
    </div></main></div>`
  }
}, { afterUpdate })

// === event handlers ===
// $.when(type, selector, handler) delegates events on the elf's shadow.
// the selector is matched against event.target — not closest(), not bubbling.

$.when('click', '[data-goto-index]',   () => gotoIndex())
$.when('click', '[data-new-game]',     () => newLoreGame())
$.when('click', '[data-open-game]',    e => openLoreGame(e.target.closest('[data-open-game]').dataset.openGame))
$.when('click', '[data-del-game]',     e => deleteLoreGame(e.target.closest('[data-del-game]').dataset.delGame))
$.when('click', '[data-rename-game]',  onRenameGame)
$.when('click', '[data-choose-role]',  () => $.whisper({ role: null }))
$.when('click', '[data-pick-role]',    onPickRole)
$.when('click', '[data-screen]',       e => setScreen(e.target.closest('[data-screen]').dataset.screen))
$.when('click', '[data-new-player]',   onNewCharacter)
$.when('click', '[data-set-active]',   onSetActive)
$.when('click', '[data-edit-player]',  onEditPlayer)
$.when('click', '[data-del-player]',   onDelPlayer)
$.when('click', '[data-reveal]',       onReveal)
$.when('click', '[data-grant]',        onGrantItem)
$.when('click', '[data-discard-item]', onDiscardItem)
$.when('click', '[data-claim-qr]',     e => $.whisper({ modal: 'claim:' + e.target.closest('[data-claim-qr]').dataset.claimQr }))
$.when('click', '[data-close-modal]',  e => { if (e.target.matches('[data-close-modal]')) $.whisper({ modal: null }) })
$.when('click', '[data-toggle-sidebar]', () => $.whisper({ sidebarOpen: !$.learn().sidebarOpen }))
$.when('click', '[data-undo-character]', () => { const id = $.learn().activePlayerId; if (id) undoCharacter(id) })
$.when('click', '[data-redo-character]', () => { const id = $.learn().activePlayerId; if (id) redoCharacter(id) })
$.when('input',  '[data-ref-search]',  e => $.whisper({ search: e.target.value }))
$.when('click', '[data-hb-tab]',       e => setHandbookTab(e.target.closest('[data-hb-tab]').dataset.hbTab))
$.when('input', '[data-hb-search]',    e => $.whisper({ handbookSearch: e.target.value }))

// real-time sheet editing — no Save button. Every field commits live
// (commitLive: instant local $.teach, network write debounced 800ms — see
// commitLive's own comment). captureUndo runs once per edit session, on
// focus rather than per-keystroke, so a whole typing burst is one undo step
// (flip-book captures once per stroke for the same reason — the pixel/
// keystroke is never the right undo granularity).
function sheetPlayerId(el) { return el.closest('.lg-sheet')?.dataset.playerId }

$.when('focus', '.lg-sheet input, .lg-sheet textarea, .lg-sheet select', e => {
  const id = sheetPlayerId(e.target)
  if (id) captureUndo(id)
})

function onFieldInput(e) {
  const id = sheetPlayerId(e.target)
  const p = id && playerById(id)
  if (!p) return
  const v = e.target.type === 'number' ? Number(e.target.value) : e.target.value
  commitLive({ players: { [id]: { ...p, [e.target.dataset.field]: v } } })
}
// 'input' for text/number as-you-type; 'change' too since <select> doesn't
// reliably fire 'input' across browsers the way text fields do.
$.when('input', '.lg-sheet [data-field]', onFieldInput)
$.when('change', '.lg-sheet [data-field]', onFieldInput)

$.when('input', '.lg-sheet [data-ability]', e => {
  const id = sheetPlayerId(e.target)
  const p = id && playerById(id)
  if (!p) return
  const abilities = { ...(p.abilities || {}), [e.target.dataset.ability]: Number(e.target.value) }
  commitLive({ players: { [id]: { ...p, abilities } } })
})

$.when('input', '.lg-sheet [data-skill]', e => {
  const id = sheetPlayerId(e.target)
  const p = id && playerById(id)
  if (!p) return
  const skills = { ...(p.skills || {}), [e.target.dataset.skill]: Number(e.target.value) }
  commitLive({ players: { [id]: { ...p, skills } } })
})

$.when('input', '.lg-sheet [data-skill-note]', e => {
  const id = sheetPlayerId(e.target)
  const p = id && playerById(id)
  if (!p) return
  const skillNotes = { ...(p.skillNotes || {}), [e.target.dataset.skillNote]: e.target.value }
  commitLive({ players: { [id]: { ...p, skillNotes } } })
})

$.when('change', '.lg-sheet input[name="lg-ethics"]', e => {
  const id = sheetPlayerId(e.target)
  const p = id && playerById(id)
  if (!p) return
  commit({ players: { [id]: { ...p, ethics: e.target.value } } })
})

$.when('change', '.lg-sheet input[name="lg-morals"]', e => {
  const id = sheetPlayerId(e.target)
  const p = id && playerById(id)
  if (!p) return
  commit({ players: { [id]: { ...p, morals: e.target.value } } })
})

function onRenameGame(e) {
  const g = registry.games.find(x => x.id === e.target.closest('[data-rename-game]').dataset.renameGame)
  if (!g) return
  const name = prompt('Rename lore-game', g.name)
  if (name == null) return
  g.name = name.trim() || g.name
  persistRegistry()
}

function onPickRole(e) {
  const role = e.target.closest('[data-pick-role]').dataset.pickRole
  sessionStorage.setItem('lore-game-role-' + currentId, role)
  $.whisper({ role, screen: role === 'oracle' ? 'locations' : 'sheet' })
}

// setting activePlayerId ALWAYS has to go through here, never a bare
// $.whisper — loadLoreGame's 800ms post-join resync (a defense borrowed
// from pot-luck, for a real race where the room join can briefly clobber
// local-only fields back to their initial value) re-reads sessionStorage
// as the source of truth and stomps whatever's in memory. Any caller that
// set activePlayerId without also persisting it here would just watch
// that resync silently revert the selection ~800ms later — which is
// exactly what happened when Oracle-side character creation only
// whispered the id and never wrote it to storage.
function setFocus(id, extra = {}) {
  $.whisper({ activePlayerId: id, ...extra })
  sessionStorage.setItem('lore-game-me-' + currentId, id)
}

// which top-level tab (screen) and which handbook sub-tab were open —
// persisted per game so a reload lands back where you were, same idea as
// role/activePlayerId already being sessionStorage-backed.
function setScreen(screen) {
  $.whisper({ screen })
  sessionStorage.setItem('lore-game-screen-' + currentId, screen)
}

function setHandbookTab(tab) {
  $.whisper({ sheetHandbookTab: tab })
  sessionStorage.setItem('lore-game-hbtab-' + currentId, tab)
}

// Oracle-only: creates a character, does NOT attach this (or any) device to
// it — attaching happens by scanning the claim QR (see modalView/onClaimQr).
function onNewCharacter() {
  const id = nextId('p_')
  const n = Object.keys($.learn().players).length + 1
  commit({ players: { [id]: { id, ...emptyCharacter('Adventurer ' + n) } } })
  setFocus(id, { screen: 'players' })
}

function onEditPlayer(e) {
  const id = e.target.closest('[data-edit-player]').dataset.editPlayer
  setFocus(id, { screen: 'sheet' })
}

function onGrantItem(e) {
  const itemId = e.target.closest('[data-grant]').dataset.grant
  const p = activePlayer()
  if (!p) return
  const item = refData.items.find(x => x.id === itemId)
  if (!item) return
  const inventory = [...(p.inventory || []), { id: nextId('inv_'), itemId: item.id, name: item.name }]
  commit({ players: { [p.id]: { ...p, inventory } } })
}

function onDiscardItem(e) {
  const btn = e.target.closest('[data-discard-item]')
  const p = playerById(btn.dataset.discardOwner)
  if (!p) return
  const inventory = (p.inventory || []).filter(it => it.id !== btn.dataset.discardItem)
  commit({ players: { [p.id]: { ...p, inventory } } })
}

function onSetActive(e) {
  setFocus(e.target.closest('[data-set-active]').dataset.setActive)
}

function onDelPlayer(e) {
  const id = e.target.closest('[data-del-player]').dataset.delPlayer
  const p = playerById(id)
  if (!p || !confirm(`Delete ${p.name}? This can't be undone.`)) return
  commit({ players: { [id]: null } })
  if ($.learn().activePlayerId === id) { $.whisper({ activePlayerId: null }); sessionStorage.removeItem('lore-game-me-' + currentId) }
}


function onReveal(e) {
  const [kind, refId] = e.target.closest('[data-reveal]').dataset.reveal.split(':')
  const entry = REF_KINDS[kind].list().find(x => x.id === refId)
  if (!entry) return
  const id = nextId('r_')
  commit({ reveals: { [id]: { id, kind, refId, name: entry.name, revealedAt: Date.now() } } })
}

// === styles ===
// $.style() injects a <style> tag scoped to this elf's tag name.

$.style(`
  & { display:block; position:relative; height:100%; overflow:hidden; font-family:'Recursive',system-ui,sans-serif; color:#1a1a1a; background:#f3f1ea; }
  & button * { pointer-events:none; }
  & .lg-shell { display:flex; flex-direction:column; height:100%; }
  & .lg-topbar { display:flex; align-items:center; flex-wrap:wrap; gap:.5rem 1rem; padding:.5rem .9rem; background:#1a1a1a; color:#fff; }
  & .lg-home-btn { background:none; border:none; color:#fff; font-weight:700; font-size:1.05rem; cursor:pointer; }
  /* horizontally scrollable, not wrapping — on a narrow/mobile viewport,
     6 tabs wrapping to 2-3 rows eats a lot of vertical space that a
     one-hand-scrollable strip doesn't. */
  & .lg-nav { display:flex; flex-wrap:nowrap; gap:.4rem; flex:1; overflow-x:auto; -webkit-overflow-scrolling:touch; }
  & .lg-tab { background:rgba(255,255,255,.12); color:#fff; border:none; padding:.35rem .8rem; border-radius:.4rem; cursor:pointer; text-transform:capitalize; white-space:nowrap; flex-shrink:0; }
  & .lg-tab.on { background:#8b5cf6; }
  & .lg-live { font-size:.72rem; opacity:.6; }
  & .lg-live.on { color:#46d369; opacity:1; }
  & .lg-pl-title { background:rgba(255,255,255,.12); color:#fff; border:none; padding:.3rem .7rem; border-radius:.4rem; cursor:pointer; font-weight:600; }
  & .lg-body { display:flex; flex:1; min-height:0; }
  & .lg-sidebar { width:14rem; flex:0 0 14rem; background:#e7e3d8; border-right:1px solid #d3cdbd; padding:.7rem; display:flex; flex-direction:column; gap:.5rem; overflow-y:auto; overflow-x:hidden; transition:width .15s, flex-basis .15s, padding .15s; }
  & .lg-body[data-sidebar-open="false"] .lg-sidebar { width:0; flex-basis:0; padding:0; border-right:none; }
  & .lg-sidebar-toggle {
    flex:0 0 auto;
    width:1.1rem;
    align-self:stretch;
    background:#d3cdbd;
    color:#5a5240;
    border:none;
    border-right:1px solid #c4bda9;
    cursor:pointer;
    display:flex;
    align-items:center;
    justify-content:center;
    font-size:.85rem;
    padding:0;
  }
  & .lg-sidebar-toggle:hover { background:#c4bda9; }
  & .lg-sidebar-label { font-size:.7rem; text-transform:uppercase; letter-spacing:.04em; opacity:.5; margin-top:.2rem; }
  & .lg-userlist { display:flex; flex-direction:column; gap:.25rem; }
  & .lg-userrow { display:flex; align-items:center; justify-content:space-between; gap:.45rem; background:#fff; border:1px solid #d8d2c2; border-radius:.4rem; padding:.3rem .45rem; cursor:pointer; text-align:left; }
  & .lg-userrow-name { flex:1; }
  & .lg-userrow.on { border-color:#8b5cf6; box-shadow:0 0 0 1px #8b5cf6 inset; }
  & .lg-dot { font-size:.6rem; text-transform:uppercase; letter-spacing:.04em; color:#fff; background:#8b5cf6; border-radius:.25rem; padding:.1rem .35rem; }
  & .lg-main { flex:1; min-width:0; overflow:auto; padding:1rem 1.2rem; }
  & .lg-screen { display:flex; flex-direction:column; gap:.6rem; max-width:900px; }
  & .lg-sec-head { display:flex; align-items:center; justify-content:space-between; gap:1rem; flex-wrap:wrap; }
  & h1 { margin:.2rem 0; } & h2 { margin:.2rem 0; font-size:1.15rem; }
  & .lg-hint { font-size:.78rem; opacity:.6; }
  & .lg-btn { background:#1a1a1a; color:#fff; border:none; border-radius:.4rem; padding:.4rem .8rem; cursor:pointer; }
  & .lg-btn-go { background:#2e9e5b; } & .lg-btn[disabled] { opacity:.5; cursor:default; }
  & .lg-btn-danger { background:#b4452e; }
  & .lg-btn-reveal { background:#8b5cf6; font-size:.75rem; padding:.25rem .55rem; margin-left:auto; }
  & .lg-new { background:#8b5cf6; }
  & .lg-prow { display:flex; gap:.5rem; flex-wrap:wrap; margin-top:.5rem; }
  & .lg-empty { opacity:.55; padding:.6rem 0; font-size:.9rem; }
  & .lg-rolepick { display:flex; flex-direction:column; gap:1.2rem; align-items:center; padding:2rem 1rem; }
  & .lg-rolecards { display:flex; gap:1rem; flex-wrap:wrap; justify-content:center; }
  & .lg-rolecard { width:16rem; min-height:9rem; background:#fff; border:1px solid #d8d2c2; border-radius:.7rem; padding:1rem; display:flex; flex-direction:column; gap:.5rem; cursor:pointer; text-align:left; }
  & .lg-rolecard:hover { border-color:#8b5cf6; transform:translateY(-2px); transition:.12s; }
  & .lg-rolecard-title { font-size:1.1rem; font-weight:700; } & .lg-rolecard-desc { opacity:.7; font-size:.88rem; }
  & .lg-search { padding:.35rem .6rem; border:1px solid #c9c2af; border-radius:.35rem; font:inherit; min-width:14rem; }
  & .lg-accordions { display:flex; flex-direction:column; gap:.4rem; }
  & .lg-accordion { background:#fff; border:1px solid #d8d2c2; border-radius:.5rem; padding:.4rem .6rem; }
  & .lg-accordion summary { display:flex; align-items:center; gap:.6rem; cursor:pointer; list-style:none; }
  & .lg-accordion summary::-webkit-details-marker { display:none; }
  & .lg-accordion-name { font-weight:600; }
  & .lg-accordion-badges { display:flex; gap:.3rem; flex-wrap:wrap; }
  & .lg-badge { background:#eee; border-radius:.3rem; padding:.05rem .4rem; font-size:.72rem; }
  & .lg-trait { background:#f0e8ff; color:#6b3fc9; border-radius:.3rem; padding:.05rem .4rem; font-size:.68rem; text-transform:uppercase; }
  & .lg-detail { margin-top:.5rem; padding-top:.5rem; border-top:1px solid #eee; display:flex; flex-direction:column; gap:.3rem; font-size:.88rem; }
  & .lg-ability { padding-left:.2rem; }
  & .lg-source { font-size:.7rem; opacity:.45; margin-top:.2rem; }
  & .lg-playercard { background:#fff; border:1px solid #d8d2c2; border-radius:.5rem; padding:.6rem .8rem; display:flex; flex-direction:column; gap:.2rem; }
  & .lg-playercard-name { font-weight:600; }
  & .lg-playercard-hp { font-size:.85rem; opacity:.75; }
  & .lg-playercard-notes { font-size:.82rem; opacity:.6; }
  & .lg-feed-row { display:flex; align-items:center; gap:.5rem; background:#fff; border:1px solid #e0dac9; border-radius:.4rem; padding:.4rem .6rem; }
  & .lg-feed-name { flex:1; font-weight:600; }
  & .lg-sheet { max-width:32rem; }
  & .lg-field { display:flex; flex-direction:column; gap:.25rem; margin:.4rem 0; min-width:0; }
  & .lg-input { padding:.4rem; border:1px solid #c9c2af; border-radius:.35rem; font:inherit; min-width:0; width:100%; box-sizing:border-box; }
  & .lg-row2 { display:grid; grid-template-columns:1fr 1fr; gap:.6rem; }
  & .lg-row3 { display:grid; grid-template-columns:1fr 1fr 1fr; gap:.6rem; }
  & .lg-pl-list { display:flex; flex-direction:column; gap:.4rem; max-width:520px; }
  & .lg-pl-row { display:flex; gap:.4rem; align-items:stretch; }
  & .lg-pl-open { flex:1; display:flex; align-items:center; justify-content:space-between; gap:.6rem; background:#fff; border:1px solid #d8d2c2; border-radius:.5rem; padding:.6rem .8rem; cursor:pointer; text-align:left; }
  & .lg-pl-open:hover { border-color:#8b5cf6; }
  & .lg-pl-name { font-weight:600; } & .lg-pl-id { font-family:ui-monospace,monospace; font-size:.72rem; opacity:.45; }
  & .lg-pl-edit, & .lg-pl-trash { background:#fff; border:1px solid #d8d2c2; border-radius:.5rem; padding:0 .7rem; cursor:pointer; font-size:1rem; }
  & .lg-pl-edit:hover { border-color:#8b5cf6; }
  & .lg-pl-trash:hover { background:#fbeae6; border-color:#b4452e; }
  & .lg-btn-grant { background:#2e9e5b; font-size:.75rem; padding:.25rem .55rem; }
  & .lg-playercard-focused { border-color:#8b5cf6; box-shadow:0 0 0 1px #8b5cf6 inset; }
  & .lg-inventory { display:flex; flex-direction:column; gap:.3rem; }
  & .lg-inv-row { display:flex; align-items:center; justify-content:space-between; gap:.5rem; background:#fff; border:1px solid #d8d2c2; border-radius:.4rem; padding:.35rem .6rem; }
  & .lg-inv-name { font-weight:600; }
  & .lg-modal-bg { position:absolute; inset:0; background:rgba(0,0,0,.45); display:flex; align-items:center; justify-content:center; z-index:50; }
  & .lg-modal { background:#fff; border-radius:.6rem; padding:1rem; width:min(92%,20rem); display:flex; flex-direction:column; gap:.6rem; align-items:center; text-align:center; }
  & .lg-modal qr-code { width:12rem; height:12rem; }
  & .lg-modal-actions { display:flex; justify-content:center; gap:.5rem; }
  & .lg-radio { display:inline-flex; align-items:center; gap:.25rem; font-size:.85rem; margin-right:.6rem; }
  & .lg-abilities { display:grid; grid-template-columns:repeat(auto-fit,minmax(4.5rem,1fr)); gap:.5rem; }
  & .lg-ability-field { margin:0; }
  & .lg-ability-field span { text-align:center; }
  & .lg-ability-field input { text-align:center; }
  & .lg-skills { display:flex; flex-direction:column; gap:.4rem; }
  & .lg-skill { display:grid; grid-template-columns:1fr auto 1fr; gap:.5rem; align-items:end; }
  & .lg-skill .lg-field { margin:0; }
  & .lg-skill-total { display:grid; place-content:center; font-size:1.3rem; font-weight:700; opacity:.6; padding:0 .4rem; }
  & .lg-skill-note { font-size:.82rem; }
  & .lg-hb-tabs { display:flex; flex-wrap:wrap; gap:.4rem; }
  /* .lg-tab defaults to white text for the dark topbar nav — these tabs sit
     on the sheet's white background instead, so they need their own
     light-theme colors rather than inheriting the dark-bg ones. */
  & .lg-hb-tabs .lg-tab { background:#eee; color:#333; }
  & .lg-hb-tabs .lg-tab.on { background:#8b5cf6; color:#fff; }
`)
