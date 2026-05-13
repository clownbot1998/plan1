import { Self } from '@plan98/types'

const tag = 'wireguard-elf'
const $ = Self(tag, { peers: [], loading: true, error: null, adding: false, addName: '', qrPeer: null })

async function loadPeers() {
  $.teach({ loading: true, error: null })
  try {
    const res = await fetch('/api/wg/wireguard/client')
    if (res.status === 401) throw new Error('not authenticated — set PLAN1_PASSPHRASE and log in via /admin')
    if (res.status === 502) throw new Error('wireguard unavailable — is wg-easy running?')
    if (!res.ok) throw new Error(`peers returned ${res.status}`)
    const peers = await res.json()
    $.teach({ peers, loading: false })
  } catch (err) {
    $.teach({ loading: false, error: err.message })
  }
}

async function addPeer(name) {
  const res = await fetch('/api/wg/wireguard/client', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name }),
  })
  if (!res.ok) throw new Error(`add peer failed: ${res.status}`)
  await loadPeers()
}

async function deletePeer(id) {
  await fetch(`/api/wg/wireguard/client/${id}`, { method: 'DELETE' })
  await loadPeers()
}

async function togglePeer(id, enabled) {
  const action = enabled ? 'disable' : 'enable'
  await fetch(`/api/wg/wireguard/client/${id}/${action}`, { method: 'PUT' })
  await loadPeers()
}

