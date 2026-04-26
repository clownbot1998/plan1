import { Self } from '@plan98/types'

const tag = 'preview-gallery'
const $ = Self(tag)

// ── helpers ───────────────────────────────────────────────────────────────────

function screenshotUrl(galleryId, itemId) {
  return `/private/screenshots/${galleryId}/${itemId}.png`
}

function CopyButton(id, text) {
  return `
    <span id="copy-${id}" style="position:absolute;opacity:0;pointer-events:none">${text}</span>
    <button class="copy-btn" data-copy="copy-${id}">copy</button>
  `
}

// ── draw ──────────────────────────────────────────────────────────────────────

$.draw(target => {
  const { items, loading, error, saved } = $.learn()
  const galleryId = target.id
  const admin = target.getAttribute('admin') === 'true'

  if (!galleryId) return `<div class="msg">no id set</div>`

  if (!items && !loading && !error) {
    setTimeout(() => loadConfig(galleryId), 0)
    return `<div class="msg">loading...</div>`
  }
  if (loading) return `<div class="msg">loading...</div>`
  if (error)   return `<div class="msg error">${error}</div>`

  const list = items ?? []

  const { darkroom } = $.learn()

  if (darkroom) return `
    <div class="darkroom">
      <img class="dr-img" src="${darkroom}" />
    </div>
  `

  if (admin) return `
    <div class="admin">
      <h2 class="admin-title">preview-gallery / ${galleryId}</h2>
      <form class="table" data-gallery="${galleryId}">
        <button class="add-btn" type="submit">add</button>
        <label class="field"><input class="inp" name="id" placeholder="item-id" value="${$.learn().draftId ?? ''}" /></label>
        <label class="field"><input class="inp" name="url" placeholder="/app/dial-tone" value="${$.learn().draftUrl ?? ''}" /></label>
        ${list.map(item => {
          const src = screenshotUrl(galleryId, item.id)
          return `
          <div class="row-actions">
            <button class="admin-thumb" data-src="${src}" title="${item.id}">
              <img src="${src}" alt="${item.id}" />
            </button>
            ${CopyButton(`${galleryId}-${item.id}`, src)}
            <button class="dup-btn" data-dup-id="${item.id}" data-dup-url="${item.url}" title="duplicate">⧉</button>
          </div>
          <div class="mono">${item.id}</div>
          <div class="url-cell">
            <span>${item.url}</span>
            <button class="rm-btn" data-remove="${item.id}">×</button>
          </div>
        `}).join('')}
      </form>
      ${saved ? `<div class="msg ok">saved.</div>` : ''}
    </div>
  `

  return `
    <div class="gallery">
      ${list.length === 0 ? `<div class="msg">no items — add some at ?admin=true</div>` : ''}
      ${list.map(item => {
        const src = screenshotUrl(galleryId, item.id)
        return `<button class="thumb" data-src="${src}" title="${item.id}">
          <img src="${src}" alt="${item.id}" loading="lazy" />
        </button>`
      }).join('')}
    </div>
  `
})

// ── config io ─────────────────────────────────────────────────────────────────

async function loadConfig(galleryId) {
  $.teach({ loading: true, error: null })
  try {
    const res = await fetch(`/preview-gallery/${galleryId}/index.json`)
    if (res.ok) {
      const items = (await res.json()).items ?? []
      $.teach({ loading: false, items })
    } else {
      // no config yet — seed from sticky-menu's curated app list
      const items = [
        { id: 'lore-baby',   url: '/app/lore-baby' },
        { id: 'source-code', url: '/app/source-code' },
        { id: 'ur-shell',    url: '/app/ur-shell' },
        { id: 'private-ai',  url: '/app/private-ai' },
        { id: 'flip-book',   url: '/app/flip-book' },
        { id: 'my-computer', url: '/app/my-computer' },
        { id: 'paper-pocket',url: '/app/paper-pocket' },
        { id: 'multi-task',  url: '/app/multi-task' },
      ]
      $.teach({ loading: false, items })
    }
  } catch(e) {
    $.teach({ loading: false, error: e.message, items: [] })
  }
}

async function saveConfig(galleryId, items) {
  const res = await fetch(`/preview-gallery/${galleryId}/config`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ items }),
  })
  if (!res.ok) throw new Error(await res.text())
}

// ── events ────────────────────────────────────────────────────────────────────

$.when('submit', 'form.table', async event => {
  event.preventDefault()
  const form = event.target
  const galleryId = form.dataset.gallery
  const id  = form.id.value.trim()
  const url = form.url.value.trim()
  if (!id || !url) return

  const { items = [] } = $.learn()
  if (items.find(x => x.id === id)) return

  const next = [...items, { id, url }]
  try {
    await saveConfig(galleryId, next)
    $.teach({ items: next, saved: true, draftId: '', draftUrl: '' })
    setTimeout(() => $.teach({ saved: false }), 2000)
  } catch(e) {
    $.teach({ error: e.message })
  }
})

