import { Self } from '@plan98/types'
import JSZip from 'jszip'
import lunr from 'lunr'
import { put, get, ensureSpace } from './plan98-wallet.js'
import { warm } from './was-image.js'
import {
  getSaga, putSaga, listSessions, upsertManifest, removeFromManifest,
} from './my-sagas.js'

const tag = 'drop-saga'
const $ = Self(tag, {
  tab: 'home',
  id: null,
  files: [],
  uploading: false,
  done: 0,
  total: 0,
  sagaText: null,
  sagaIndex: null,
  manifestSagas: null,
  sagaSearch: '',
})

function mediaManifestPath(id) { return `/drop-saga/${id}/manifest.json` }

function mimeFor(ext) {
  const map = {
    jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', gif: 'image/gif',
    webp: 'image/webp', heic: 'image/heic', heif: 'image/heif', avif: 'image/avif',
    mp4: 'video/mp4', webm: 'video/webm', mov: 'video/quicktime',
    mp3: 'audio/mpeg', ogg: 'audio/ogg', wav: 'audio/wav',
  }
  return map[ext] || 'application/octet-stream'
}

function isVideo(mime) { return mime.startsWith('video/') || mime.startsWith('audio/') }

async function loadIndex() {
  const entries = await listSessions()
  $.teach({ sagaIndex: entries }, (s, p) => ({ ...s, ...p }))
  return entries
}

async function registerSaga(id, fileCount, label = '') {
  await upsertManifest(id, { label, fileCount })
  const entries = await listSessions()
  $.teach({ sagaIndex: entries }, (s, p) => ({ ...s, ...p }))
}

function navigateTo(id, tab = 'home') {
  history.replaceState(null, '', `?id=${id}`)
  document.querySelectorAll(tag).forEach(el => { el._mountedId = null })
  $.teach({ id: null, tab, files: [], sagaText: null, uploading: false, done: 0, total: 0, sagaIndex: null }, (s, p) => ({ ...s, ...p }))
}

let _lunrIndex = null
let _manifestDocs = null

async function loadManifestSagas() {
  if (_manifestDocs) {
    $.teach({ manifestSagas: _manifestDocs }, (s, p) => ({ ...s, ...p }))
    return
  }
  try {
    const res = await fetch('/search-manifest.json')
    const all = await res.json()
    const sagas = all.filter(d => d.type === 'saga')
    _manifestDocs = sagas
    _lunrIndex = lunr(function() {
      this.ref('ref')
      this.field('name', { boost: 10 })
      this.field('keywords')
      sagas.forEach(d => this.add(d))
    })
    $.teach({ manifestSagas: sagas }, (s, p) => ({ ...s, ...p }))
  } catch {
    $.teach({ manifestSagas: [] }, (s, p) => ({ ...s, ...p }))
  }
}

function searchSagas(query) {
  if (!query || !_lunrIndex || !_manifestDocs) return _manifestDocs || []
  try {
    return _lunrIndex.search(query).map(r => _manifestDocs.find(d => d.ref === r.ref)).filter(Boolean)
  } catch {
    return _manifestDocs || []
  }
}

async function createFromTemplate(sagaText, label = '') {
  await ensureSpace().catch(() => null)
  const id = crypto.randomUUID()
  await putSaga(id, sagaText)
  await registerSaga(id, 0, label)
  navigateTo(id, 'edit')
}

function mount(target) {
  const attr = target.getAttribute('saga-id')
    || new URLSearchParams(window.location.search).get('id')
  const storageKey = `drop-saga-id:${attr || 'default'}`
  let id = attr || localStorage.getItem(storageKey)
  if (!id) { id = crypto.randomUUID(); localStorage.setItem(storageKey, id) }
  if (target._mountedId === id) return
  target._mountedId = id

  $.teach({ id, files: [], sagaText: null, uploading: false, done: 0, total: 0, sagaIndex: null }, (s, p) => ({ ...s, ...p }))

  get(mediaManifestPath(id))
    .then(blob => blob.text())
    .then(text => {
      const files = JSON.parse(text)
      $.teach({ files }, (s, p) => ({ ...s, ...p }))
      files.forEach(f => warm(f.path))
    })
    .catch(() => {})

  loadIndex()
  loadSagaText(id)
  loadManifestSagas()
}

async function saveManifest(id, files) {
  await put(mediaManifestPath(id), JSON.stringify(files), { type: 'application/json' })
}

