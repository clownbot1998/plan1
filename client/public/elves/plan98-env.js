import elf from '@plan98/elf'

// plan98-env — the live key store.
//
// The server injects `plan98.env` once, at page load, as a frozen snapshot.
// Elves that read `plan98.env.X` at module-load time capture that snapshot and
// can never see a rotated value. This module fixes that: it captures the server
// values as an immutable `baseEnv`, layers a localStorage-persisted *override*
// map on top, and resolves keys live on every read.
//
//   getEnv(key, fallback)  →  override ?? serverEnv ?? fallback   (read fresh)
//   setEnv(key, value)     →  persist + live-patch plan98.env + fire rotation
//   clearEnv(key)          →  drop override, restore server value
//   onEnvChange(fn)        →  subscribe; rebuild instantiated clients in here
//
// Migration: replace `plan98.env.X` with `getEnv('X', default)`. For clients
// that cache a constructed instance (SDK wrappers), also subscribe via
// onEnvChange and rebuild so rotations take effect without a reload.

if (typeof window !== 'undefined' && !window.plan98) window.plan98 = { env: {}, registry: {} }
const PLAN98 = (typeof window !== 'undefined' && window.plan98) || { env: {} }

// immutable copy of whatever the server injected — the floor under every key
const baseEnv = { ...(PLAN98.env || {}) }

const LS_KEY = 'plan98-env-overrides'
function loadOverrides() {
  try { return JSON.parse(localStorage.getItem(LS_KEY)) || {} } catch { return {} }
}
function persist() {
  try { localStorage.setItem(LS_KEY, JSON.stringify(overrides)) } catch {}
}

const overrides = loadOverrides()

// live-patch the global so un-migrated direct readers of plan98.env.X that load
// *after* us still see overrides (best-effort; migrate them to getEnv to be safe)
Object.assign(PLAN98.env, overrides)

function has(v) { return v !== undefined && v !== null && v !== '' }

export function getEnv(key, fallback = undefined) {
  if (has(overrides[key])) return overrides[key]
  if (has(baseEnv[key])) return baseEnv[key]
  return fallback
}

export function setEnv(key, value) {
  overrides[key] = value
  persist()
  PLAN98.env[key] = value
  emit(key, value)
  return value
}

export function clearEnv(key) {
  delete overrides[key]
  persist()
  PLAN98.env[key] = baseEnv[key]
  const value = getEnv(key)
  emit(key, value)
  return value
}

function emit(key, value) {
  if (typeof window === 'undefined') return
  window.dispatchEvent(new CustomEvent('plan98:env', { detail: { key, value } }))
}

// subscribe to rotations. fn(key, value). returns an unsubscribe thunk.
export function onEnvChange(fn) {
  const handler = (e) => fn(e.detail.key, e.detail.value)
  window.addEventListener('plan98:env', handler)
  return () => window.removeEventListener('plan98:env', handler)
}

export function envKeys() {
  return Array.from(new Set([...Object.keys(baseEnv), ...Object.keys(overrides)])).sort()
}

export function isSecret(key) {
  return /KEY|SECRET|TOKEN|PASS|SIGNER/i.test(key)
}

export function sourceOf(key) {
  if (has(overrides[key])) return 'override'
  if (has(baseEnv[key])) return 'env'
  return 'unset'
}

function mask(value) {
  if (!has(value)) return ''
  const s = String(value)
  if (s.length <= 4) return '••••'
  return '••••' + s.slice(-4)
}

// --- end-user override UI ---

const tag = 'plan98-env'
const $ = elf(tag, { rev: 0 })

onEnvChange(() => $.teach({ rev: $.learn().rev + 1 }))

$.draw(() => {
  const rows = envKeys().map(key => {
    const src = sourceOf(key)
    const secret = isSecret(key)
    const effective = getEnv(key)
    const shown = secret ? mask(effective) : (has(effective) ? effective : '')
    const ov = overrides[key]
    return `
      <div class="env-row" data-key="${key}">
        <div class="env-meta">
          <span class="env-key">${key}</span>
          <span class="env-src env-src-${src}">${src}</span>
        </div>
        <div class="env-effective">${shown || '<em>unset</em>'}</div>
        <div class="env-edit">
          <input class="env-input" type="${secret ? 'password' : 'text'}"
                 placeholder="${src === 'override' ? 'override active' : 'set override…'}"
                 value="${secret ? '' : (has(ov) ? ov : '')}" />
          <button class="env-save standard-button bias-positive">Save</button>
          <button class="env-clear standard-button bias-generic" ${has(ov) ? '' : 'disabled'}>Clear</button>
        </div>
      </div>`
  }).join('')

  return `
    <div class="env-wrap">
      <div class="env-head">
        <strong>live env</strong>
        <span class="env-note">override → server → default · rotates in real-time · stored in this browser</span>
      </div>
      <div class="env-list">${rows}</div>
    </div>`
})

$.when('click', '.env-save', (event) => {
  const row = event.target.closest('.env-row')
  const key = row.getAttribute('data-key')
  const input = row.querySelector('.env-input')
  const value = input.value
  if (!has(value)) return
  setEnv(key, value)
  input.value = ''
})

$.when('click', '.env-clear', (event) => {
  const row = event.target.closest('.env-row')
  clearEnv(row.getAttribute('data-key'))
})

$.style(`
  & {
    display: block;
    height: 100%;
    overflow: auto;
    padding: 1rem;
    font-family: 'Recursive', system-ui, sans-serif;
  }
  & .env-head {
    display: flex;
    flex-direction: column;
    gap: .25rem;
    margin-bottom: 1rem;
  }
  & .env-note { opacity: .6; font-size: .8rem; }
  & .env-list { display: flex; flex-direction: column; gap: .75rem; }
  & .env-row {
    border: 1px solid rgba(128,128,128,.3);
    border-radius: .4rem;
    padding: .6rem .75rem;
    display: flex;
    flex-direction: column;
    gap: .4rem;
  }
  & .env-meta { display: flex; align-items: center; gap: .5rem; }
  & .env-key { font-weight: 600; word-break: break-all; }
  & .env-src {
    font-size: .65rem;
    text-transform: uppercase;
    letter-spacing: .05em;
    padding: .1rem .4rem;
    border-radius: .25rem;
    opacity: .85;
  }
  & .env-src-override { background: #2e7d32; color: white; }
  & .env-src-env { background: #555; color: white; }
  & .env-src-unset { background: #b71c1c; color: white; }
  & .env-effective {
    font-family: ui-monospace, monospace;
    font-size: .85rem;
    opacity: .8;
    word-break: break-all;
  }
  & .env-edit { display: flex; gap: .4rem; flex-wrap: wrap; }
  & .env-input {
    flex: 1 1 12rem;
    min-width: 0;
    padding: .35rem .5rem;
    border: 1px solid rgba(128,128,128,.4);
    border-radius: .3rem;
    font-family: ui-monospace, monospace;
  }
`)
