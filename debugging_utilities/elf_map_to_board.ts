#!/usr/bin/env -S deno run --allow-net --allow-read --allow-env
/**
 * elf_map_to_board.ts — pushes private/elf-map/graph.json into a real bulletin-board
 *
 * bulletin-board's canonical persistence is TTL written directly to WAS
 * (wasSave() in bulletin-board.js — TTL is tried first on load, JSON is a
 * legacy fallback only). That's a wallet-attached-storage resource PUT via
 * @wallet.storage/fetch-client + an Ed25519 signer, same as was_bootstrap.ts/
 * was_gallery.ts — not a route on plan1's own server.js, and not the plain
 * JSON PUT bulletin-board.js's local save() does (that's a separate,
 * non-canonical braid-only path). boardToTurtle's TTL schema is replicated
 * here by hand since it's pure string templating and its Bayun encryption
 * gracefully no-ops to plaintext without a browser session anyway — same
 * end result, no browser needed.
 *
 * Elf cards get href="/app/<tag>" — click the card's play button on the
 * board to pop that elf open in a fullscreen iframe right there, in place.
 *
 * Usage:
 *   docker compose -f docker-compose.local.yml up -d   # WAS backend
 *   set -a && . .env && set +a && deno run --allow-net --allow-read --allow-env debugging_utilities/elf_map_to_board.ts [board-id]
 */
import { join } from 'jsr:@std/path'
import { Ed25519Signer } from 'npm:@did.coop/did-key-ed25519@0.0.14'
// pinned exact, NOT ^1.1.3 (which floats to 1.3.0 in deno.lock) — the browser's
// importmap hard-pins @wallet.storage/fetch-client@1.1.3 via esm.sh, and 1.1.3
// and 1.3.0 compute resource addressing differently: a resource written by one
// version 404s when read by the other, even with an identical signer/space/path.
// confirmed by direct test — this is NOT an auth or path issue, it's this.
import { StorageClient } from 'npm:@wallet.storage/fetch-client@1.1.3'

const signerJson = Deno.env.get('PLAN98_WAS_SIGNER') ?? ''
const spaceId    = Deno.env.get('PLAN98_WAS_SPACE_ID') ?? ''
const wasHost     = Deno.env.get('PLAN98_WAS_HOST') ?? 'http://localhost:1088'
const plan1Port   = Deno.env.get('PLAN1_PORT') ?? '1998'
const plan1Base   = `http://localhost:${plan1Port}`
const boardId     = Deno.args[0] ?? 'elf-map'

if (!signerJson || !spaceId) {
  console.error('Error: PLAN98_WAS_SIGNER and PLAN98_WAS_SPACE_ID must be set (see .env, or run ./plan1.sh serve once to mint them)')
  Deno.exit(1)
}

const root = new URL('../', import.meta.url).pathname
const graphPath = join(root, 'private', 'elf-map', 'graph.json')

const EDGE_COLOR: Record<string, string> = {
  imports: '#4a7ac9',
  embeds: '#3a9d5c',
  'saga-embeds': '#c97a2e',
  renders: '#c94a8a',
}

type Node = { id: string, kind: 'elf' | 'saga' }
type Edge = { from: string, to: string, type: string }
const graph: { nodes: Node[], edges: Edge[] } = JSON.parse(await Deno.readTextFile(graphPath))

// same circular layout as elf-map.js's viewer, converted to card top-left coords.
// bulletin-board's default camera centers on canvas (2500, 2500) — see
// initialPanX/initialPanY in bulletin-board.js:88-89 — not (0,0), and a
// zoom-1 viewport is only ~1000-1400px wide, so the ring radius needs to
// actually fit on first paint rather than match elf-map.js's much larger
// SVG-viewBox-scaled radius.
const W = 150, H = 60
const R = Math.min(900, Math.max(500, graph.nodes.length * 10))
const CX = 2500, CY = 2500

function pos(i: number, n: number) {
  const angle = (i / n) * Math.PI * 2 - Math.PI / 2
  return { cx: CX + R * Math.cos(angle), cy: CY + R * Math.sin(angle) }
}

const positions: Record<string, { cx: number, cy: number }> = {}
graph.nodes.forEach((node, i) => { positions[node.id] = pos(i, graph.nodes.length) })

type Card = {
  x: number, y: number, w: number, h: number,
  text: string, color: string, href: string, createdAt: number,
  links: Record<string, { from: string, to: string, fromDir: string, toDir: string, typeId: string }>,
}

const cards: Record<string, Card> = {}
for (const node of graph.nodes) {
  const p = positions[node.id]
  cards[node.id] = {
    x: Math.round(p.cx - W / 2), y: Math.round(p.cy - H / 2), w: W, h: H,
    text: node.id,
    color: node.kind === 'elf' ? '#dce8ff' : '#fff3d6',
    href: node.kind === 'elf' ? `/app/${node.id}` : '',
    createdAt: Date.now(),
    links: {},
  }
}

