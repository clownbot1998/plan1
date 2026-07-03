import { Self } from '@plan98/types'

const tag = 'elf-map'
const $ = Self(tag)

const EDGE_COLOR = {
  imports: '#4a7ac9',
  embeds: '#3a9d5c',
  'saga-embeds': '#c97a2e',
}

async function loadGraph() {
  $.teach({ loading: true, error: null })
  try {
    const res = await fetch('/private/elf-map/graph.json', { cache: 'no-store' })
    if (!res.ok) throw new Error(`graph.json: ${res.status} — run ./plan1.sh elf-map`)
    const graph = await res.json()
    $.teach({ graph, loading: false })
  } catch (e) {
    $.teach({ error: e.message, loading: false })
  }
}

// deterministic circular layout — no physics sim, just even spacing on a ring
function layout(nodes, size = 900) {
  const r = size / 2 - 60
  const cx = size / 2, cy = size / 2
  const n = nodes.length
  const positions = {}
  nodes.forEach((node, i) => {
    const angle = (i / n) * Math.PI * 2 - Math.PI / 2
    positions[node.id] = {
      x: cx + r * Math.cos(angle),
      y: cy + r * Math.sin(angle),
      angle,
    }
  })
  return { positions, cx, cy, size }
}

function neighborsOf(edges, id) {
  const out = new Set()
  for (const e of edges) {
    if (e.from === id) out.add(e.to)
    if (e.to === id) out.add(e.from)
  }
  return out
}

$.draw(target => {
  const { graph, loading, error, focusId } = $.learn()

  if (!graph && !loading && !error) {
    setTimeout(loadGraph, 0)
    return `<div class="em-msg">loading…</div>`
  }
  if (loading && !graph) return `<div class="em-msg">loading…</div>`
  if (error) return `<div class="em-msg em-error">${error}</div>`

  const { nodes, edges, generatedAt, note } = graph
  const SIZE = 900
  const { positions } = layout(nodes, SIZE)
  const active = focusId ? neighborsOf(edges, focusId) : null

  const edgeLines = edges.map(e => {
    const a = positions[e.from], b = positions[e.to]
    if (!a || !b) return ''
    const dim = focusId && e.from !== focusId && e.to !== focusId
    return `<line
      class="em-edge ${dim ? 'em-dim' : ''}"
      x1="${a.x.toFixed(1)}" y1="${a.y.toFixed(1)}"
      x2="${b.x.toFixed(1)}" y2="${b.y.toFixed(1)}"
      stroke="${EDGE_COLOR[e.type] || '#999'}"
      data-edge-type="${e.type}"
    />`
  }).join('')

  const nodeDots = nodes.map(node => {
    const p = positions[node.id]
    const isFocus = focusId === node.id
    const dim = focusId && !isFocus && !active.has(node.id)
    const labelAngle = (p.angle * 180 / Math.PI)
    const flip = labelAngle > 90 || labelAngle < -90
    return `
      <g class="em-node ${dim ? 'em-dim' : ''} ${isFocus ? 'em-focus' : ''}" data-node-id="${node.id}">
        <circle cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="${node.kind === 'saga' ? 4 : 6}" class="em-dot em-kind-${node.kind}" />
        <text
          x="${(p.x + Math.cos(p.angle) * 10).toFixed(1)}"
          y="${(p.y + Math.sin(p.angle) * 10).toFixed(1)}"
          text-anchor="${flip ? 'end' : 'start'}"
          transform="rotate(${(flip ? labelAngle + 180 : labelAngle).toFixed(1)} ${(p.x + Math.cos(p.angle) * 10).toFixed(1)} ${(p.y + Math.sin(p.angle) * 10).toFixed(1)})"
        >${node.id}</text>
      </g>
    `
  }).join('')

  return `
    <div class="em-shell">
      <div class="em-header">
        <h2 class="em-title">elf map</h2>
        <div class="em-meta">${nodes.length} nodes · ${edges.length} edges · generated ${new Date(generatedAt).toLocaleString()}</div>
        <div class="em-note">${note}</div>
        <div class="em-legend">
          <span><i style="background:${EDGE_COLOR.imports}"></i> imports</span>
          <span><i style="background:${EDGE_COLOR.embeds}"></i> embeds</span>
          <span><i style="background:${EDGE_COLOR['saga-embeds']}"></i> saga-embeds</span>
          ${focusId ? `<button class="em-clear" data-clear>clear focus (${focusId})</button>` : ''}
        </div>
      </div>
      <div class="em-canvas-wrap">
        <svg class="em-canvas" viewBox="0 0 ${SIZE} ${SIZE}">
          ${edgeLines}
          ${nodeDots}
        </svg>
      </div>
    </div>
  `
})

$.when('click', '[data-node-id]', event => {
  const id = event.target.closest('[data-node-id]').dataset.nodeId
  const { focusId } = $.learn()
  $.teach({ focusId: focusId === id ? null : id })
})

$.when('click', '[data-clear]', () => {
  $.teach({ focusId: null })
})

$.style(`
  & {
    display: block;
    height: 100%;
    overflow: auto;
    background: #12121a;
    color: #e8e8f0;
    font-family: 'Recursive', system-ui, sans-serif;
  }

  & .em-msg { padding: 1.5rem; opacity: .65; }
  & .em-error { color: #f28b82; }

  & .em-header { padding: 1rem 1.25rem 0; }
  & .em-title { margin: 0; font-size: 1.1rem; }
  & .em-meta { opacity: .6; font-size: .8rem; margin-top: .2rem; }
  & .em-note { opacity: .5; font-size: .7rem; margin-top: .2rem; max-width: 60ch; }

  & .em-legend {
    display: flex;
    align-items: center;
    gap: 1rem;
    font-size: .75rem;
    margin: .6rem 0;
    opacity: .85;
  }
  & .em-legend i {
    display: inline-block;
    width: .7rem;
    height: .7rem;
    border-radius: 50%;
    margin-right: .3rem;
    vertical-align: middle;
  }
  & .em-clear {
    margin-left: auto;
    background: rgba(255,255,255,.08);
    border: 1px solid rgba(255,255,255,.25);
    color: inherit;
    padding: .25rem .6rem;
    cursor: pointer;
    font-family: inherit;
  }

  & .em-canvas-wrap { padding: 0 1rem 1rem; }
  & .em-canvas { width: 100%; height: auto; max-width: 900px; display: block; margin: 0 auto; }

  & .em-edge { stroke-width: 1; opacity: .35; }
  & .em-edge.em-dim { opacity: .04; }

  & .em-dot { cursor: pointer; }
  & .em-kind-elf { fill: #9ecbff; stroke: #12121a; stroke-width: 1; }
  & .em-kind-saga { fill: #ffd479; stroke: #12121a; stroke-width: 1; }

  & .em-node text {
    font-size: 9px;
    fill: #c8c8d8;
    pointer-events: none;
  }
  & .em-node.em-dim { opacity: .15; }
  & .em-node.em-focus .em-dot { fill: #ff6b6b; r: 8; }
  & .em-node.em-focus text { fill: #fff; font-weight: 700; }
`)
