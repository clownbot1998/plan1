import { Self } from '@plan98/types'
import lunr from 'lunr'

const tag = 'elf-map'
const $ = Self(tag)

const EDGE_COLOR = {
  imports: '#4a7ac9',
  embeds: '#3a9d5c',
  'saga-embeds': '#c97a2e',
  renders: '#c94a8a',
}

const SOURCE_LABEL = { plan1: 'plan1 (AI assisted)', plan98: 'plan98 (human stubborn)' }
const DEGREE_LABEL = { isolated: 'isolated (0 edges)', low: 'low (1-3)', medium: 'medium (4-10)', high: 'high (10+)' }
const LINES_LABEL = { tiny: 'tiny (≤30 lines)', small: 'small (≤100)', medium: 'medium (≤300)', large: 'large (300+)' }

let idx = null // lunr index, built once graph loads

// ── pan/zoom — same rAF-throttled scheduling as bulletin-board's, since it's
// what actually made panning there feel smooth instead of trailing behind
// the cursor. elf-map has it slightly easier: panning here never needs to
// re-run the checkbox/search filter or touch the SVG's own content, only
// the wrapper's transform, so there's no per-frame recompute cost riding
// along with it the way bulletin-board's card culling has.
const ZOOM_MIN = 0.1
const ZOOM_MAX = 4
let _pendingCamera = null
let _cameraRafScheduled = false
function scheduleCameraTeach(payload) {
  _pendingCamera = { ..._pendingCamera, ...payload }
  if (_cameraRafScheduled) return
  _cameraRafScheduled = true
  requestAnimationFrame(() => {
    _cameraRafScheduled = false
    if (_pendingCamera) { $.teach(_pendingCamera); _pendingCamera = null }
  })
}
function flushPendingCamera() {
  if (_pendingCamera) { $.teach(_pendingCamera); _pendingCamera = null }
}
function clampZoom(z) { return Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, z)) }

// auto-fit — a small filtered selection (e.g. just source:plan1, 97 of 891
// nodes) only occupies a narrow arc of the full-graph ring layout. left at
// zoom 1 / pan 0,0, that arc can land almost entirely outside the viewport
// with nothing telling the researcher to go pan and find it. whenever the
// checkbox/search SELECTION changes (not on pan/zoom-only re-renders —
// _fitSignature is built from the filter inputs, not the camera), snap the
// view to frame the actual bounding box of what's now visible.
let _lastBBox = null
let _lastFitSignature = null
let _currentFitSignature = null
function setNodeBBox(nodes) {
  if (nodes.length === 0) { _lastBBox = null; return }
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity
  for (const { x, y } of nodes) {
    if (x < minX) minX = x; if (x > maxX) maxX = x
    if (y < minY) minY = y; if (y > maxY) maxY = y
  }
  _lastBBox = { minX, maxX, minY, maxY }
}
function applyAutoFit(wrap, signature) {
  if (signature === _lastFitSignature) return
  _lastFitSignature = signature
  if (!_lastBBox || !wrap.clientWidth || !wrap.clientHeight) return
  const PAD = 80
  const { minX, maxX, minY, maxY } = _lastBBox
  const bboxW = Math.max(1, maxX - minX + PAD * 2)
  const bboxH = Math.max(1, maxY - minY + PAD * 2)
  // no cap at 1 here on purpose — a small selection (e.g. just source:plan1,
  // one narrow arc of the full ring) should zoom IN to fill the viewport and
  // make its labels legible, not sit tiny at native size just because 100%
  // happens to be "no zoom." ZOOM_MAX still bounds how far this can go.
  const fitZoom = clampZoom(Math.min(wrap.clientWidth / bboxW, wrap.clientHeight / bboxH))
  const cx = (minX + maxX) / 2, cy = (minY + maxY) / 2
  $.teach({
    zoom: fitZoom,
    panX: wrap.clientWidth / 2 - cx * fitZoom,
    panY: wrap.clientHeight / 2 - cy * fitZoom,
  })
}

let _panDragging = false
let _panStartClientX = 0, _panStartClientY = 0, _panStartPanX = 0, _panStartPanY = 0

