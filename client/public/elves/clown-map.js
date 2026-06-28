import { Self } from '@plan98/types'
import L from 'leaflet'

const tag = 'clown-map'
const $ = Self(tag)

const SF_CENTER = [37.7749, -122.4194]
const SF_ZOOM = 12

let _map = null
let _sidebarOpen = false
let _expanded = false

function injectLeafletCss() {
  if (document.getElementById('leaflet-css')) return
  const link = document.createElement('link')
  link.id = 'leaflet-css'
  link.rel = 'stylesheet'
  link.href = 'https://cdn.jsdelivr.net/npm/leaflet@1.9.4/dist/leaflet.css'
  document.head.appendChild(link)
}

function setStatus(el, html, cls) {
  if (!el) return
  el.textContent = html
  el.className = 'cm-status' + (cls ? ' cm-status--' + cls : '')
  el.style.display = html ? '' : 'none'
}

function openSidebar(target, cnn, label) {
  const sidebar = target.querySelector('.cm-sidebar')
  const title = target.querySelector('.cm-sidebar-title')
  const iframe = target.querySelector('.cm-board')
  if (!sidebar) return

  title.textContent = label
  iframe.src = `/app/bulletin-board?id=sf-cnn-${cnn}`
  _sidebarOpen = true
  sidebar.classList.add('is-open')
}

function closeSidebar(target) {
  const sidebar = target.querySelector('.cm-sidebar')
  if (!sidebar) return
  _sidebarOpen = false
  _expanded = false
  sidebar.classList.remove('is-open', 'is-expanded')
}

function toggleExpand(target) {
  const sidebar = target.querySelector('.cm-sidebar')
  const btn = target.querySelector('.cm-expand-btn')
  if (!sidebar) return
  _expanded = !_expanded
  sidebar.classList.toggle('is-expanded', _expanded)
  btn.textContent = _expanded ? '⤡' : '⤢'
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
    initMap(
      target.querySelector('.cm-root'),
      target.querySelector('.cm-status'),
      target,
    )

    target.querySelector('.cm-close-btn').addEventListener('click', () => closeSidebar(target))
    target.querySelector('.cm-expand-btn').addEventListener('click', () => toggleExpand(target))
  }, 0)

  return `
    <div class="cm-root"></div>
    <div class="cm-sidebar">
      <div class="cm-sidebar-header">
        <span class="cm-sidebar-title"></span>
        <button class="cm-expand-btn" title="expand">⤢</button>
        <button class="cm-close-btn" title="close">✕</button>
      </div>
      <iframe class="cm-board" src=""></iframe>
    </div>
    <div class="cm-status" style="display:none"></div>
  `
})

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
    flex-direction: column;
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
    font-size: 1rem;
    padding: .2rem .35rem;
    border-radius: 4px;
    line-height: 1;
    opacity: .7;
  }

  & .cm-expand-btn:hover,
  & .cm-close-btn:hover {
    opacity: 1;
    background: rgba(0,0,0,.08);
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