async function writeSaga(id, files) {
  const lines = files.map(f => {
    if (isVideo(f.mime)) {
      return `<was-video\nsrc: ${f.path}\nautoplay: true`
    }
    return `<was-image\nsrc: ${f.path}`
  }).join('\n\n')
  await putSaga(id, lines)
}

async function processFiles(incoming) {
  await ensureSpace().catch(() => null)
  const { id, files: existing } = $.learn()
  $.teach({ uploading: true, done: 0, total: incoming.length }, (s, p) => ({ ...s, ...p }))

  const uploaded = []
  for (const { name, blob, mime } of incoming) {
    const path = `/drop-saga/${id}/${name}`
    await put(path, blob, { type: mime })
    uploaded.push({ name, path, mime })
    $.teach({ done: uploaded.length }, (s, p) => ({ ...s, ...p }))
  }

  const all = [...existing, ...uploaded]
  await saveManifest(id, all)
  await writeSaga(id, all)
  $.teach({ uploading: false, files: all }, (s, p) => ({ ...s, ...p }))
  uploaded.forEach(f => warm(f.path))
  await registerSaga(id, all.length)
}

function isDotfile(name) {
  const base = name.replace(/^.*[\\/]/, '')
  return base.startsWith('.') || name.includes('__MACOSX')
}

async function importZip(file) {
  const zip = await JSZip.loadAsync(file)
  const entries = Object.values(zip.files).filter(f => !f.dir && !isDotfile(f.name))
  const incoming = await Promise.all(entries.map(async entry => {
    const ext = entry.name.split('.').pop().toLowerCase()
    const mime = mimeFor(ext)
    const blob = await entry.async('blob')
    return { name: entry.name.replace(/^.*[\\/]/, ''), blob, mime }
  }))
  await processFiles(incoming)
}

async function importFileList(fileList) {
  const incoming = Array.from(fileList)
    .filter(f => !isDotfile(f.name))
    .map(file => {
      const ext = file.name.split('.').pop().toLowerCase()
      return { name: file.name, blob: file, mime: mimeFor(ext) }
    })
  await processFiles(incoming)
}

async function loadSagaText(id) {
  const text = await getSaga(id)
  $.teach({ sagaText: text }, (s, p) => ({ ...s, ...p }))
}

