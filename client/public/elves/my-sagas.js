import { Self } from '@plan98/types'
import { del } from './plan98-wallet.js'
import { createSync } from './plan98-sync.js'

const tag = 'my-sagas'
const $ = Self(tag, {
  sessions: [],
  filter: '',
  loading: true,
})

// ── paths ─────────────────────────────────────────────────────────────────────

const MANIFEST_PATH = '/my-sagas/index.json'

export function sagaPath(id) { return `/my-sagas/${id}.saga` }
export function sessionPath(id) { return `/my-sagas/${id}.json` }

// ── pure converter ────────────────────────────────────────────────────────────

export function messagesToSaga(messages) {
  const toQuote = body => (body || '').split('\n').map(l => l.trim() ? `> ${l}` : '').join('\n')
  return messages.map(m => {
    if (m.saga) return m.body
    if (m.author === 'unassigned') return m.body
    if (m.tty || m.system) return m.body
    if (m.author === 'human') return `@ Me\n${toQuote(m.body)}`
    return `@ ${m.actor || 'Sagas'}\n${toQuote(m.body)}`
  }).filter(Boolean).join('\n\n')
}

// ── manifest (synced) ─────────────────────────────────────────────────────────

const _manifestSync = createSync(MANIFEST_PATH)

export async function listSessions() {
  const data = await _manifestSync.load()
  return data?.sessions || []
}

export async function upsertManifest(id, meta = {}) {
  const sessions = await listSessions()
  const idx = sessions.findIndex(s => s.id === id)
  const now = Date.now()
  if (idx === -1) sessions.unshift({ id, created: now, updated: now, ...meta })
  else { sessions[idx] = { ...sessions[idx], updated: now, ...meta }; sessions.sort((a, b) => b.updated - a.updated) }
  await _manifestSync.write({ sessions })
}

export async function removeFromManifest(id) {
  const sessions = await listSessions()
  await _manifestSync.write({ sessions: sessions.filter(s => s.id !== id) })
}

// ── saga text (synced plaintext via custom sync key) ─────────────────────────
// saga text is plain text not JSON so we handle it directly via WAS+braid

import { get, put, ensureSpace } from './plan98-wallet.js'

export async function getSaga(id) {
  await ensureSpace().catch(() => null)
  try {
    const blob = await get(sagaPath(id))
    return blob ? blob.text() : ''
  } catch { return '' }
}

export async function putSaga(id, text) {
  await ensureSpace().catch(() => null)
  await put(sagaPath(id), text, { type: 'text/plain' })
  fetch(`/sync${sagaPath(id)}`, {
    method: 'PUT',
    headers: { 'content-type': 'text/plain', 'Version': `"${Date.now()}"` },
    body: text,
  }).catch(() => null)
}

export function subscribeSaga(id, cb) {
  const es = new EventSource(`/sync${sagaPath(id)}`)
  es.onmessage = e => { if (e.data) cb(e.data) }
  es.onerror = () => {}
  return () => es.close()
}

// ── session (messages + history + saga export, synced) ────────────────────────

const _sessionSyncs = {}

function sessionSync(id) {
  if (!_sessionSyncs[id]) _sessionSyncs[id] = createSync(sessionPath(id))
  return _sessionSyncs[id]
}

export async function loadSession(id) {
  const data = await sessionSync(id).load()
  if (!data) return null
  const msgs = data.messages || []
  if (!msgs.some(m => m.author === 'human')) return null
  return { messages: msgs, history: data.history || [] }
}

export async function saveSession(id, { messages, history }) {
  await sessionSync(id).write({ messages, history })
  await put(sagaPath(id), messagesToSaga(messages), { type: 'text/plain' }).catch(() => null)
  await upsertManifest(id)
}

export function subscribeSession(id, cb) {
  return sessionSync(id).subscribe(data => {
    if (!data) return
    cb({ messages: data.messages || [], history: data.history || [] })
  })
}

export async function deleteSession(id) {
  await del(sessionPath(id)).catch(() => null)
  await del(sagaPath(id)).catch(() => null)
  await removeFromManifest(id)
  delete _sessionSyncs[id]
}

// ── flush queue (coalesces rapid saves) ───────────────────────────────────────

const _pending = {}
const _flushing = {}

export function scheduleFlush(id, data) {
  _pending[id] = data
  _flush(id)
}

async function _flush(id) {
  if (_flushing[id] || !_pending[id]) return
  _flushing[id] = true
  const data = _pending[id]
  _pending[id] = null
  try { await saveSession(id, data) } catch {}
  _flushing[id] = false
  _flush(id)
}

