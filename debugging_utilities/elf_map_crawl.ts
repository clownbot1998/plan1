#!/usr/bin/env -S deno run --node-modules-dir=none --allow-net --allow-read --allow-write --allow-env --allow-run --allow-sys
/**
 * elf_map_crawl.ts — runtime pass over elf_map.ts's static graph
 *
 * Visits /app/<tag> for every known elf, headlessly, and records which
 * OTHER known elf tags actually appear in the live DOM after a settle.
 * This is what catches what regex can't: multi-task.js's
 * document.createElement(tag) mounts, and the ${tag}-style dynamic
 * template embeds in couch-coop.js/accessibility-mode.js.
 *
 * Best-effort by nature — many elves need an id/room/attribute to do
 * anything meaningful bare, so a tag showing 0 renders here just means
 * "nothing else mounted from a cold, argument-less visit," not "this
 * elf embeds nothing, ever."
 *
 * Usage:
 *   ./plan1.sh serve                    # needs the app actually running
 *   deno run ... elf_map_crawl.ts
 *
 * Merges 'renders' edges into the existing private/elf-map/graph.json
 * (run elf_map.ts first, or this creates a renders-only graph).
 */
import puppeteer from 'npm:puppeteer-core@23'
import { join } from 'jsr:@std/path'

const plan1Port = Deno.env.get('PLAN1_PORT') ?? '1998'
const plan1Base = `http://localhost:${plan1Port}`
const root = new URL('../', import.meta.url).pathname
const graphPath = join(root, 'private', 'elf-map', 'graph.json')
const indexHtml = await Deno.readTextFile(join(root, 'client/public/index.html'))

const knownTags: string[] = []
for (const m of indexHtml.matchAll(/^\s*'([a-z0-9-]+)':\s*'\/elves\//gm)) knownTags.push(m[1])
console.log(`${knownTags.length} known elf tags to crawl`)

async function findChromium() {
  for (const name of ['chromium', 'chromium-browser', 'google-chrome']) {
    try {
      const { success, stdout } = await new Deno.Command('which', { args: [name], stdout: 'piped', stderr: 'null' }).output()
      if (success) return new TextDecoder().decode(stdout).trim()
    } catch { /* try next */ }
  }
  throw new Error('no chromium found on $PATH')
}

let graph: { nodes: { id: string, kind: string }[], edges: { from: string, to: string, type: string }[], [k: string]: unknown }
try {
  graph = JSON.parse(await Deno.readTextFile(graphPath))
} catch {
  console.log('no existing graph.json — run ./plan1.sh elf-map first for the static pass. starting fresh.')
  graph = { nodes: knownTags.map(id => ({ id, kind: 'elf' })), edges: [] }
}
// drop any stale renders edges from a prior crawl, keep static ones
graph.edges = graph.edges.filter(e => e.type !== 'renders')

const browser = await puppeteer.launch({
  executablePath: await findChromium(),
  headless: true,
  args: ['--no-sandbox', '--disable-gpu'],
})

// plan98-modal.js:98 self-mounts to document.body at module-load time, on
// every single page, regardless of which elf is active — that's page-chrome
// infrastructure (a modal host), not a genuine per-elf embed relationship.
// excluding it explicitly rather than letting a hub node with in-degree ~80
// dominate/clutter the graph.
const GLOBAL_CHROME = new Set(['plan98-modal'])

const selector = knownTags.join(',')
let ok = 0, fail = 0, totalEdges = 0

for (const tag of knownTags) {
  const page = await browser.newPage()
  try {
    // networkidle0 hangs on elves with persistent connections (multi-task's
    // WAS/SSE sync never goes idle) — settle on our own clock instead.
    await page.goto(`${plan1Base}/app/${tag}`, { waitUntil: 'domcontentloaded', timeout: 10000 })
    await new Promise(r => setTimeout(r, 1200)) // let async mounts (fetch, requestIdleCallback) settle

    const mounted: string[] = (await page.evaluate((sel: string, self_: string) => {
      return [...new Set([...document.querySelectorAll(sel)].map(el => el.tagName.toLowerCase()))]
        .filter(t => t !== self_)
    }, selector, tag)).filter(t => !GLOBAL_CHROME.has(t))

    for (const to of mounted) {
      graph.edges.push({ from: tag, to, type: 'renders' })
      totalEdges++
    }
    console.log(`OK   ${tag}  (${mounted.length} mounted: ${mounted.join(', ') || '—'})`)
    ok++
  } catch (e) {
    console.log(`FAIL ${tag}  (${e instanceof Error ? e.message : String(e)})`)
    fail++
  } finally {
    // a crashed/detached page can throw here too — never let that take the
    // whole crawl (and the accumulated graph data) down with it.
    try { await page.close() } catch { /* already gone */ }
  }

  // checkpoint after every tag — a later crash still leaves the graph
  // written up through the last successful tag instead of losing everything.
  await Deno.writeTextFile(graphPath, JSON.stringify(graph, null, 2))
}

await browser.close()

// re-dedupe (a tag can mount the same other tag more than once)
const seen = new Set<string>()
graph.edges = graph.edges.filter(e => {
  const k = `${e.from} ${e.to} ${e.type}`
  if (seen.has(k)) return false
  seen.add(k)
  return true
})

const nodeIds = new Set(graph.nodes.map(n => n.id))
for (const e of graph.edges) {
  if (!nodeIds.has(e.from)) { graph.nodes.push({ id: e.from, kind: knownTags.includes(e.from) ? 'elf' : 'saga' }); nodeIds.add(e.from) }
  if (!nodeIds.has(e.to)) { graph.nodes.push({ id: e.to, kind: knownTags.includes(e.to) ? 'elf' : 'saga' }); nodeIds.add(e.to) }
}

graph.crawledAt = new Date().toISOString()
await Deno.writeTextFile(graphPath, JSON.stringify(graph, null, 2))

console.log(`\n${ok} crawled, ${fail} failed, ${totalEdges} renders edges → ${graphPath}`)