function setupPanZoom(wrap) {
  if (wrap._panZoomBound) return
  wrap._panZoomBound = true

  wrap.addEventListener('pointerdown', e => {
    // let node clicks and the zoom widget's buttons through untouched —
    // without this, clicking a button also starts a drag (setPointerCapture
    // grabs all subsequent pointer events for itself), which was silently
    // eating the button's own click.
    if (e.target.closest('[data-node-id]') || e.target.closest('.em-zoom-widget')) return
    _panDragging = true
    wrap.setPointerCapture(e.pointerId)
    const { panX = 0, panY = 0 } = $.learn()
    _panStartClientX = e.clientX; _panStartClientY = e.clientY
    _panStartPanX = panX; _panStartPanY = panY
    wrap.classList.add('em-grabbing')
  })

  wrap.addEventListener('pointermove', e => {
    if (!_panDragging) return
    scheduleCameraTeach({
      panX: _panStartPanX + (e.clientX - _panStartClientX),
      panY: _panStartPanY + (e.clientY - _panStartClientY),
    })
  })

  const endDrag = () => { _panDragging = false; wrap.classList.remove('em-grabbing'); flushPendingCamera() }
  wrap.addEventListener('pointerup', endDrag)
  wrap.addEventListener('pointercancel', endDrag)

  wrap.addEventListener('wheel', e => {
    e.preventDefault()
    const { panX = 0, panY = 0, zoom = 1 } = $.learn()
    // chain off any not-yet-flushed pan/zoom instead of $.learn() — same fix
    // as bulletin-board's wheel handler, for the same reason: this is an
    // incremental delta against the CURRENT value, and a burst of wheel
    // events (trackpad scroll fires fast) would otherwise each compute from
    // the same stale base and the gesture would visibly undershoot.
    const base = { panX, panY, zoom, ..._pendingCamera }

    if (e.ctrlKey) {
      const rect = wrap.getBoundingClientRect()
      const cursorX = e.clientX - rect.left, cursorY = e.clientY - rect.top
      const delta = -e.deltaY * (e.deltaMode === 1 ? 24 : e.deltaMode === 2 ? 400 : 1)
      const newZoom = clampZoom(base.zoom * Math.exp(delta * 0.01))
      const anchorX = (cursorX - base.panX) / base.zoom
      const anchorY = (cursorY - base.panY) / base.zoom
      scheduleCameraTeach({ zoom: newZoom, panX: cursorX - anchorX * newZoom, panY: cursorY - anchorY * newZoom })
    } else {
      scheduleCameraTeach({ panX: base.panX - e.deltaX * 0.6, panY: base.panY - e.deltaY * 0.6 })
    }
  }, { passive: false })
}

// checking a box (or typing a search) ADDS to what's shown — nothing checked
// means nothing shown. this is the "zero to a trillion, progressively"
// model: the researcher decides how much to render by how much they select,
// instead of the engineer having to pre-guess a safe default node count.
async function loadGraph() {
  $.teach({ loading: true, error: null })
  try {
    const res = await fetch('/private/elf-map/combined.json', { cache: 'no-store' })
    if (!res.ok) throw new Error(`combined.json: ${res.status} — run ./plan1.sh elf-map && ./plan1.sh plan98-map && ./plan1.sh elf-map-merge`)
    const graph = await res.json()

    idx = lunr(function () {
      this.ref('id')
      this.field('tag', { boost: 10 })
      this.field('prefix')
      this.field('source')
      this.field('edgeTypes')
      this.field('path')
      this.field('externalImports', { boost: 5 })
      for (const n of graph.nodes) {
        this.add({
          id: n.id, tag: n.tag, prefix: n.prefix, source: n.source,
          edgeTypes: n.edgeTypes.join(' '), path: n.path,
          externalImports: n.externalImports.join(' '),
        })
      }
    })

    $.teach({ graph, loading: false })
  } catch (e) {
    $.teach({ error: e.message, loading: false })
  }
}

