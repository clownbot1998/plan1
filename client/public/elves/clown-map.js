import { Self } from '@plan98/types'
import L from 'leaflet'

const tag = 'clown-map'
const $ = Self(tag)

const SF_CENTER = [37.7749, -122.4194]
const SF_ZOOM = 12
const SL = 'https://cdn.jsdelivr.net/npm/@shoelace-style/shoelace@2.16.0/cdn/assets/icons'

let _map = null
let _expanded = false

function icon(name) {
  return `<span class="cm-icon" style="--i:url('${SL}/${name}.svg')"></span>`
}

function injectLeafletCss() {
  if (document.getElementById('leaflet-css')) return
  const link = document.createElement('link')
  link.id = 'leaflet-css'
  link.rel = 'stylesheet'
  link.href = 'https://cdn.jsdelivr.net/npm/leaflet@1.9.4/dist/leaflet.css'
  document.head.appendChild(link)
}

function setStatus(el, text, cls) {
  if (!el) return
  el.textContent = text
  el.className = 'cm-status' + (cls ? ' cm-status--' + cls : '')
  el.style.display = text ? '' : 'none'
}

function openSidebar(target, cnn, label) {
  const sidebar = target.querySelector('.cm-sidebar')
  const title = target.querySelector('.cm-sidebar-title')
  const iframe = target.querySelector('.cm-board')
  if (!sidebar) return
  title.textContent = label
  iframe.src = `/app/bulletin-board?id=sf-cnn-${cnn}`
  sidebar.classList.add('is-open')
}

function closeSidebar(target) {
  const sidebar = target.querySelector('.cm-sidebar')
  if (!sidebar) return
  _expanded = false
  sidebar.classList.remove('is-open', 'is-expanded')
  updateExpandIcon(target)
}

function updateExpandIcon(target) {
  const btn = target.querySelector('.cm-expand-btn')
  if (btn) btn.innerHTML = icon(_expanded ? 'fullscreen-exit' : 'fullscreen')
}

function toggleExpand(target) {
  const sidebar = target.querySelector('.cm-sidebar')
  if (!sidebar) return
  _expanded = !_expanded
  sidebar.classList.toggle('is-expanded', _expanded)
  if (_expanded) sidebar.style.width = ''
  updateExpandIcon(target)
}

async function initMap(mapEl, statusEl, target) {
  if (_map || !mapEl) return
  injectLeafletCss()

  _map = L.map(mapEl, {
    center: SF_CENTER,
    zoom: SF_ZOOM,
    preferCanvas: true,
  })

  L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
    maxZoom: 19,
  }).addTo(_map)

  setStatus(statusEl, 'loading noses…')

  try {
    const res = await fetch('/cdn/sillyz.computer/clown-map.geojson')
    const data = await res.json()

    L.geoJSON(data, {
      renderer: L.canvas({ padding: 0.5 }),
      pointToLayer(feature, latlng) {
        const p = feature.properties
        const marker = L.circleMarker(latlng, {
          radius: 5,
          fillColor: '#cc0000',
          fillOpacity: 0.75,
          color: '#7a0000',
          weight: 0.5,
          interactive: true,
        })
        const label = [p.st_name, p.st_type].filter(Boolean).join(' ')
        marker.on('click', () => openSidebar(target, p.cnn, label || p.cnntext))
        return marker
      },
    }).addTo(_map)

    setStatus(statusEl, data.features.length.toLocaleString() + ' noses', 'count')
    setTimeout(() => setStatus(statusEl, ''), 3000)
  } catch (e) {
    setStatus(statusEl, e.message, 'error')
  }
}

$.draw(target => {
  setTimeout(() => {
    initMap(target.querySelector('.cm-root'), target.querySelector('.cm-status'), target)
    target.querySelector('.cm-close-btn').addEventListener('click', () => closeSidebar(target))
    target.querySelector('.cm-expand-btn').addEventListener('click', () => toggleExpand(target))
    updateExpandIcon(target)
  }, 0)

  return `
    <div class="cm-root"></div>
    <div class="cm-sidebar">
      <div class="cm-sidebar-inner">
        <div class="cm-sidebar-header">
          <span class="cm-sidebar-title"></span>
          <button class="cm-expand-btn" title="fullscreen"></button>
          <button class="cm-close-btn" title="close">${icon('x-lg')}</button>
        </div>
        <iframe class="cm-board" src=""></iframe>
      </div>
      <div class="cm-resizer" data-cm-resizer></div>
    </div>
    <div class="cm-status" style="display:none"></div>
  `
})

