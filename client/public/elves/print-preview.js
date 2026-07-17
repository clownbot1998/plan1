import { Self, Saga } from '@plan98/types'

const tag = 'print-preview'
const $ = Self(tag, { text: null, error: null })

async function resolveFromId(id) {
  const res = await fetch('/search-manifest.json')
  const docs = await res.json()
  const doc = docs.find(d => d.type === 'saga' && (d.ref === id || d.name === id))
  return doc ? doc.path : null
}

async function load() {
  const params = new URLSearchParams(window.location.search)
  let path = params.get('path') || params.get('src') || ''
  const id = params.get('id')
  if (!path && id) path = await resolveFromId(id)
  if (!path) { $.teach({ error: 'no saga specified — pass ?path= or ?id=' }, (s, p) => ({ ...s, ...p })); return }
  try {
    const res = await fetch(path)
    if (!res.ok) throw new Error(`${res.status}`)
    const text = await res.text()
    $.teach({ text }, (s, p) => ({ ...s, ...p }))
  } catch (e) {
    $.teach({ error: `couldn't load ${path}: ${e.message}` }, (s, p) => ({ ...s, ...p }))
  }
}

let _mounted = false
$.draw(() => {
  if (!_mounted) { _mounted = true; load() }
  const { text, error } = $.learn()

  const body = error
    ? `<div class="pp-status">${error}</div>`
    : text === null
      ? `<div class="pp-status">loading…</div>`
      : `<div class="screenplay">${Saga(text)}</div>`

  return `
    <button data-print class="pp-print-btn">print</button>
    ${body}
  `
})

$.when('click', '[data-print]', () => window.print())

// html/body/#main are all height:100%+overflow:hidden (system.css) so the
// print pass would still see only the current viewport-height "page" of
// the scroll container unless those clips are lifted first — walk the
// ancestor chain up to <html> and force each to flow/overflow:visible for
// the duration of the print, then restore. same fix lore-baby.js's print()
// does via its detached dialog; here it's inline since there's no dialog.
let _printRestore = []
window.addEventListener('beforeprint', () => {
  let node = document.querySelector(tag)
  _printRestore = []
  while (node) {
    _printRestore.push([node, node.getAttribute('style')])
    node.style.cssText += ';overflow:visible !important;height:auto !important;max-height:none !important;position:static !important;'
    if (node === document.documentElement) break
    node = node.parentElement
  }
})
window.addEventListener('afterprint', () => {
  for (const [node, css] of _printRestore) {
    if (css === null) node.removeAttribute('style')
    else node.setAttribute('style', css)
  }
  _printRestore = []
})

$.style(`
  & {
    display: block;
    height: 100%;
    overflow-y: auto;
    background: #666;
  }
  & .pp-status {
    color: #eee;
    padding: 2rem;
    font-family: monospace;
    font-size: .9rem;
  }
  & .pp-print-btn {
    position: fixed;
    top: 1rem;
    right: 1rem;
    z-index: 10;
    padding: .5rem 1.1rem;
    border: none;
    border-radius: 6px;
    background: #222;
    color: #fff;
    font-family: inherit;
    font-size: .85rem;
    cursor: pointer;
    box-shadow: 0 2px 8px rgba(0,0,0,.3);
  }
  & .pp-print-btn:hover {
    background: #000;
  }
  @media print {
    & .pp-print-btn {
      display: none;
    }
    html, body, & {
      height: auto !important;
      overflow: visible !important;
      background: white;
    }
  }
`)