// deterministic circular layout, computed once over ALL nodes regardless of
// what's currently visible — a node's position never moves as filters
// change, so toggling a checkbox reads as reveal, not reshuffle.
function layout(nodes, size) {
  const r = size / 2 - 110
  const cx = size / 2, cy = size / 2
  const n = nodes.length
  const positions = {}
  nodes.forEach((node, i) => {
    const angle = (i / n) * Math.PI * 2 - Math.PI / 2
    positions[node.id] = { x: cx + r * Math.cos(angle), y: cy + r * Math.sin(angle), angle }
  })
  return positions
}

// some plan98 saga paths are 80+ characters (deeply nested recursive
// directory structure over there) — no reasonable radius margin
// accommodates that without making the whole layout impractically sprawling
// for everything else. cap the label, keep the full name one click away in
// the detail panel instead of fighting an 83-character outlier.
const LABEL_MAX = 40
function labelFor(tag) {
  return tag.length > LABEL_MAX ? tag.slice(0, LABEL_MAX - 1) + '…' : tag
}

function neighborsOf(edges, id) {
  const out = new Set()
  for (const e of edges) {
    if (e.from === id) out.add(e.to)
    if (e.to === id) out.add(e.from)
  }
  return out
}

function searchMatches(query) {
  if (!query.trim() || !idx) return null // null = "no search active", distinct from an empty result set
  try {
    return new Set(idx.search(query.trim() + (query.trim().endsWith('*') ? '' : '*')).map(h => h.ref))
  } catch {
    return new Set() // bad lunr query syntax mid-type — matches nothing this keystroke, not everything
  }
}

// a node's value for each facet group, as a small helper so both modes
// share one definition of "does this node belong to group G's checked set"
function nodeMatchesGroup(n, groupKey, checkedGroup) {
  if (groupKey === 'edgeTypes') return n.edgeTypes.some(et => checkedGroup[et])
  if (groupKey === 'hasStyle') return !!checkedGroup[String(n.hasStyle)]
  return !!checkedGroup[n[groupKey]]
}

const FACET_GROUPS = ['source', 'kind', 'degreeBucket', 'lineCountBucket', 'hasStyle', 'edgeTypes']

// union: checking ANYTHING adds to what's shown (OR across every checked
// box in every group, plus search) — "zero to a trillion, progressively."
// intersection: standard faceted narrowing (OR within a group, AND across
// groups that have something checked, search AND'd in on top) — but still
// requires at least one active filter, or intersection mode would default
// to showing all 891 nodes (an empty AND is vacuously true), defeating the
// whole point of starting at zero.
function computeVisibleIds(nodes, checked, query, intersectionMode) {
  const activeGroups = FACET_GROUPS.filter(g => Object.values(checked[g] || {}).some(Boolean))
  const search = searchMatches(query)
  if (activeGroups.length === 0 && search === null) return new Set()

  const visible = new Set()
  for (const n of nodes) {
    if (intersectionMode) {
      const groupsOk = activeGroups.every(g => nodeMatchesGroup(n, g, checked[g]))
      const searchOk = search === null || search.has(n.id)
      if ((activeGroups.length > 0 || search !== null) && groupsOk && searchOk) visible.add(n.id)
    } else {
      if (activeGroups.some(g => nodeMatchesGroup(n, g, checked[g]))) visible.add(n.id)
      if (search?.has(n.id)) visible.add(n.id)
    }
  }
  return visible
}

function facetCounts(nodes, field, subfieldIsArray) {
  const counts = {}
  for (const n of nodes) {
    if (subfieldIsArray) {
      for (const v of n[field]) counts[v] = (counts[v] || 0) + 1
    } else {
      counts[n[field]] = (counts[n[field]] || 0) + 1
    }
  }
  return counts
}