// ── elf UI ────────────────────────────────────────────────────────────────────

function escapeHyperText(s) {
  return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

function mount(target) {
  if (target._mounted) return
  target._mounted = true
  listSessions().then(sessions => {
    $.teach({ sessions, loading: false })
  })
}

$.draw(target => {
  mount(target)
  const { sessions, filter, loading } = $.learn()

  const shown = filter
    ? sessions.filter(s => (s.title || s.id).toLowerCase().includes(filter.toLowerCase()))
    : sessions

  return `
    <div class="ms-shell">
      <div class="ms-header">
        <div class="ms-title">my sagas</div>
        <input class="ms-filter" type="text" placeholder="filter…" value="${escapeHyperText(filter)}" data-filter>
      </div>
      <div class="ms-list">
        ${loading
          ? `<div class="ms-empty">loading…</div>`
          : shown.length === 0
            ? `<div class="ms-empty">${filter ? 'no matches' : 'no sagas yet'}</div>`
            : shown.map(s => `
              <div class="ms-item" data-id="${escapeHyperText(s.id)}">
                <span class="ms-label">${escapeHyperText(s.title || s.id.slice(0, 8))}</span>
                <span class="ms-meta">${s.updated ? new Date(s.updated).toLocaleDateString() : ''}</span>
                <div class="ms-actions">
                  <a class="ms-btn" href="/app/accessibility-mode?id=${escapeHyperText(s.id)}" target="_blank">read</a>
                  <a class="ms-btn" href="/app/drop-saga?id=${escapeHyperText(s.id)}" target="_blank">edit</a>
                  <button class="ms-btn -del" data-delete="${escapeHyperText(s.id)}">✕</button>
                </div>
              </div>`
            ).join('')
        }
      </div>
    </div>
  `
})

$.when('input', '[data-filter]', e => {
  $.teach({ filter: e.target.value })
})

$.when('click', '[data-delete]', async e => {
  const btn = e.target.closest('[data-delete]')
  if (!btn) return
  const id = btn.dataset.delete
  await deleteSession(id)
  const sessions = await listSessions()
  $.teach({ sessions })
})

$.style(`
  & {
    display: block;
    height: 100%;
    overflow: hidden;
    font-family: 'Recursive', monospace;
    background: #1a1a1a;
    color: #ccc;
  }
  & .ms-shell {
    display: grid;
    grid-template-rows: auto 1fr;
    height: 100%;
    overflow: hidden;
  }
  & .ms-header {
    padding: .75rem 1rem;
    background: #111;
    border-bottom: 1px solid #333;
    display: flex;
    align-items: center;
    gap: .75rem;
    flex-shrink: 0;
  }
  & .ms-title {
    font-size: .85rem;
    font-weight: 600;
    color: #fff;
    flex-shrink: 0;
  }
  & .ms-filter {
    flex: 1;
    background: #222;
    border: 1px solid #333;
    border-radius: 4px;
    color: #ccc;
    font-family: inherit;
    font-size: .8rem;
    padding: .3rem .6rem;
    outline: none;
  }
  & .ms-filter:focus { border-color: #555; }
  & .ms-list {
    overflow-y: auto;
    padding: .5rem;
    display: flex;
    flex-direction: column;
    gap: 2px;
  }
  & .ms-empty {
    padding: 1rem;
    font-size: .8rem;
    color: #444;
  }
  & .ms-item {
    display: flex;
    align-items: center;
    gap: .75rem;
    padding: .5rem .75rem;
    background: #111;
    border: 1px solid #222;
    border-radius: 6px;
  }
  & .ms-label {
    flex: 1;
    font-size: .85rem;
    color: #ddd;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  & .ms-meta {
    font-size: .7rem;
    color: #555;
    flex-shrink: 0;
  }
  & .ms-actions {
    display: flex;
    gap: 4px;
    flex-shrink: 0;
  }
  & .ms-btn {
    padding: 2px 8px;
    border: 1px solid #444;
    border-radius: 3px;
    background: transparent;
    color: #aaa;
    font-family: inherit;
    font-size: .75rem;
    cursor: pointer;
    text-decoration: none;
    display: inline-flex;
    align-items: center;
  }
  & .ms-btn:hover { border-color: #777; color: #fff; }
  & .ms-btn.-del { border-color: #522; color: #844; }
  & .ms-btn.-del:hover { border-color: #a44; color: #e66; }
`)
