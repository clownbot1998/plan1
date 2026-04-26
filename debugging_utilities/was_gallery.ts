#!/usr/bin/env -S deno run --allow-run --allow-net --allow-env --allow-read --allow-write
/**
 * was_gallery.ts — screenshot each item in a preview-gallery config
 *
 * Usage:
 *   deno run ... was_gallery.ts --id <gallery-id>
 *   deno run ... was_gallery.ts --id <gallery-id> --dry-run
 *
 * Reads /preview-gallery/<id>/index.json from the local server,
 * screenshots each item URL via CDP, saves to private/screenshots/<id>/<item-id>.png
 */
import { Ed25519Signer } from 'npm:@did.coop/did-key-ed25519@0.0.14'
import { StorageClient } from 'npm:@wallet.storage/fetch-client@^1.1.3'
import { join, dirname } from 'jsr:@std/path'

const args      = Deno.args
const galleryId = args[args.indexOf('--id') + 1]
const dryRun    = args.includes('--dry-run')
const waitIdx   = args.indexOf('--wait')
const settleMs  = waitIdx >= 0 ? parseInt(args[waitIdx + 1]) : 1500
const plan1Port = Deno.env.get('PLAN1_PORT') ?? '1998'
const plan1Base = `http://localhost:${plan1Port}`

if (!galleryId) { console.error('Usage: was_gallery.ts --id <gallery-id>'); Deno.exit(1) }

// ── load config from server (which falls back to WAS) ────────────────────────

const configRes = await fetch(`${plan1Base}/preview-gallery/${galleryId}/index.json`).catch(() => null)
if (!configRes?.ok) {
  console.error(`Could not load /preview-gallery/${galleryId}/index.json — is the server running?`)
  Deno.exit(1)
}
const config = await configRes.json()
const items: { id: string; url: string }[] = config.items ?? []

if (!items.length) { console.log('No items in config.'); Deno.exit(0) }

console.log(`Gallery: ${galleryId} — ${items.length} items\n`)

// ── persistent CDP session ────────────────────────────────────────────────────

const CDP_PORT = 19223
const root     = new URL('../', import.meta.url).pathname
const outDir   = join(root, 'private', 'screenshots', galleryId)

await Deno.mkdir(outDir, { recursive: true })

const cdpProc = new Deno.Command('chromium', {
  args: [
    `--remote-debugging-port=${CDP_PORT}`,
    '--headless=new', '--no-sandbox', '--disable-gpu',
    '--ozone-platform=headless', '--window-size=1280,800',
    '--user-data-dir=/tmp/cdp-gallery-profile',
  ],
  stdout: 'null', stderr: 'null',
}).spawn()

// wait for CDP
async function waitCDP(ms = 8000) {
  const deadline = Date.now() + ms
  while (Date.now() < deadline) {
    try { const r = await fetch(`http://localhost:${CDP_PORT}/json/version`); if (r.ok) return } catch { /* */ }
    await new Promise(r => setTimeout(r, 150))
  }
  throw new Error('CDP did not start')
}
await waitCDP()

const tabsRes = await fetch(`http://localhost:${CDP_PORT}/json/list`)
const tabs    = await tabsRes.json()
const tab     = tabs.find((t: { type: string }) => t.type === 'page')
if (!tab) { console.error('no page tab'); cdpProc.kill(); Deno.exit(1) }

const ws = new WebSocket(tab.webSocketDebuggerUrl)
await new Promise<void>(r => ws.addEventListener('open', () => r(), { once: true }))

let msgId = 1
function send(method: string, params: Record<string, unknown> = {}) {
  const id = msgId++
  ws.send(JSON.stringify({ id, method, params }))
  return new Promise<unknown>(resolve => {
    function h(e: MessageEvent) {
      const msg = JSON.parse(e.data)
      if (msg.id === id) { ws.removeEventListener('message', h); resolve(msg.result) }
    }
    ws.addEventListener('message', h)
  })
}
function waitEvent(event: string) {
  return new Promise<unknown>(resolve => {
    function h(e: MessageEvent) {
      const msg = JSON.parse(e.data)
      if (msg.method === event) { ws.removeEventListener('message', h); resolve(msg.params) }
    }
    ws.addEventListener('message', h)
  })
}

await send('Page.enable')

// ── screenshot each item ──────────────────────────────────────────────────────

let ok = 0, fail = 0

for (const item of items) {
  const targetUrl = item.url.startsWith('http') ? item.url : plan1Base + item.url
  const outFile   = join(outDir, `${item.id}.png`)

  if (dryRun) { console.log(`DRY  ${item.id}  →  ${targetUrl}  →  ${outFile}`); ok++; continue }

  try {
    const loaded = waitEvent('Page.loadEventFired')
    await send('Page.navigate', { url: targetUrl })
    await loaded
    await new Promise(r => setTimeout(r, settleMs))

    const shot = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false }) as { data: string }
    const bytes = Uint8Array.from(atob(shot.data), c => c.charCodeAt(0))
    await Deno.writeFile(outFile, bytes)
    console.log(`OK   ${item.id}  (${bytes.length}B)  →  ${outFile}`)
    ok++
  } catch(e: unknown) {
    console.log(`ERR  ${item.id}: ${e instanceof Error ? e.message : String(e)}`)
    fail++
  }
}

ws.close()
cdpProc.kill()

console.log(`\nDone: ${ok} screenshots, ${fail} failed`)
if (fail > 0) Deno.exit(1)