$.draw(target => {
  const { graph, loading, error, focusId, query = '', intersectionMode = false, panX = 0, panY = 0, zoom = 1 } = $.learn()
  const checked = $.learn().checked || { source: {}, kind: {}, edgeTypes: {}, degreeBucket: {}, lineCountBucket: {}, hasStyle: {} }

  if (!graph && !loading && !error) {
    setTimeout(loadGraph, 0)
    return `<div class="em-msg">loading…</div>`
  }
  if (loading && !graph) return `<div class="em-msg">loading…</div>`
  if (error) return `<div class="em-msg em-error">${error}</div>`

  const { nodes, edges, generatedAt } = graph
  const SIZE = Math.max(900, Math.sqrt(nodes.length) * 60)
  const positions = layout(nodes, SIZE)

  const visibleIds = computeVisibleIds(nodes, checked, query, intersectionMode)
  const visibleNodes = nodes.filter(n => visibleIds.has(n.id))
  const visibleEdges = edges.filter(e => visibleIds.has(e.from) && visibleIds.has(e.to))

  setNodeBBox(visibleNodes.map(n => positions[n.id]))
  _currentFitSignature = JSON.stringify({ checked, query, intersectionMode })
  const active = focusId ? neighborsOf(visibleEdges, focusId) : null

  const edgeLines = visibleEdges.map(e => {
    const a = positions[e.from], b = positions[e.to]
    if (!a || !b) return ''
    const dim = focusId && e.from !== focusId && e.to !== focusId
    return `<line class="em-edge ${dim ? 'em-dim' : ''}"
      x1="${a.x.toFixed(1)}" y1="${a.y.toFixed(1)}" x2="${b.x.toFixed(1)}" y2="${b.y.toFixed(1)}"
      stroke="${EDGE_COLOR[e.type] || '#999'}" data-edge-type="${e.type}" />`
  }).join('')

  const nodeDots = visibleNodes.map(node => {
    const p = positions[node.id]
    const isFocus = focusId === node.id
    const dim = focusId && !isFocus && !active.has(node.id)
    const labelAngle = (p.angle * 180 / Math.PI)
    const flip = labelAngle > 90 || labelAngle < -90
    return `
      <g class="em-node em-src-${node.source} ${dim ? 'em-dim' : ''} ${isFocus ? 'em-focus' : ''}" data-node-id="${node.id}">
        <title>${node.tag}</title>
        <circle cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="${node.kind === 'saga' ? 4 : 6}" class="em-dot em-kind-${node.kind}" />
        <text
          x="${(p.x + Math.cos(p.angle) * 10).toFixed(1)}" y="${(p.y + Math.sin(p.angle) * 10).toFixed(1)}"
          text-anchor="${flip ? 'end' : 'start'}"
          transform="rotate(${(flip ? labelAngle + 180 : labelAngle).toFixed(1)} ${(p.x + Math.cos(p.angle) * 10).toFixed(1)} ${(p.y + Math.sin(p.angle) * 10).toFixed(1)})"
        >${labelFor(node.tag)}</text>
      </g>
    `
  }).join('')

  const sourceCounts = facetCounts(nodes, 'source')
  const kindCounts = facetCounts(nodes, 'kind')
  const edgeTypeCounts = facetCounts(nodes, 'edgeTypes', true)
  const degreeCounts = facetCounts(nodes, 'degreeBucket')
  const lineCountCounts = facetCounts(nodes, 'lineCountBucket')
  const hasStyleCounts = facetCounts(nodes, 'hasStyle')

  const DEGREE_ORDER = ['isolated', 'low', 'medium', 'high']
  const LINES_ORDER = ['tiny', 'small', 'medium', 'large']
  function orderedEntries(counts, order) {
    return order.filter(k => k in counts).map(k => [k, counts[k]])
  }

  function checkboxGroup(groupKey, entries, labelFor = k => k) {
    return entries.map(([key, count]) => `
      <label class="em-check">
        <input type="checkbox" data-facet-group="${groupKey}" data-facet-key="${key}" ${checked[groupKey]?.[key] ? 'checked' : ''} />
        ${labelFor(key)} <span class="em-count">${count}</span>
      </label>
    `).join('')
  }

  return `
    <div class="em-shell">
      <div class="em-sidebar">
        <h2 class="em-title">elf map</h2>
        <div class="em-meta">${nodes.length} total nodes · ${edges.length} total edges · generated ${new Date(generatedAt).toLocaleString()}</div>

        <input class="em-search" type="text" placeholder="search tag / path / imports…" value="${query.replace(/"/g, '&quot;')}" data-search />

        <label class="em-check em-mode-toggle">
          <input type="checkbox" data-intersection-mode ${intersectionMode ? 'checked' : ''} />
          intersection mode (match ALL checked groups, not ANY)
        </label>

        <div class="em-facet-group">
          <h3>source</h3>
          ${checkboxGroup('source', Object.entries(sourceCounts), k => SOURCE_LABEL[k] || k)}
        </div>
        <div class="em-facet-group">
          <h3>kind</h3>
          ${checkboxGroup('kind', Object.entries(kindCounts))}
        </div>
        <div class="em-facet-group">
          <h3>touches edge type</h3>
          ${checkboxGroup('edgeTypes', Object.entries(edgeTypeCounts))}
        </div>
        <div class="em-facet-group">
          <h3>degree</h3>
          ${checkboxGroup('degreeBucket', orderedEntries(degreeCounts, DEGREE_ORDER), k => DEGREE_LABEL[k] || k)}
        </div>
        <div class="em-facet-group">
          <h3>size</h3>
          ${checkboxGroup('lineCountBucket', orderedEntries(lineCountCounts, LINES_ORDER), k => LINES_LABEL[k] || k)}
        </div>
        <div class="em-facet-group">
          <h3>has own $.style</h3>
          ${checkboxGroup('hasStyle', Object.entries(hasStyleCounts), k => k === 'true' ? 'styled' : 'unstyled')}
        </div>

        <button class="em-clear-all" data-clear-all>clear all (show nothing)</button>

        <div class="em-legend">
          <span><i style="background:${EDGE_COLOR.imports}"></i> imports</span>
          <span><i style="background:${EDGE_COLOR.embeds}"></i> embeds</span>
          <span><i style="background:${EDGE_COLOR['saga-embeds']}"></i> saga-embeds</span>
          <span><i style="background:${EDGE_COLOR.renders}"></i> renders</span>
        </div>

        <div class="em-showing">
          showing ${visibleNodes.length}/${nodes.length} nodes, ${visibleEdges.length}/${edges.length} edges
        </div>

        ${focusId ? (() => {
          const focusNode = nodes.find(n => n.id === focusId)
          if (!focusNode) return ''
          return `
            <div class="em-detail">
              <div class="em-detail-title">${focusNode.tag}</div>
              <button class="em-clear" data-clear>clear focus</button>
              <dl>
                <dt>source</dt><dd>${SOURCE_LABEL[focusNode.source] || focusNode.source}</dd>
                <dt>path</dt><dd>${focusNode.path}</dd>
                <dt>lines</dt><dd>${focusNode.lineCount} (${focusNode.lineCountBucket})</dd>
                <dt>degree</dt><dd>${focusNode.degree} (${focusNode.degreeBucket})</dd>
                <dt>styled</dt><dd>${focusNode.hasStyle ? 'yes' : 'no'}</dd>
                ${focusNode.externalImports.length ? `<dt>imports</dt><dd>${focusNode.externalImports.join(', ')}</dd>` : ''}
              </dl>
            </div>
          `
        })() : ''}
      </div>
      <div class="em-canvas-wrap" data-pan-zoom>
        ${visibleNodes.length === 0
          ? `<div class="em-empty">nothing selected — check a box or search to start revealing the graph</div>`
          : `<div class="em-canvas-inner" style="width: ${SIZE}px; height: ${SIZE}px; transform: translate(${panX}px, ${panY}px) scale(${zoom}); transform-origin: 0 0;">
               <svg class="em-canvas" width="${SIZE}" height="${SIZE}" viewBox="0 0 ${SIZE} ${SIZE}">${edgeLines}${nodeDots}</svg>
             </div>`}
        <div class="em-zoom-widget">
          <button data-zoom-out title="zoom out">−</button>
          <span>${Math.round(zoom * 100)}%</span>
          <button data-zoom-in title="zoom in">+</button>
          <button data-zoom-reset title="reset view">reset</button>
        </div>
      </div>
    </div>
  `
}, {
  afterUpdate(target) {
    const wrap = target.querySelector('[data-pan-zoom]')
    if (!wrap) return
    setupPanZoom(wrap)
    applyAutoFit(wrap, _currentFitSignature)
  },
})

