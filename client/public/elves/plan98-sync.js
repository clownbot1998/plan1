import { get, put, ensureSpace } from './plan98-wallet.js'

// ── createSync(key, options) ──────────────────────────────────────────────────
//
// Unified snapshot + live-patch store for any JSON-able resource.
//
// key      — WAS path AND /sync/ braid key, e.g. '/my-sagas/abc.json'
// options  — { merge(current, incoming) → next }  default: replace
//
// Returns { load, write, subscribe, destroy }
//
//   load()             → Promise<data | null>   WAS snapshot, null if absent
//   write(data)        → Promise<void>          WAS put + braid broadcast
//   subscribe(cb)      → unsubscribe fn         cb(data) on each live patch
//   destroy()          → void                   close SSE + all subs

export function createSync(key, { merge = (_cur, next) => next } = {}) {
  const syncUrl = `/sync${key}`
  let _es = null
  const _subs = new Set()
  let _current = null

  function _notify(data) {
    _current = data
    for (const cb of _subs) cb(data)
  }

  function _parse(text) {
    if (!text || !text.trim()) return null
    try { return JSON.parse(text) } catch { return null }
  }

  function _openSSE() {
    if (_es) return
    _es = new EventSource(syncUrl)
    _es.onmessage = e => {
      const incoming = _parse(e.data)
      if (incoming === null) return
      _notify(merge(_current, incoming))
    }
    _es.onerror = () => {
      _es?.close()
      _es = null
      setTimeout(_openSSE, 2000)
    }
  }

  return {
    async load() {
      await ensureSpace().catch(() => null)
      try {
        const blob = await get(key)
        if (!blob) return null
        const data = _parse(await blob.text())
        if (data !== null) _current = data
        return data
      } catch { return null }
    },

    async write(data) {
      _current = data
      const text = JSON.stringify(data)
      await ensureSpace().catch(() => null)
      await Promise.all([
        put(key, text, { type: 'application/json' }).catch(() => null),
        fetch(syncUrl, {
          method: 'PUT',
          headers: { 'content-type': 'application/json', 'Version': `"${Date.now()}"` },
          body: text,
        }).catch(() => null),
      ])
    },

    subscribe(cb) {
      _subs.add(cb)
      _openSSE()
      return () => _subs.delete(cb)
    },

    destroy() {
      _subs.clear()
      _es?.close()
      _es = null
    },
  }
}