function timeSince(iso) {
  if (!iso) return 'never'
  const ms = Date.now() - new Date(iso).getTime()
  const s = Math.floor(ms / 1000)
  if (s < 60) return `${s}s ago`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ago`
  return `${Math.floor(h / 24)}d ago`
}

loadPeers()

$.draw(() => {
  const { peers, loading, error, adding, addName, qrPeer } = $.learn()

  const qrModal = qrPeer ? `
    <div class="overlay">
      <div class="modal">
        <div class="modal-title">${qrPeer.name}</div>
        <img class="qr-img" src="/api/wg/wireguard/client/${qrPeer.id}/qrcode.svg" alt="QR code">
        <div class="modal-row">
          <a class="btn" href="/api/wg/wireguard/client/${qrPeer.id}/configuration" download="${qrPeer.name}.conf">download .conf</a>
          <button class="btn ghost" data-close-qr>close</button>
        </div>
      </div>
    </div>
  ` : ''

  const body = loading
    ? `<div class="status">loading peers...</div>`
    : error
    ? `<div class="status err">${error}</div>`
    : peers.length === 0
    ? `<div class="status">no peers yet — add one above</div>`
    : peers.map(p => `
      <div class="peer ${p.enabled ? 'on' : 'off'}">
        <div class="peer-left">
          <span class="peer-name">${p.name}</span>
          <span class="peer-ip">${p.address ?? ''}</span>
          <span class="peer-seen">${timeSince(p.latestHandshakeAt)}</span>
        </div>
        <div class="peer-actions">
          <button class="btn" data-qr="${p.id}" data-qr-name="${p.name}">qr</button>
          <button class="btn ${p.enabled ? 'disable' : 'enable'}" data-toggle="${p.id}" data-enabled="${p.enabled}">
            ${p.enabled ? 'disable' : 'enable'}
          </button>
          <button class="btn danger" data-delete="${p.id}" data-delete-name="${p.name}">del</button>
        </div>
      </div>
    `).join('')

  const addForm = adding ? `
    <div class="add-form">
      <input class="wg-input" type="text" placeholder="peer name" value="${addName}" data-add-input autofocus>
      <button class="btn ok" data-confirm-add>add</button>
      <button class="btn ghost" data-cancel-add>cancel</button>
    </div>
  ` : ''

  return `
    <style>
      ${tag} {
        display: block;
        background: #1d2021;
        color: #ebdbb2;
        font-family: 'Recursive', monospace;
        font-variation-settings: 'MONO' 1;
        height: 100%;
        box-sizing: border-box;
        overflow-y: auto;
        padding: 1rem;
      }
      ${tag} .header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        margin-bottom: 1rem;
        border-bottom: 1px solid #3c3836;
        padding-bottom: .75rem;
      }
      ${tag} .title { font-size: 1.1rem; color: #fabd2f; font-weight: 700; }
      ${tag} .btn {
        background: #3c3836; color: #ebdbb2; border: none;
        padding: .3rem .75rem; cursor: pointer; font-family: inherit;
        font-variation-settings: 'MONO' 1; font-size: .85rem; border-radius: 2px;
      }
      ${tag} .btn:hover { background: #504945; }
      ${tag} .btn.ghost { background: transparent; color: #928374; }
      ${tag} .btn.ghost:hover { color: #ebdbb2; }
      ${tag} .btn.ok { background: #98971a; color: #1d2021; }
      ${tag} .btn.danger { background: #cc241d; color: #fbf1c7; }
      ${tag} .btn.enable { background: #427b58; color: #fbf1c7; }
      ${tag} .btn.disable { background: #b57614; color: #1d2021; }
      ${tag} .status { color: #928374; padding: .5rem 0; }
      ${tag} .status.err { color: #fb4934; }
      ${tag} .peer {
        display: flex; align-items: center; justify-content: space-between;
        padding: .6rem .75rem; margin-bottom: .4rem;
        background: #282828; border-left: 3px solid #3c3836;
      }
      ${tag} .peer.on { border-left-color: #98971a; }
      ${tag} .peer.off { border-left-color: #504945; opacity: .7; }
      ${tag} .peer-left { display: flex; flex-direction: column; gap: .15rem; }
      ${tag} .peer-name { font-size: .95rem; color: #ebdbb2; }
      ${tag} .peer-ip { font-size: .75rem; color: #83a598; }
      ${tag} .peer-seen { font-size: .7rem; color: #928374; }
      ${tag} .peer-actions { display: flex; gap: .4rem; flex-shrink: 0; }
      ${tag} .add-form {
        display: flex; gap: .5rem; align-items: center;
        margin-bottom: .75rem; padding: .5rem;
        background: #282828;
      }
      ${tag} .wg-input {
        background: #1d2021; color: #ebdbb2; border: 1px solid #504945;
        padding: .3rem .5rem; font-family: inherit; font-size: .9rem;
        font-variation-settings: 'MONO' 1; flex: 1;
      }
      ${tag} .overlay {
        position: fixed; inset: 0; background: rgba(29,32,33,.85);
        display: flex; align-items: center; justify-content: center; z-index: 100;
      }
      ${tag} .modal {
        background: #282828; padding: 1.5rem; display: flex; flex-direction: column;
        gap: 1rem; align-items: center; min-width: 280px;
      }
      ${tag} .modal-title { font-size: 1rem; color: #fabd2f; }
      ${tag} .qr-img { width: 220px; height: 220px; display: block; }
      ${tag} .modal-row { display: flex; gap: .5rem; }
    </style>
    ${qrModal}
    <div class="header">
      <span class="title">wireguard</span>
      <div style="display:flex;gap:.5rem">
        <button class="btn ghost" data-refresh>↺ refresh</button>
        <button class="btn" data-add>+ peer</button>
      </div>
    </div>
    ${addForm}
    <div class="peers">${body}</div>
  `
})

$.when('click', `[data-add]`, () => $.teach({ adding: true, addName: '' }))
$.when('click', `[data-cancel-add]`, () => $.teach({ adding: false }))
$.when('click', `[data-refresh]`, loadPeers)

$.when('input', `[data-add-input]`, e => $.teach({ addName: e.target.value }))

$.when('keydown', `[data-add-input]`, e => {
  if (e.key === 'Enter') document.querySelector(`[data-confirm-add]`)?.click()
})

$.when('click', `[data-confirm-add]`, () => {
  const { addName } = $.learn()
  const name = addName.trim()
  if (!name) return
  $.teach({ adding: false })
  addPeer(name).catch(err => $.teach({ error: err.message }))
})

$.when('click', `[data-close-qr]`, () => $.teach({ qrPeer: null }))

$.when('click', `[data-qr]`, e => {
  const btn = e.target.closest('[data-qr]')
  if (!btn) return
  $.teach({ qrPeer: { id: btn.dataset.qr, name: btn.dataset.qrName } })
})

$.when('click', `[data-toggle]`, e => {
  const btn = e.target.closest('[data-toggle]')
  if (!btn) return
  const enabled = btn.dataset.enabled === 'true'
  togglePeer(btn.dataset.toggle, enabled).catch(err => $.teach({ error: err.message }))
})

$.when('click', `[data-delete]`, e => {
  const btn = e.target.closest('[data-delete]')
  if (!btn) return
  if (!confirm(`delete peer "${btn.dataset.deleteName}"?`)) return
  deletePeer(btn.dataset.delete).catch(err => $.teach({ error: err.message }))
})