async function exportZip() {
  const { id, files } = $.learn()
  const zip = new JSZip()
  for (const f of files) {
    const blob = await get(f.path)
    zip.file(f.name, blob)
  }
  const blob = await zip.generateAsync({ type: 'blob' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `drop-saga-${id.slice(0, 8)}.zip`
  a.click()
  URL.revokeObjectURL(url)
}

let _pitchUrl = null
let _pitchText = null

$.draw(target => {
  mount(target)
  const { tab, id, files, uploading, done, total, sagaText, sagaIndex, manifestSagas, sagaSearch } = $.learn()
  if (!id) return ''

  const nav = ['home', 'manage', 'edit', 'present', 'accessibility'].map(t =>
    `<button class="ds-tab${tab === t ? ' -active' : ''}" data-tab="${t}">${t}</button>`
  ).join('')

  let content = ''

  if (tab === 'home') {
    const indexList = sagaIndex === null
      ? `<div class="ds-section-loading">loading sagas…</div>`
      : sagaIndex.length === 0
        ? `<div class="ds-section-empty">no sagas yet — import something or start from a template</div>`
        : sagaIndex.map(entry => {
            const active = entry.id === id ? ' -active' : ''
            const label = entry.label || entry.id.slice(0, 8)
            const meta = entry.fileCount ? `${entry.fileCount} files` : 'no files'
            return `<button class="ds-saga-item${active}" data-goto-saga="${entry.id}"><span class="ds-saga-name">${label}</span><span class="ds-saga-meta">${meta}</span></button>`
          }).join('')

    content = `
      <div class="ds-landing">
        <div class="ds-interlude">
          <div class="ds-interlude-title">drop-saga</div>
          <div class="ds-interlude-sub">drop media. write the order. present it.</div>
        </div>
        <div class="ds-steps">
          <div class="ds-step">
            <div class="ds-step-num">01</div>
            <div class="ds-step-label">import</div>
            <div class="ds-step-body">drop a zip or pick files from disk. images and video land in your wallet-attached storage space — persistent, portable, exportable back to zip any time.</div>
            <button class="ds-btn -hero" data-tab="manage">go to manage →</button>
          </div>
          <div class="ds-step">
            <div class="ds-step-num">02</div>
            <div class="ds-step-label">organize</div>
            <div class="ds-step-body">the saga is a plaintext script. each entry is a media element with attributes. reorder, annotate, add text slides, mix images and video. what you write is what plays.</div>
            <button class="ds-btn -hero" data-tab="edit">go to edit →</button>
          </div>
          <div class="ds-step">
            <div class="ds-step-num">03</div>
            <div class="ds-step-label">present</div>
            <div class="ds-step-body">saga-pitch renders the script one slide at a time with animated transitions. gamepad-navigable. keyboard-driven. the format is the stage.</div>
            <button class="ds-btn -hero" data-tab="present">go to present →</button>
          </div>
        </div>
        <div class="ds-section">
          <div class="ds-section-label">your sagas</div>
          <div class="ds-saga-list">${indexList}</div>
          <button class="ds-btn ds-new-btn" data-new-saga>+ new saga</button>
        </div>
        <div class="ds-section">
          <div class="ds-section-label">saga library</div>
          ${manifestSagas === null
            ? '<div class="ds-section-loading">loading library…</div>'
            : `<input class="ds-search-input" placeholder="search sagas…" data-saga-search />
               <div class="ds-template-grid">${
                 (sagaSearch ? searchSagas(sagaSearch) : manifestSagas).map(s =>
                   `<button class="ds-template-card" data-use-manifest="${encodeURIComponent(s.path)}"><span class="ds-template-name">${s.name}</span><span class="ds-template-desc">${s.ref}</span></button>`
                 ).join('') || '<span class="ds-section-empty">no results</span>'
               }</div>`
          }
        </div>
      </div>`
  }

  if (tab === 'manage') {
    const progress = uploading
      ? `<div class="ds-progress"><div class="ds-bar" style="width:${Math.round(done / total * 100)}%"></div><span>${done}/${total}</span></div>`
      : ''
    const list = files.length
      ? `<ul class="ds-file-list">${files.map(f => `<li>${f.name}</li>`).join('')}</ul>`
      : ''
    content = `
      <div class="ds-home">
        <div class="ds-drop-zone" data-dropzone>
          <p>drop a <strong>.zip</strong> of media here</p>
          <p>or</p>
          <label class="ds-btn">pick files<input type="file" multiple accept="image/*,video/*,.heic,.heif,.zip" data-file-pick hidden /></label>
        </div>
        ${progress}
        ${files.length ? `<button class="ds-btn" data-export>export zip (${files.length} files)</button>` : ''}
        ${files.length ? `<button class="ds-btn" data-regen>regenerate saga</button>` : ''}
        ${list}
      </div>`
  }

  if (tab === 'edit') {
    content = sagaText === null
      ? `<div class="ds-slide-loading">loading…</div>`
      : `<textarea class="ds-textarea" placeholder="saga text…" spellcheck="false"></textarea>`
  }

  if (tab === 'present') {
    if (sagaText !== null) {
      if (sagaText !== _pitchText) {
        if (_pitchUrl) URL.revokeObjectURL(_pitchUrl)
        _pitchUrl = URL.createObjectURL(new Blob([sagaText], { type: 'text/plain' }))
        _pitchText = sagaText
      }
      content = `<div class="ds-present"><saga-pitch src="${_pitchUrl}"></saga-pitch></div>`
    } else {
      content = `<div class="ds-slide-loading">loading…</div>`
    }
  }

  if (tab === 'accessibility') {
    content = `<div class="ds-access"><accessibility-mode saga-id="${id}"></accessibility-mode></div>`
  }

  return `
    <div class="ds-shell">
      <nav class="ds-nav">${nav}</nav>
      <div class="ds-content">${content}</div>
    </div>`
}, {
  afterUpdate: target => {
    const { tab, sagaText, sagaSearch } = $.learn()
    if (tab === 'edit') {
      const ta = target.querySelector('.ds-textarea')
      if (ta && ta !== document.activeElement && sagaText !== null && ta.value !== sagaText) ta.value = sagaText
    }
    const si = target.querySelector('[data-saga-search]')
    if (si && si !== document.activeElement && si.value !== sagaSearch) si.value = sagaSearch
  }
})

$.when('click', '[data-tab]', e => {
  const t = e.target.dataset.tab
  const { id, sagaText } = $.learn()
  $.teach({ tab: t }, (s, p) => ({ ...s, ...p }))
  if ((t === 'edit' || t === 'present') && sagaText === null) {
    loadSagaText(id)
  }
})

// keep sagaText in sync when returning from accessibility tab
$.when('click', '[data-tab="edit"], [data-tab="present"]', () => {
  const { id } = $.learn()
  loadSagaText(id)
})

$.when('click', '[data-goto-saga]', e => {
  const btn = e.target.closest('[data-goto-saga]')
  if (!btn) return
  navigateTo(btn.dataset.gotoSaga, 'edit')
})

$.when('click', '[data-new-saga]', () => {
  navigateTo(crypto.randomUUID(), 'manage')
})

$.when('click', '[data-use-manifest]', async e => {
  const btn = e.target.closest('[data-use-manifest]')
  if (!btn) return
  const path = decodeURIComponent(btn.dataset.useManifest)
  const name = btn.querySelector('.ds-template-name')?.textContent || ''
  const res = await fetch(path)
  const text = await res.text()
  await createFromTemplate(text, name)
})

$.when('input', '[data-saga-search]', e => {
  $.teach({ sagaSearch: e.target.value }, (s, p) => ({ ...s, ...p }))
})

$.when('input', '.ds-textarea', e => {
  const { id } = $.learn()
  const text = e.target.value
  putSaga(id, text)
  $.teach({ sagaText: text }, (s, p) => ({ ...s, ...p }))
})

$.when('click', '[data-export]', exportZip)

$.when('click', '[data-regen]', async () => {
  const { id, files } = $.learn()
  await writeSaga(id, files)
})

$.when('dragover', '[data-dropzone]', e => {
  e.preventDefault()
  e.target.closest('[data-dropzone]').classList.add('-over')
})

$.when('dragleave', '[data-dropzone]', e => {
  e.target.closest('[data-dropzone]')?.classList.remove('-over')
})

$.when('drop', '[data-dropzone]', async e => {
  e.preventDefault()
  e.target.closest('[data-dropzone]')?.classList.remove('-over')
  const items = Array.from(e.dataTransfer.files)
  const zip = items.find(f => f.name.endsWith('.zip'))
  if (zip) { importZip(zip); return }
  if (items.length) importFileList(items)
})

$.when('change', '[data-file-pick]', async e => {
  const files = Array.from(e.target.files)
  const zip = files.find(f => f.name.endsWith('.zip'))
  if (zip) { importZip(zip); return }
  if (files.length) importFileList(files)
})

$.style(`
  & {
    display: block;
    height: 100%;
    overflow: hidden;
  }
  & .ds-shell {
    display: grid;
    grid-template-rows: auto 1fr;
    height: 100%;
    font-family: 'Recursive', monospace;
    background: #1a1a1a;
    color: #ccc;
    overflow: hidden;
  }
  & .ds-nav {
    display: flex;
    gap: 2px;
    padding: 4px 8px;
    background: #111;
    border-bottom: 1px solid #333;
    flex-shrink: 0;
  }
  & .ds-tab {
    padding: 4px 12px;
    background: transparent;
    border: none;
    color: #aaa;
    cursor: pointer;
    font-family: inherit;
    font-size: .85rem;
    border-radius: 4px;
  }
  & .ds-tab.-active {
    background: #222;
    color: #fff;
  }
  & .ds-content {
    overflow: hidden;
    display: grid;
    min-height: 0;
  }
  & .ds-textarea {
    display: block;
    width: 100%;
    height: 100%;
    resize: none;
    background: #111;
    color: #ccc;
    border: none;
    padding: 1rem;
    box-sizing: border-box;
    font-family: 'Recursive', monospace;
    font-size: .85rem;
    line-height: 1.6;
    outline: none;
  }
  & .ds-landing {
    height: 100%;
    overflow-y: auto;
    padding: 2rem;
    display: flex;
    flex-direction: column;
    gap: 2rem;
    box-sizing: border-box;
  }
  & .ds-interlude {
    padding: 2rem 0 1rem;
  }
  & .ds-interlude-title {
    font-size: 2.5rem;
    font-weight: 700;
    color: #fff;
    letter-spacing: -.02em;
  }
  & .ds-interlude-sub {
    font-size: 1rem;
    color: #777;
    margin-top: .4rem;
  }
  & .ds-steps {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
    gap: 1.5rem;
  }
  & .ds-step {
    background: #111;
    border: 1px solid #222;
    border-radius: 8px;
    padding: 1.5rem;
    display: flex;
    flex-direction: column;
    gap: .75rem;
  }
  & .ds-step-num {
    font-size: .7rem;
    color: #555;
    letter-spacing: .1em;
  }
  & .ds-step-label {
    font-size: 1.2rem;
    font-weight: 600;
    color: #ddd;
  }
  & .ds-step-body {
    font-size: .8rem;
    color: #777;
    line-height: 1.6;
    flex: 1;
  }
  & .ds-btn.-hero {
    margin-top: .5rem;
    border-color: #444;
    color: #ccc;
  }
  & .ds-section {
    display: flex;
    flex-direction: column;
    gap: .75rem;
  }
  & .ds-section-label {
    font-size: .7rem;
    color: #555;
    letter-spacing: .1em;
    text-transform: uppercase;
  }
  & .ds-section-loading,
  & .ds-section-empty {
    font-size: .8rem;
    color: #444;
  }
  & .ds-saga-list {
    display: flex;
    flex-direction: column;
    gap: 2px;
  }
  & .ds-saga-item {
    display: flex;
    align-items: center;
    gap: 1rem;
    padding: .5rem .75rem;
    background: #111;
    border: 1px solid #222;
    border-radius: 6px;
    cursor: pointer;
    font-family: inherit;
    color: #bbb;
    text-align: left;
    transition: background .1s, border-color .1s;
  }
  & .ds-saga-item:hover {
    background: #1e1e1e;
    border-color: #333;
  }
  & .ds-saga-item.-active {
    border-color: #444;
    color: #fff;
  }
  & .ds-saga-name {
    font-size: .85rem;
    flex: 1;
    pointer-events: none;
  }
  & .ds-saga-meta {
    font-size: .75rem;
    color: #555;
    pointer-events: none;
  }
  & .ds-new-btn {
    align-self: flex-start;
  }
  & .ds-search-input {
    width: 100%;
    box-sizing: border-box;
    background: #111;
    border: 1px solid #333;
    border-radius: 6px;
    color: #ccc;
    font-family: inherit;
    font-size: .85rem;
    padding: .5rem .75rem;
    outline: none;
  }
  & .ds-search-input:focus {
    border-color: #555;
  }
  & .ds-template-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(160px, 1fr));
    gap: 1rem;
  }
  & .ds-template-card {
    display: flex;
    flex-direction: column;
    gap: .4rem;
    padding: 1rem;
    background: #111;
    border: 1px solid #222;
    border-radius: 8px;
    cursor: pointer;
    font-family: inherit;
    color: inherit;
    text-align: left;
    transition: background .1s, border-color .1s;
  }
  & .ds-template-card:hover {
    background: #1e1e1e;
    border-color: #444;
  }
  & .ds-template-name {
    font-size: .9rem;
    font-weight: 600;
    color: #ddd;
    pointer-events: none;
  }
  & .ds-template-desc {
    font-size: .75rem;
    color: #666;
    line-height: 1.4;
    pointer-events: none;
  }
  & .ds-present {
    height: 100%;
    overflow: hidden;
  }
  & .ds-present saga-pitch {
    display: block;
    height: 100%;
  }
  & .ds-home {
    padding: 1rem;
    display: flex;
    flex-direction: column;
    gap: 1rem;
    overflow-y: auto;
    max-width: 560px;
  }
  & .ds-drop-zone {
    border: 2px dashed #444;
    border-radius: 8px;
    padding: 2rem;
    text-align: center;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: .5rem;
    color: #aaa;
    transition: border-color .15s, background .15s;
  }
  & .ds-drop-zone.-over {
    border-color: mediumseagreen;
    background: color-mix(in srgb, mediumseagreen 8%, transparent);
  }
  & .ds-btn {
    display: inline-flex;
    align-items: center;
    padding: 6px 16px;
    border: 1px solid #555;
    border-radius: 4px;
    background: transparent;
    color: inherit;
    cursor: pointer;
    font-family: inherit;
    font-size: .85rem;
    gap: .5rem;
  }
  & .ds-progress {
    display: flex;
    align-items: center;
    gap: .5rem;
    font-size: .8rem;
    color: #aaa;
  }
  & .ds-bar {
    flex: 1;
    height: 4px;
    background: mediumseagreen;
    border-radius: 2px;
    transition: width .15s;
  }
  & .ds-file-list {
    list-style: none;
    padding: 0;
    margin: 0;
    font-size: .75rem;
    color: #777;
    display: flex;
    flex-direction: column;
    gap: 2px;
    max-height: 40vh;
    overflow-y: auto;
  }
  & .ds-slide-loading {
    color: #555;
    font-size: .85rem;
    padding: 1rem;
  }
  & .ds-access {
    height: 100%;
    overflow: hidden;
  }
  & .ds-access accessibility-mode {
    display: block;
    height: 100%;
  }
`)
