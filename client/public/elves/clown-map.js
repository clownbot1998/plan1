import { Self, as2 } from '@plan98/types'
import L from 'leaflet'
import { get as wasGet } from './plan98-wallet.js'

const tag = 'clown-map'
const $ = Self(tag)

const SF_CENTER = [37.7749, -122.4194]
const SF_ZOOM = 12
const SL = 'https://cdn.jsdelivr.net/npm/@shoelace-style/shoelace@2.16.0/cdn/assets/icons'
const AP_BASE = 'https://plan98.org'
const TTL_PATH = '/cdn/sillyz.computer/clown-map.ttl'

let _map = null
let _expanded = false
let _activeTab = 'board'
let _currentBoardId = null
let _currentLabel = null
let _currentProps = null
let _currentCoords = null
let _gpsWatchId = null
let _gpsMarker = null
let _gpsLastPos = null  // [lat, lng] — reframe when features load late
let _features = []
// coordIndex: rounded "lat4,lon4" → [{ streetName, cnn }]
let _coordIndex = {}

// ── helpers ───────────────────────────────────────────────────────────────────

function icon(name) {
  return `<span class="cm-icon" style="--i:url('${SL}/${name}.svg')"></span>`
}

function esc(s) {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

function coordKey(lat, lng) {
  return lat.toFixed(4) + ',' + lng.toFixed(4)
}

function intersectionLabel(lat, lng, primaryProps) {
  const key = coordKey(lat, lng)
  const neighbors = _coordIndex[key] || []
  const names = neighbors
    .map(n => n.streetName)
    .filter((n, i, a) => n && a.indexOf(n) === i) // unique
  if (names.length >= 2) return names.join(' & ')
  const primary = [primaryProps.st_name, primaryProps.st_type].filter(Boolean).join(' ')
  return primary || primaryProps.cnntext || primaryProps.cnn
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

// ── sidebar ───────────────────────────────────────────────────────────────────

function openSidebar(target, boardId, label, props, coords) {
  const sidebar = target.querySelector('.cm-sidebar')
  if (!sidebar) return
  _currentBoardId = boardId
  _currentLabel = label
  _currentProps = props
  _currentCoords = coords
  target.querySelector('.cm-sidebar-title').textContent = label
  sidebar.classList.add('is-open')
  switchTab(target, _activeTab)
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

// ── tabs ──────────────────────────────────────────────────────────────────────

function switchTab(target, tab) {
  _activeTab = tab
  target.querySelectorAll('.cm-tab').forEach(t =>
    t.classList.toggle('is-active', t.dataset.tab === tab)
  )
  const board = target.querySelector('.cm-board')
  const timeline = target.querySelector('.cm-timeline')
  const meta = target.querySelector('.cm-meta')

  board.style.display = tab === 'board' ? '' : 'none'
  timeline.style.display = tab === 'timeline' ? '' : 'none'
  meta.style.display = tab === 'meta' ? '' : 'none'

  if (tab === 'board' && _currentBoardId) {
    const want = `/app/bulletin-board?id=${_currentBoardId}`
    if (!board.src.endsWith(want)) board.src = want
  }
  if (tab === 'timeline' && _currentBoardId) loadTimeline(target, _currentBoardId)
  if (tab === 'meta') renderMeta(target)
}

// ── meta tab ──────────────────────────────────────────────────────────────────

function renderMeta(target) {
  const el = target.querySelector('.cm-meta')
  if (!el || !_currentProps) return

  const p = _currentProps
  const [lng, lat] = _currentCoords || [null, null]

  // all co-located streets at this intersection
  const neighbors = lat != null ? (_coordIndex[coordKey(lat, lng)] || []) : []
  const streets = neighbors.map(n => n.streetName).filter(Boolean)

  // synthesized rows first
  const synth = [
    ['intersection', streets.length >= 2 ? streets.join(' & ') : (streets[0] || '—')],
    ['latitude', lat != null ? lat : '—'],
    ['longitude', lng != null ? lng : '—'],
    ['board_id', `sf-cnn-${p.cnn}`],
  ]
  if (streets.length > 1) {
    streets.forEach((s, i) => synth.push([`street_${i + 1}`, s]))
  }

  // every raw property from the feature
  const raw = Object.entries(p).map(([k, v]) => [k, v ?? '—'])

  const allRows = [...synth, ...raw]

  el.innerHTML = `
    <table class="cm-meta-table">
      <tbody>
        ${allRows.map(([k, v]) => `
          <tr>
            <th>${esc(k)}</th>
            <td>${esc(v)}</td>
          </tr>
        `).join('')}
      </tbody>
    </table>
  `
}

// ── timeline / graph traversal ────────────────────────────────────────────────

function buildPaths(cards) {
  const ids = Object.keys(cards)
  if (!ids.length) return []
  const roots = ids.filter(id => !cards[id].backlinks || !Object.keys(cards[id].backlinks).length)
  if (!roots.length) roots.push(ids[0])

  const paths = []
  function dfs(cardId, path, visited) {
    if (visited.has(cardId)) { paths.push([...path]); return }
    visited.add(cardId)
    path.push(cardId)
    const nexts = Object.values(cards[cardId].links || {})
    if (!nexts.length) paths.push([...path])
    else for (const link of nexts) dfs(link.to, path, new Set(visited))
    path.pop()
  }
  for (const root of roots) dfs(root, [], new Set())
  return paths
}

function cardToStatus(cardId, card, boardId, label) {
  const acts = as2.activities(card.text || '')
  const html = acts.filter(a => a.object?.content).map(a => `<p>${esc(a.object.content)}</p>`).join('')
    || `<p>${esc(card.text || '(empty)')}</p>`
  return {
    id: cardId,
    created_at: new Date().toISOString(),
    account: { id: boardId, username: boardId, display_name: label, url: `${AP_BASE}/app/bulletin-board?id=${boardId}`, avatar: null },
    content: html,
    media_attachments: [], tags: [],
    url: `${AP_BASE}/app/bulletin-board?id=${boardId}&card=${cardId}`,
    uri: `${AP_BASE}/ap/${boardId}/note/${cardId}`,
  }
}

function renderFeedList(target, paths, cards, boardId, label) {
  const tl = target.querySelector('.cm-timeline')
  if (!tl) return
  if (!paths.length) { tl.innerHTML = '<div class="cm-tl-empty">no cards yet — open Board to add some</div>'; return }

  tl.innerHTML = `<div class="cm-tl-feeds">${paths.map((path, i) => {
    const preview = esc((cards[path[0]]?.text || '').slice(0, 60) || '(empty)')
    return `<button class="cm-feed-item" data-feed-idx="${i}">
      <span class="cm-feed-num">${i + 1}</span>
      <span class="cm-feed-preview">${preview}${path.length > 1 ? ` → (${path.length})` : ''}</span>
    </button>`
  }).join('')}</div>`

  tl.querySelectorAll('[data-feed-idx]').forEach(btn => {
    btn.addEventListener('click', () => {
      const path = paths[+btn.dataset.feedIdx]
      const statuses = path.map(id => cardToStatus(id, cards[id], boardId, label))
      tl.innerHTML = `
        <button class="cm-tl-back">${icon('arrow-left')} all feeds</button>
        <div class="cm-tl-feed">${statuses.map(s => `
          <div class="cm-status-card">
            <div class="cm-status-actor">${esc(s.account.display_name)}</div>
            <div class="cm-status-content">${s.content}</div>
          </div>`).join('')}
        </div>`
      tl.querySelector('.cm-tl-back').addEventListener('click', () =>
        renderFeedList(target, paths, cards, boardId, label))
    })
  })
}

async function loadTimeline(target, boardId) {
  const tl = target.querySelector('.cm-timeline')
  if (!tl) return
  tl.innerHTML = '<div class="cm-tl-loading">traversing graph…</div>'

  let cards = {}

  // mirror bulletin-board's load strategy: TTL is canonical, JSON is fallback
  try {
    const blob = await wasGet(`/bulletin-board/${boardId}.ttl`)
    if (blob) {
      const { turtleToBoard } = await import('./solid-utils.js')
      const parsed = await turtleToBoard(await blob.text())
      cards = parsed.cards || {}
    }
  } catch {
    try {
      const blob = await wasGet(`/bulletin-board/${boardId}.json`)
      if (blob) {
        const data = JSON.parse(await blob.text())
        cards = data?.cards || {}
      }
    } catch {}
  }

  renderFeedList(target, buildPaths(cards), cards, boardId, _currentLabel)
}

// ── TTL / actor graph ─────────────────────────────────────────────────────────

function generateTTL(features) {
  const lines = [
    '@prefix as:  <https://www.w3.org/ns/activitystreams#> .',
    '@prefix geo: <http://www.w3.org/2003/01/geo/wgs84_pos#> .',
    '@prefix sf:  <' + AP_BASE + '/clown-map/cnn/> .',
    '',
  ]
  for (const f of features) {
    const p = f.properties
    const [lng, lat] = f.geometry.coordinates
    const cnn = p.cnn || p.cnntext
    const boardId = 'sf-cnn-' + cnn
    const key = coordKey(lat, lng)
    const neighbors = (_coordIndex[key] || []).map(n => n.streetName).filter(Boolean)
    const name = neighbors.length >= 2 ? neighbors.join(' & ') : ([p.st_name, p.st_type].filter(Boolean).join(' ') || cnn)
    lines.push(
      'sf:' + cnn + ' a as:Person ;',
      '    as:name   ' + JSON.stringify(name) + ' ;',
      '    as:url    <' + AP_BASE + '/app/bulletin-board?id=' + boardId + '> ;',
      '    as:outbox <' + AP_BASE + '/ap/' + boardId + '/outbox> ;',
      '    as:inbox  <' + AP_BASE + '/ap/' + boardId + '/inbox> ;',
      '    geo:lat   ' + lat + ' ;',
      '    geo:long  ' + lng + ' .',
      '',
    )
  }
  return lines.join('\n')
}

async function saveTTL(ttl) {
  try {
    const res = await fetch('/save' + TTL_PATH, { method: 'PUT', headers: { 'content-type': 'text/turtle' }, body: ttl })
    if (res.status === 401) return
    if (!res.ok) console.warn('clown-map: TTL save failed', res.status)
  } catch (e) { console.warn('clown-map: TTL save error', e.message) }
}

// ── map init ──────────────────────────────────────────────────────────────────

async function initMap(mapEl, statusEl, target) {
  if (_map || !mapEl) return
  injectLeafletCss()

  _map = L.map(mapEl, { center: SF_CENTER, zoom: SF_ZOOM, preferCanvas: true })
  L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
    maxZoom: 19,
  }).addTo(_map)

  setStatus(statusEl, 'loading noses…')

  try {
    const res = await fetch('/cdn/sillyz.computer/clown-map.geojson')
    const data = await res.json()

    _features = data.features

    // build spatial index: rounded coord → [{streetName, cnn}]
    for (const f of data.features) {
      const p = f.properties
      const [lng, lat] = f.geometry.coordinates
      const key = coordKey(lat, lng)
      if (!_coordIndex[key]) _coordIndex[key] = []
      _coordIndex[key].push({
        streetName: [p.st_name, p.st_type].filter(Boolean).join(' '),
        cnn: p.cnn,
      })
    }

    L.geoJSON(data, {
      renderer: L.canvas({ padding: 0.5 }),
      pointToLayer(feature, latlng) {
        const p = feature.properties
        const [lng, lat] = feature.geometry.coordinates
        const marker = L.circleMarker(latlng, {
          radius: 5, fillColor: '#cc0000', fillOpacity: 0.75,
          color: '#7a0000', weight: 0.5, interactive: true,
        })
        marker.on('click', () => {
          const label = intersectionLabel(lat, lng, p)
          openSidebar(target, 'sf-cnn-' + p.cnn, label, p, [lng, lat])
        })
        return marker
      },
    }).addTo(_map)

    setStatus(statusEl, data.features.length.toLocaleString() + ' noses', 'count')
    setTimeout(() => setStatus(statusEl, ''), 3000)
    // if GPS fired before features loaded, reframe now that we have noses
    if (_gpsLastPos) gpsReframe(_gpsLastPos[0], _gpsLastPos[1])
    saveTTL(generateTTL(data.features))
  } catch (e) {
    setStatus(statusEl, e.message, 'error')
  }
}

// ── gps ──────────────────────────────────────────────────────────────────────

function nearestNose(lat, lng) {
  let best = null, bestDist = Infinity
  for (const f of _features) {
    const [fLng, fLat] = f.geometry.coordinates
    const dlat = fLat - lat, dlng = fLng - lng
    const d = dlat * dlat + dlng * dlng
    if (d < bestDist) { bestDist = d; best = [fLat, fLng] }
  }
  return best
}

function updateGpsBtn(host, on) {
  const btn = host && host.querySelector('.cm-gps-btn')
  if (!btn) return
  btn.dataset.on = on ? '1' : ''
  btn.querySelector('.cm-gps-dot').style.background = on ? 'dodgerblue' : '#aaa'
  btn.querySelector('.cm-gps-label').textContent = on ? 'Location: on' : 'Location: off'
}

function gpsReframe(lat, lng) {
  if (!_map) return
  _gpsLastPos = [lat, lng]
  if (_gpsMarker) _gpsMarker.setLatLng([lat, lng])
  const nose = nearestNose(lat, lng)
  if (nose) {
    const target = L.latLngBounds([[lat, lng], nose])
    const current = _map.getBounds()
    // only reframe if either point is outside the current view
    if (current.contains(target)) return
    _map.fitBounds(target, { padding: [60, 60], maxZoom: 18, animate: true, duration: 0.6 })
  } else {
    if (_map.getBounds().contains([lat, lng])) return
    _map.setView([lat, lng], 15, { animate: true, duration: 0.6 })
  }
}

function startGps(host) {
  console.log('[clown-map] startGps, geolocation available:', !!navigator.geolocation)
  if (!navigator.geolocation) {
    updateGpsBtn(host, false)
    return
  }
  updateGpsBtn(host, true)

  function onPos(pos) {
    const { latitude: lat, longitude: lng, accuracy } = pos.coords
    console.log('[clown-map] position received', lat, lng, 'accuracy:', accuracy, 'm')
    if (!_map) { console.warn('[clown-map] _map not ready yet'); return }
    if (!_gpsMarker) {
      console.log('[clown-map] creating marker')
      _gpsMarker = L.circleMarker([lat, lng], {
        radius: 8, color: '#fff', fillColor: 'dodgerblue',
        fillOpacity: 1, weight: 2,
      }).addTo(_map)
      console.log('[clown-map] marker added to map')
    }
    gpsReframe(lat, lng)
  }

  function onErr(err) {
    console.warn('[clown-map] GPS error code:', err.code, 'message:', err.message)
    stopGps(host)
  }

  _gpsWatchId = navigator.geolocation.watchPosition(onPos, onErr, { enableHighAccuracy: false, maximumAge: 60000 })
  console.log('[clown-map] watchPosition registered, id:', _gpsWatchId)
}

function stopGps(host) {
  if (_gpsWatchId != null) {
    navigator.geolocation.clearWatch(_gpsWatchId)
    _gpsWatchId = null
  }
  if (_gpsMarker) {
    _gpsMarker.remove()
    _gpsMarker = null
  }
  _gpsLastPos = null
  updateGpsBtn(host, false)
}

// ── draw ──────────────────────────────────────────────────────────────────────

$.draw(target => {
  setTimeout(() => {
    initMap(target.querySelector('.cm-root'), target.querySelector('.cm-status'), target)
    target.querySelector('.cm-close-btn').addEventListener('click', () => closeSidebar(target))
    target.querySelector('.cm-expand-btn').addEventListener('click', () => toggleExpand(target))
    target.querySelectorAll('.cm-tab').forEach(t =>
      t.addEventListener('click', () => switchTab(target, t.dataset.tab))
    )
    target.querySelector('.cm-gps-btn').addEventListener('click', () => {
      const btn = target.querySelector('.cm-gps-btn')
      btn.dataset.on ? stopGps(target) : startGps(target)
    })
    updateExpandIcon(target)
  }, 0)

  return `
    <div class="cm-root"></div>
    <button class="cm-gps-btn" title="toggle GPS location">
      <span class="cm-gps-dot"></span>
      <span class="cm-gps-label">Location: off</span>
    </button>
    <div class="cm-sidebar">
      <div class="cm-sidebar-inner">
        <div class="cm-sidebar-header">
          <span class="cm-sidebar-title"></span>
          <div class="cm-tabs">
            <button class="cm-tab is-active" data-tab="board">Board</button>
            <button class="cm-tab" data-tab="timeline">Timeline</button>
            <button class="cm-tab" data-tab="meta">Meta</button>
          </div>
          <button class="cm-expand-btn" title="fullscreen"></button>
          <button class="cm-close-btn" title="close">${icon('x-lg')}</button>
        </div>
        <iframe class="cm-board" src=""></iframe>
        <div class="cm-timeline" style="display:none"></div>
        <div class="cm-meta" style="display:none"></div>
      </div>
      <div class="cm-resizer" data-cm-resizer></div>
    </div>
    <div class="cm-status" style="display:none"></div>
  `
})

// ── resizer ───────────────────────────────────────────────────────────────────

document.addEventListener('pointerdown', e => {
  if (!e.target.closest('[data-cm-resizer]')) return
  const host = e.target.closest(tag)
  const sidebar = host && host.querySelector('.cm-sidebar')
  if (!sidebar || _expanded) return
  e.preventDefault()
  e.target.setPointerCapture(e.pointerId)
  sidebar.style.transition = 'transform .22s ease'
  function onMove(ev) {
    const rect = host.getBoundingClientRect()
    sidebar.style.width = Math.max(200, Math.min(ev.clientX - rect.left, rect.width)) + 'px'
  }
  function onUp() {
    sidebar.style.transition = ''
    e.target.removeEventListener('pointermove', onMove)
    e.target.removeEventListener('pointerup', onUp)
  }
  e.target.addEventListener('pointermove', onMove)
  e.target.addEventListener('pointerup', onUp)
})

// ── styles ────────────────────────────────────────────────────────────────────

$.style(`
  & { display:block; position:relative; width:100%; height:100%; overflow:hidden; }
  & .cm-root { position:absolute; inset:0; z-index:0; }

  & .cm-sidebar {
    position:absolute; top:0; left:0; bottom:0;
    width:360px; max-width:100%;
    display:flex; flex-direction:row;
    background:var(--root-bg,#fff);
    box-shadow:2px 0 12px rgba(0,0,0,.18);
    z-index:500;
    transform:translateX(-100%);
    transition:transform .22s ease, width .22s ease;
  }
  & .cm-sidebar.is-open { transform:translateX(0); }
  & .cm-sidebar.is-expanded { width:100%; }

  & .cm-resizer {
    width:6px; flex-shrink:0; cursor:col-resize;
    background:transparent; transition:background .15s;
  }
  & .cm-resizer:hover { background:var(--root-theme,mediumseagreen); opacity:.4; }

  & .cm-sidebar-inner {
    flex:1; min-width:0; display:flex; flex-direction:column; overflow:hidden;
  }

  & .cm-sidebar-header {
    display:flex; align-items:center; gap:.3rem;
    padding:.4rem .5rem;
    border-bottom:1px solid rgba(0,0,0,.1);
    flex-shrink:0; min-width:0;
  }
  & .cm-sidebar-title {
    flex:1; min-width:0; overflow:hidden;
    text-overflow:ellipsis; white-space:nowrap;
    font-weight:600; font-size:.85rem;
  }
  & .cm-tabs { display:flex; gap:2px; flex-shrink:0; }
  & .cm-tab {
    font-size:.72rem; padding:.18rem .4rem;
    border:1px solid rgba(0,0,0,.15); border-radius:4px;
    background:transparent; cursor:pointer; opacity:.6;
  }
  & .cm-tab.is-active {
    opacity:1; background:var(--root-theme,mediumseagreen);
    color:#fff; border-color:transparent;
  }
  & .cm-expand-btn, & .cm-close-btn {
    flex-shrink:0; background:none; border:none; cursor:pointer;
    padding:.25rem; border-radius:4px;
    display:flex; align-items:center; justify-content:center; opacity:.6;
  }
  & .cm-expand-btn:hover, & .cm-close-btn:hover { opacity:1; background:rgba(0,0,0,.08); }

  & .cm-icon {
    display:inline-block; width:1rem; height:1rem;
    background:currentColor;
    -webkit-mask:var(--i) center/contain no-repeat;
    mask:var(--i) center/contain no-repeat;
    flex-shrink:0;
  }

  & .cm-board { flex:1; min-height:0; height:0; border:none; width:100%; }

  & .cm-timeline, & .cm-meta {
    flex:1; min-height:0; overflow-y:auto; display:block;
  }

  & .cm-tl-loading, & .cm-tl-empty {
    padding:1.5rem 1rem; text-align:center; opacity:.5; font-size:.85rem;
  }
  & .cm-tl-feeds { display:flex; flex-direction:column; gap:1px; padding:.5rem; }
  & .cm-feed-item {
    display:flex; align-items:flex-start; gap:.5rem;
    padding:.5rem .6rem; background:none;
    border:1px solid rgba(0,0,0,.1); border-radius:6px;
    cursor:pointer; text-align:left; font-size:.82rem;
  }
  & .cm-feed-item:hover { background:rgba(0,0,0,.04); }
  & .cm-feed-num {
    flex-shrink:0; width:1.4rem; height:1.4rem;
    background:#cc0000; color:#fff; border-radius:50%;
    display:flex; align-items:center; justify-content:center;
    font-size:.7rem; font-weight:700;
  }
  & .cm-feed-preview {
    flex:1; min-width:0; overflow:hidden;
    text-overflow:ellipsis; white-space:nowrap; opacity:.8;
  }
  & .cm-tl-back {
    display:flex; align-items:center; gap:.35rem;
    padding:.5rem .75rem; background:none; border:none;
    border-bottom:1px solid rgba(0,0,0,.08);
    cursor:pointer; font-size:.8rem; flex-shrink:0; opacity:.7;
  }
  & .cm-tl-back:hover { opacity:1; background:rgba(0,0,0,.04); }
  & .cm-tl-feed {
    padding:.5rem;
    display:flex; flex-direction:column; gap:.5rem;
  }
  & .cm-status-card {
    border:1px solid rgba(0,0,0,.1); border-radius:8px;
    padding:.6rem .75rem; font-size:.83rem;
  }
  & .cm-status-actor { font-weight:600; font-size:.72rem; opacity:.6; margin-bottom:.25rem; }
  & .cm-status-content p { margin:0; line-height:1.45; }

  & .cm-meta-table {
    width:100%; border-collapse:collapse; font-size:.82rem;
  }
  & .cm-meta-table tr { border-bottom:1px solid rgba(0,0,0,.06); }
  & .cm-meta-table tr:last-child { border-bottom:none; }
  & .cm-meta-table th {
    text-align:left; padding:.4rem .6rem;
    font-weight:500; opacity:.55;
    width:40%; white-space:nowrap;
  }
  & .cm-meta-table td {
    padding:.4rem .6rem; word-break:break-all;
  }

  & .cm-gps-btn {
    position:absolute; top:.6rem; right:.6rem; z-index:100;
    display:flex; align-items:center; gap:.4rem;
    padding:.3rem .6rem .3rem .4rem;
    background:#fff; border:1px solid rgba(0,0,0,.15);
    border-radius:999px; cursor:pointer;
    font-size:.75rem; font-weight:500; color:#333;
    box-shadow:0 1px 4px rgba(0,0,0,.15);
    white-space:nowrap;
  }
  & .cm-gps-btn:hover { box-shadow:0 2px 8px rgba(0,0,0,.2); }
  & .cm-gps-dot {
    width:.65rem; height:.65rem; border-radius:50%;
    background:#aaa; flex-shrink:0;
    transition:background .2s;
  }

  & .cm-status {
    position:absolute; bottom:1rem; left:50%; transform:translateX(-50%);
    z-index:1000; background:rgba(0,0,0,.65); color:#fff;
    font-size:.75rem; padding:.25rem .6rem; border-radius:999px;
    pointer-events:none; white-space:nowrap;
  }
  & .cm-status--error { background:rgba(180,0,0,.85); }
  & .cm-status--count { background:rgba(140,0,0,.8); }
`)