$.when('click', '[data-node-id]', event => {
  const id = event.target.closest('[data-node-id]').dataset.nodeId
  const { focusId } = $.learn()
  $.teach({ focusId: focusId === id ? null : id })
})

$.when('click', '[data-clear]', () => {
  $.teach({ focusId: null })
})

$.when('click', '[data-clear-all]', () => {
  $.teach({ checked: { source: {}, kind: {}, edgeTypes: {}, degreeBucket: {}, lineCountBucket: {}, hasStyle: {} }, focusId: null, query: '' })
})

$.when('change', '[data-facet-group]', event => {
  const el = event.target
  const group = el.dataset.facetGroup, key = el.dataset.facetKey
  const { checked } = $.learn()
  const next = { source: {}, kind: {}, edgeTypes: {}, degreeBucket: {}, lineCountBucket: {}, hasStyle: {}, ...checked }
  next[group] = { ...next[group], [key]: el.checked }
  $.teach({ checked: next })
})

$.when('change', '[data-intersection-mode]', event => {
  $.teach({ intersectionMode: event.target.checked })
})

$.when('click', '[data-zoom-in]', () => {
  const { zoom = 1 } = $.learn()
  $.teach({ zoom: clampZoom(zoom * 1.25) })
})
$.when('click', '[data-zoom-out]', () => {
  const { zoom = 1 } = $.learn()
  $.teach({ zoom: clampZoom(zoom / 1.25) })
})
$.when('click', '[data-zoom-reset]', () => {
  $.teach({ zoom: 1, panX: 0, panY: 0 })
})

