#!/usr/bin/env -S deno run --allow-run --allow-net --allow-write
/**
 * screenshot.ts — headless Chromium screenshot via CDP
 *
 * Usage:
 *   deno run ... screenshot.ts <url> [output.png]
 */

const url    = Deno.args[0] ?? 'http://localhost:1998'
const outFile = Deno.args[1] ?? '/tmp/clown-eyes.png'
const PORT   = 19222

// spawn chromium with remote debugging
const proc = new Deno.Command('chromium', {
  args: [
    `--remote-debugging-port=${PORT}`,
    '--headless=new',
    '--no-sandbox',
    '--disable-gpu',
    '--ozone-platform=headless',
    '--window-size=1280,800',
    '--user-data-dir=/tmp/cdp-profile',
  ],
  stdout: 'null',
  stderr: 'null',
}).spawn()

// wait for CDP to be ready
async function waitForCDP(ms = 5000) {
  const deadline = Date.now() + ms
  while (Date.now() < deadline) {
    try {
      const r = await fetch(`http://localhost:${PORT}/json/version`)
      if (r.ok) return
    } catch { /* not ready yet */ }
    await new Promise(r => setTimeout(r, 100))
  }
  throw new Error('CDP did not start in time')
}

await waitForCDP()

// get the existing blank page tab
const tabsRes = await fetch(`http://localhost:${PORT}/json/list`)
const tabs    = await tabsRes.json()
const tab     = tabs.find((t: { type: string }) => t.type === 'page')
if (!tab) throw new Error('no page tab found in CDP')
const wsUrl   = tab.webSocketDebuggerUrl

const ws = new WebSocket(wsUrl)
await new Promise<void>(r => ws.addEventListener('open', () => r(), { once: true }))

let msgId = 1
function send(method: string, params: Record<string, unknown> = {}) {
  const id = msgId++
  ws.send(JSON.stringify({ id, method, params }))
  return new Promise<unknown>(resolve => {
    function handler(e: MessageEvent) {
      const msg = JSON.parse(e.data)
      if (msg.id === id) { ws.removeEventListener('message', handler); resolve(msg.result) }
    }
    ws.addEventListener('message', handler)
  })
}

function waitForEvent(event: string) {
  return new Promise<unknown>(resolve => {
    function handler(e: MessageEvent) {
      const msg = JSON.parse(e.data)
      if (msg.method === event) { ws.removeEventListener('message', handler); resolve(msg.params) }
    }
    ws.addEventListener('message', handler)
  })
}

await send('Page.enable')
const loaded = waitForEvent('Page.loadEventFired')
await send('Page.navigate', { url })
await loaded

// small settle delay for JS to render
await new Promise(r => setTimeout(r, 1500))

const shot = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false }) as { data: string }
const bytes = Uint8Array.from(atob(shot.data), c => c.charCodeAt(0))
await Deno.writeFile(outFile, bytes)

console.log(`screenshot saved to ${outFile} (${bytes.length}B)`)

ws.close()
proc.kill()
Deno.exit(0)