$.when('click', '[data-remove]', async event => {
  const itemId = event.target.dataset.remove
  const form   = event.target.closest('form.table')
  const galleryId = form?.dataset.gallery
  if (!galleryId) return
  const { items = [] } = $.learn()
  const next = items.filter(x => x.id !== itemId)
  try {
    await saveConfig(galleryId, next)
    $.teach({ items: next })
  } catch(e) {
    $.teach({ error: e.message })
  }
})

$.when('click', '[data-dup-id]', event => {
  const { dupId, dupUrl } = event.target.dataset
  $.teach({ draftId: dupId + '-copy', draftUrl: dupUrl })
})

$.when('click', '.thumb, .admin-thumb', event => {
  const src = event.target.closest('[data-src]')?.dataset.src
  if (src) $.teach({ darkroom: src })
})

$.when('click', '.darkroom', () => $.teach({ darkroom: null }))

$.when('keydown', tag, event => {
  if (event.key === 'Escape') $.teach({ darkroom: null })
})

$.when('click', '[data-copy]', async event => {
  const el = event.target.closest(tag)?.querySelector(`#${event.target.dataset.copy}`)
  if (!el) return
  try {
    await navigator.clipboard.writeText(el.textContent)
  } catch {
    const ta = document.createElement('textarea')
    ta.value = el.textContent
    ta.style.cssText = 'position:fixed;left:-9999px'
    document.body.appendChild(ta); ta.select()
    document.execCommand('copy')
    document.body.removeChild(ta)
  }
})

// ── style ─────────────────────────────────────────────────────────────────────

$.style(`
  & {
    display: block;
    height: 100%;
    background: #000;
    color: #eee;
    font-family: 'Recursive', monospace;
    overflow: auto;
  }
  & .gallery {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(160px, 1fr));
    gap: 1px;
  }
  & .thumb {
    aspect-ratio: 1;
    overflow: hidden;
    border: none;
    padding: 0;
    margin: 0;
    cursor: pointer;
    background: #111;
    display: block;
    width: 100%;
  }
  & .thumb img {
    width: 100%;
    height: 100%;
    object-fit: cover;
    display: block;
    transition: opacity .15s ease;
  }
  & .thumb:hover img { opacity: .8; }
  & .darkroom {
    position: fixed;
    inset: 0;
    background: #000;
    display: grid;
    place-content: center;
    z-index: 100;
    cursor: pointer;
  }
  & .dr-img {
    max-width: 100vw;
    max-height: 100vh;
    object-fit: contain;
    display: block;
    pointer-events: none;
  }
  & .admin {
    padding: 1rem;
    display: flex;
    flex-direction: column;
    gap: .75rem;
  }
  & .admin-title {
    margin: 0;
    font-size: 1rem;
    font-variation-settings: "MONO" 1;
  }
  & .table {
    display: grid;
    grid-template-columns: auto 1fr 2fr;
    gap: .4rem;
    align-items: center;
  }
  & .table > * { width: 100%; }
  & .inp {
    width: 100%;
    background: #222;
    color: #eee;
    border: 1px solid #444;
    padding: .25rem .5rem;
    font-family: inherit;
    font-size: .85rem;
    box-sizing: border-box;
  }
  & .row-actions { display: flex; gap: .25rem; align-items: center; }
  & .admin-thumb {
    width: 64px;
    height: 64px;
    flex-shrink: 0;
    padding: 0;
    border: 1px solid #333;
    background: #000;
    cursor: pointer;
    overflow: hidden;
  }
  & .admin-thumb img {
    width: 100%;
    height: 100%;
    object-fit: cover;
    display: block;
  }
  & .admin-thumb:hover { border-color: #666; }
  & .dup-btn {
    background: none;
    border: none;
    color: #666;
    cursor: pointer;
    font-size: .9rem;
    padding: 0 .2rem;
    line-height: 1;
  }
  & .dup-btn:hover { color: #aaa; }
  & .add-btn, & .copy-btn {
    background: #333;
    color: #eee;
    border: 1px solid #555;
    padding: .25rem .6rem;
    cursor: pointer;
    font-family: inherit;
    font-size: .8rem;
    white-space: nowrap;
  }
  & .add-btn:hover, & .copy-btn:hover { background: #444; }
  & .rm-btn {
    background: none;
    border: none;
    color: #666;
    cursor: pointer;
    font-size: 1rem;
    padding: 0 .25rem;
  }
  & .rm-btn:hover { color: #f66; }
  & .mono { font-variation-settings: "MONO" 1; font-size: .85rem; padding: .1rem .3rem; }
  & .url-cell { display: flex; align-items: center; gap: .25rem; font-size: .85rem; overflow: hidden; }
  & .url-cell span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  & .msg { padding: 1rem; color: #888; font-size: .9rem; }
  & .msg.error { color: #f66; }
  & .msg.ok { color: #6f6; }
  & .field { margin: 0; }
`)