// drag-to-resize: right edge of sidebar sets its width
document.addEventListener('pointerdown', e => {
  if (!e.target.closest('[data-cm-resizer]')) return
  const host = e.target.closest(tag)
  const sidebar = host && host.querySelector('.cm-sidebar')
  if (!sidebar || _expanded) return
  e.preventDefault()

  function onMove(ev) {
    const rect = host.getBoundingClientRect()
    const w = Math.max(200, Math.min(ev.clientX - rect.left, rect.width))
    sidebar.style.width = w + 'px'
  }
  function onUp() {
    document.removeEventListener('pointermove', onMove)
    document.removeEventListener('pointerup', onUp)
  }
  document.addEventListener('pointermove', onMove)
  document.addEventListener('pointerup', onUp)
}, { capture: true })

$.style(`
  & {
    display: block;
    position: relative;
    width: 100%;
    height: 100%;
    overflow: hidden;
  }

  & .cm-root {
    position: absolute;
    inset: 0;
    z-index: 0;
  }

  & .cm-sidebar {
    position: absolute;
    top: 0;
    left: 0;
    bottom: 0;
    width: 360px;
    max-width: 100%;
    display: flex;
    flex-direction: row;
    background: var(--root-bg, #fff);
    box-shadow: 2px 0 12px rgba(0,0,0,.18);
    z-index: 500;
    transform: translateX(-100%);
    transition: transform .22s ease, width .22s ease;
  }

  & .cm-sidebar.is-open {
    transform: translateX(0);
  }

  & .cm-sidebar.is-expanded {
    width: 100%;
    transition: transform .22s ease, width .22s ease;
  }

  & .cm-resizer {
    width: 6px;
    flex-shrink: 0;
    cursor: col-resize;
    background: transparent;
    transition: background .15s;
  }

  & .cm-resizer:hover {
    background: var(--root-theme, mediumseagreen);
    opacity: .4;
  }

  & .cm-sidebar-inner {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
  }

  & .cm-sidebar-header {
    display: flex;
    align-items: center;
    gap: .4rem;
    padding: .5rem .6rem;
    border-bottom: 1px solid rgba(0,0,0,.1);
    flex-shrink: 0;
    min-width: 0;
  }

  & .cm-sidebar-title {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-weight: 600;
    font-size: .9rem;
  }

  & .cm-expand-btn,
  & .cm-close-btn {
    flex-shrink: 0;
    background: none;
    border: none;
    cursor: pointer;
    padding: .25rem;
    border-radius: 4px;
    display: flex;
    align-items: center;
    justify-content: center;
    opacity: .6;
  }

  & .cm-expand-btn:hover,
  & .cm-close-btn:hover {
    opacity: 1;
    background: rgba(0,0,0,.08);
  }

  & .cm-icon {
    display: inline-block;
    width: 1rem;
    height: 1rem;
    background: currentColor;
    -webkit-mask: var(--i) center/contain no-repeat;
    mask: var(--i) center/contain no-repeat;
    flex-shrink: 0;
  }

  & .cm-board {
    flex: 1;
    border: none;
    width: 100%;
  }

  & .cm-status {
    position: absolute;
    bottom: 1rem;
    left: 50%;
    transform: translateX(-50%);
    z-index: 1000;
    background: rgba(0,0,0,.65);
    color: #fff;
    font-size: .75rem;
    padding: .25rem .6rem;
    border-radius: 999px;
    pointer-events: none;
    white-space: nowrap;
  }

  & .cm-status--error { background: rgba(180,0,0,.85); }
  & .cm-status--count { background: rgba(140,0,0,.8); }
`)
