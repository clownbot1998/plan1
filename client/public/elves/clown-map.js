import { Self } from '@plan98/types'
import L from 'leaflet'

const tag = 'clown-map'
const $ = Self(tag)

const SF_CENTER = [37.7749, -122.4194]
const SF_ZOOM = 12

let _map = null

function injectLeafletCss() {
  if (document.getElementById('leaflet-css')) return
  const link = document.createElement('link')
  link.id = 'leaflet-css'
  link.rel = 'stylesheet'
  link.href = 'https://cdn.jsdelivr.net/npm/leaflet@1.9.4/dist/leaflet.css'
  document.head.appendChild(link)
}

function setStatus(el, html, className) {
  if (!el) return
  el.innerHTML = html
  el.className = 'cm-status' + (className ? ' ' + className : '')
  el.style.display = html ? '' : 'none'
}

async function initMap(mapEl, statusEl) {
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
      pointToLayer(_feature, latlng) {
        return L.circleMarker(latlng, {
          radius: 5,
          fillColor: '#cc0000',
          fillOpacity: 0.75,
          color: '#7a0000',
          weight: 0.5,
          interactive: false,
        })
      },
    }).addTo(_map)

    setStatus(statusEl, data.features.length.toLocaleString() + ' noses', 'cm-count')
    setTimeout(() => setStatus(statusEl, ''), 3000)
  } catch (e) {
    setStatus(statusEl, e.message, 'cm-error')
  }
}

$.draw(target => {
  // runs once — no state means no re-renders
  setTimeout(() => {
    initMap(target.querySelector('.cm-root'), target.querySelector('.cm-status'))
  }, 0)
  return `<div class="cm-root"></div><div class="cm-status">map starting…</div>`
})

$.style(`
  & {
    display: block;
    position: relative;
    width: 100%;
    height: 100%;
  }
  & .cm-root {
    position: absolute;
    inset: 0;
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
  & .cm-error {
    background: rgba(180,0,0,.8);
  }
  & .cm-count {
    background: rgba(140,0,0,.8);
  }
`)