// same dominant-axis idea as bulletin-board's bestCompassPair, simplified to 4-way N/S/E/W
function compassDir(from: Card, to: Card): [string, string] {
  const dx = (to.x + to.w / 2) - (from.x + from.w / 2)
  const dy = (to.y + to.h / 2) - (from.y + from.h / 2)
  if (Math.abs(dx) > Math.abs(dy)) return dx > 0 ? ['E', 'W'] : ['W', 'E']
  return dy > 0 ? ['S', 'N'] : ['N', 'S']
}

const edgeTypes: Record<string, { name: string, color: string }> = {}
for (const type of new Set(graph.edges.map(e => e.type))) {
  edgeTypes[type] = { name: type, color: EDGE_COLOR[type] || '#888888' }
}

let linkCount = 0
for (const edge of graph.edges) {
  const from = cards[edge.from], to = cards[edge.to]
  if (!from || !to) continue
  const [fromDir, toDir] = compassDir(from, to)
  const linkId = crypto.randomUUID()
  from.links[linkId] = { from: edge.from, to: edge.to, fromDir, toDir, typeId: edge.type }
  linkCount++
}

// ── build TTL, matching solid-utils.js's boardToTurtle schema exactly ──────────
// (plaintext content — encryptLiteral no-ops to plaintext without a browser
// Bayun session anyway, so this is the same output that path would produce)

function ttlStr(s: string) {
  return String(s).replace(/\\/g, '\\\\').replace(/"/g, '\\"')
    .replace(/\n/g, '\\n').replace(/\r/g, '\\r').replace(/\t/g, '\\t')
}

const now = new Date().toISOString()
const out: string[] = [
  '@prefix xsd:     <http://www.w3.org/2001/XMLSchema#> .',
  '@prefix dcterms: <http://purl.org/dc/terms/> .',
  '@prefix bb:      <https://plan98.net/vocab/bulletin-board#> .',
  '@prefix ht:      <https://plan98.net/vocab/hypertext#> .',
  '',
  '<> a bb:Board ;',
  `   dcterms:identifier "${ttlStr(boardId)}" ;`,
  `   dcterms:modified "${now}"^^xsd:dateTime .`,
  '',
]

for (const [tid, et] of Object.entries(edgeTypes)) {
  out.push(`<#et-${tid}> a bb:EdgeType ;`)
  out.push(`   bb:typeId "${ttlStr(tid)}" ;`)
  out.push(`   bb:typeName "${ttlStr(et.name)}" ;`)
  out.push(`   bb:typeColor "${ttlStr(et.color)}" .`)
  out.push('')
}

for (const [id, c] of Object.entries(cards)) {
  out.push(`<#${id}> a bb:Card ;`)
  out.push(`   bb:content "${ttlStr(c.text)}" ;`)
  out.push(`   bb:x ${Math.round(c.x)}^^xsd:integer ;`)
  out.push(`   bb:y ${Math.round(c.y)}^^xsd:integer ;`)
  out.push(`   bb:width ${Math.round(c.w)}^^xsd:integer ;`)
  out.push(`   bb:height ${Math.round(c.h)}^^xsd:integer ;`)
  out.push(`   bb:color "${ttlStr(c.color)}" ;`)
  out.push(`   dcterms:created "${new Date(c.createdAt).toISOString()}"^^xsd:dateTime ;`)
  if (c.href) out.push(`   bb:href "${ttlStr(c.href)}" ;`)
  out.push(`   bb:placeholder "true" .`)
  out.push('')
}

for (const [srcId, card] of Object.entries(cards)) {
  for (const [linkId, link] of Object.entries(card.links)) {
    out.push(`<#${linkId}> a ht:TypedLink ;`)
    out.push(`   bb:linkId "${ttlStr(linkId)}" ;`)
    out.push(`   ht:source <#${srcId}> ;`)
    out.push(`   ht:target <#${link.to}> ;`)
    out.push(`   ht:fromDir "${ttlStr(link.fromDir)}" ;`)
    out.push(`   ht:toDir "${ttlStr(link.toDir)}" ;`)
    out.push(`   bb:typeId "${ttlStr(link.typeId)}" ;`)
    out.push(`   bb:placeholder "true" .`)
    out.push('')
    out.push(`<#${srcId}> ht:linksTo <#${link.to}> .`)
    out.push('')
  }
}

const ttl = out.join('\n')

// ── write to WAS, same pattern as was_bootstrap.ts ──────────────────────────

const signer = await Ed25519Signer.fromJSON(signerJson)
const storage = new StorageClient(new URL(wasHost))
const space = storage.space({ signer, id: `urn:uuid:${spaceId}` })

const putRes = await space.resource(`bulletin-board/${boardId}.ttl`).put(
  new Blob([ttl], { type: 'text/turtle' }),
  { signer },
)

if (!putRes.ok) {
  console.error(`PUT bulletin-board/${boardId}.ttl -> ${putRes.status}`)
  console.error('is the WAS backend running? docker compose -f docker-compose.local.yml up -d')
  Deno.exit(1)
}

console.log(`${Object.keys(cards).length} cards, ${linkCount} links, ${Object.keys(edgeTypes).length} edge types (${ttl.length}B TTL)`)
console.log(`\nopen: ${plan1Base}/app/bulletin-board?id=${boardId}`)