$.when('input', '[data-search]', event => {
  $.teach({ query: event.target.value })
})

$.style(`
  & {
    display: block;
    height: 100%;
    overflow: hidden;
    background: #12121a;
    color: #e8e8f0;
    font-family: 'Recursive', system-ui, sans-serif;
  }

  & .em-msg { padding: 1.5rem; opacity: .65; }
  & .em-error { color: #f28b82; }

  & .em-shell { display: flex; height: 100%; }

  & .em-sidebar {
    width: 280px;
    flex: 0 0 auto;
    padding: 1rem;
    overflow-y: auto;
    border-right: 1px solid rgba(255,255,255,.1);
    box-sizing: border-box;
  }
  & .em-title { margin: 0; font-size: 1.1rem; }
  & .em-meta { opacity: .55; font-size: .7rem; margin: .3rem 0 .8rem; line-height: 1.4; }

  & .em-search {
    width: 100%;
    box-sizing: border-box;
    background: rgba(255,255,255,.06);
    border: 1px solid rgba(255,255,255,.2);
    color: inherit;
    padding: .4rem .5rem;
    font-family: inherit;
    margin-bottom: 1rem;
  }

  & .em-facet-group { margin-bottom: 1rem; }
  & .em-facet-group h3 {
    margin: 0 0 .3rem;
    font-size: .7rem;
    text-transform: uppercase;
    letter-spacing: .04em;
    opacity: .5;
  }
  & .em-check {
    display: flex;
    align-items: center;
    gap: .4rem;
    font-size: .8rem;
    padding: .15rem 0;
    cursor: pointer;
  }
  & .em-count { opacity: .4; font-size: .7rem; margin-left: auto; }

  & .em-mode-toggle {
    font-size: .7rem;
    opacity: .75;
    margin-bottom: 1rem;
    padding: .4rem .5rem;
    background: rgba(255,255,255,.05);
    border: 1px solid rgba(255,255,255,.15);
  }

  & .em-clear-all {
    width: 100%;
    background: rgba(255,107,107,.15);
    border: 1px solid rgba(255,107,107,.4);
    color: #ff9b9b;
    padding: .4rem;
    cursor: pointer;
    font-family: inherit;
    margin-bottom: 1rem;
  }

  & .em-legend {
    display: flex;
    flex-wrap: wrap;
    gap: .5rem 1rem;
    font-size: .7rem;
    margin-bottom: 1rem;
    opacity: .85;
  }
  & .em-legend i {
    display: inline-block;
    width: .6rem;
    height: .6rem;
    border-radius: 50%;
    margin-right: .25rem;
    vertical-align: middle;
  }

  & .em-showing { font-size: .7rem; opacity: .6; }
  & .em-clear {
    display: block;
    margin-top: .5rem;
    background: rgba(255,255,255,.08);
    border: 1px solid rgba(255,255,255,.25);
    color: inherit;
    padding: .25rem .6rem;
    cursor: pointer;
    font-family: inherit;
  }

  & .em-detail {
    margin-top: 1rem;
    padding-top: 1rem;
    border-top: 1px solid rgba(255,255,255,.1);
  }
  & .em-detail-title { font-weight: 700; margin-bottom: .3rem; word-break: break-all; }
  & .em-detail dl { margin: .6rem 0 0; font-size: .7rem; }
  & .em-detail dt { opacity: .5; margin-top: .4rem; }
  & .em-detail dd { margin: 0; word-break: break-word; }

  & .em-canvas-wrap {
    flex: 1;
    position: relative;
    overflow: hidden;
    cursor: grab;
    touch-action: none;
  }
  & .em-canvas-wrap.em-grabbing { cursor: grabbing; }
  & .em-empty {
    position: absolute;
    inset: 0;
    display: grid;
    place-items: center;
    opacity: .4;
    font-size: .9rem;
    max-width: 30ch;
    text-align: center;
    margin: 0 auto;
  }
  & .em-canvas-inner {
    position: absolute;
    top: 0;
    left: 0;
    /* pan/zoom is a pure transform update, never a re-render of the SVG's
       own content — will-change promotes this to its own compositor layer
       up front so dragging is a cheap GPU composite, not a repaint of
       however many hundred nodes/edges happen to be checked in. flexbox
       centers the untransformed box first; the transform (set inline,
       since SIZE varies with how many nodes are visible) shifts it from
       there, so nothing here needs to hardcode a size. */
    will-change: transform;
  }
  & .em-canvas {
    display: block;
    /* SVG's default overflow clips at the viewBox edge — labels radiating
       outward from the ring routinely extend past it. visible lets them
       render into the pan/zoom canvas's own space instead of hard-cutting. */
    overflow: visible;
  }

  & .em-zoom-widget {
    position: absolute;
    bottom: 1rem; right: 1rem;
    display: flex;
    align-items: center;
    gap: .4rem;
    background: rgba(18,18,26,.85);
    border: 1px solid rgba(255,255,255,.2);
    padding: .3rem .5rem;
    font-size: .75rem;
  }
  & .em-zoom-widget button {
    background: rgba(255,255,255,.1);
    border: 1px solid rgba(255,255,255,.25);
    color: inherit;
    font-family: inherit;
    padding: .15rem .5rem;
    cursor: pointer;
  }
  & .em-zoom-widget span { min-width: 3.5ch; text-align: center; opacity: .7; }

  & .em-edge { stroke-width: 1; opacity: .35; }
  & .em-edge.em-dim { opacity: .04; }

  & .em-dot { cursor: pointer; }
  & .em-kind-elf { fill: #9ecbff; stroke: #12121a; stroke-width: 1; }
  & .em-kind-saga { fill: #ffd479; stroke: #12121a; stroke-width: 1; }
  & .em-src-plan98 .em-dot { stroke: #ff9b9b; stroke-width: 1.5; }

  & .em-node text {
    font-size: 9px;
    fill: #c8c8d8;
    pointer-events: none;
  }
  & .em-node.em-dim { opacity: .15; }
  & .em-node.em-focus .em-dot { fill: #ff6b6b; r: 8; }
  & .em-node.em-focus text { fill: #fff; font-weight: 700; }
`)
