#!/usr/bin/env -S deno run --allow-net --allow-read --allow-write --allow-env --allow-run --allow-sys
/**
 * e2e_test.ts — headless-chromium flow runner with a screenshot per step
 *
 * Flows live in FLOWS below: a URL plus a list of named steps, each an
 * async (page) => {ok, note?} check. Every step gets screenshotted
 * regardless of pass/fail, so a broken flow still leaves a filmstrip.
 *
 * Usage:
 *   deno run ... e2e_test.ts <flow-name>
 *   deno run ... e2e_test.ts           # runs every flow
 *
 * Output:
 *   private/screenshots/e2e/<flow>/<NN>-<step>.png
 *   private/screenshots/e2e/<flow>/manifest.json
 *   private/screenshots/e2e/index.json   (upserted, one entry per flow)
 */
import puppeteer from 'npm:puppeteer-core@23'
import { join, dirname } from 'jsr:@std/path'

const plan1Port = Deno.env.get('PLAN1_PORT') ?? '1998'
const plan1Base = `http://localhost:${plan1Port}`
const root = new URL('../', import.meta.url).pathname
const screenshotsRoot = join(root, 'private', 'screenshots', 'e2e')

type StepResult = { ok: boolean, note?: string }
type Step = { name: string, run: (page: any) => Promise<StepResult | void> }
type Flow = { name: string, url: string, steps: Step[] }

async function swipe(page: any, selector: string, dx: number) {
  const box = await page.evaluate((sel: string) => {
    const el = document.querySelector(sel)
    if (!el) return null
    const r = el.getBoundingClientRect()
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 }
  }, selector)
  if (!box) throw new Error(`swipe target not found: ${selector}`)
  await page.mouse.move(box.x - dx / 2, box.y)
  await page.mouse.down()
  await page.mouse.move(box.x + dx / 2, box.y, { steps: 5 })
  await page.mouse.up()
  // let the click/pointerup handlers settle before polling the DOM
  await new Promise(r => setTimeout(r, 150))
}

async function activeSlideTag(page: any) {
  return page.evaluate(() => {
    const stage = document.querySelector('saga-pitch [name="stage"] > [data-active]')
    return stage ? stage.tagName.toLowerCase() : null
  })
}

// swiping just changes activeShot — the embedded elf (bulletin-board, pot-luck, etc.)
// still has to mount and fetch its own data async, on its own clock. a flat sleep
// either wastes time on the fast ones or is too short for the slow ones, so poll
// for real content instead and fall back to the timeout as a safety net.
async function waitForRendered(page: any, tag: string, timeoutMs = 4000) {
  try {
    await page.waitForFunction(
      (t: string) => {
        const el = document.querySelector(`[name="stage"] > ${t}[data-active]`)
        return !!el && (el.children.length > 0 || el.shadowRoot?.children?.length > 0)
      },
      { timeout: timeoutMs, polling: 100 },
      tag,
    )
    return { timedOut: false }
  } catch {
    return { timedOut: true }
  }
}

const FLOWS: Flow[] = [
  {
    name: 'dweb-camp-swipe',
    url: `${plan1Base}/app/dweb-camp`,
    steps: [
      { name: 'load', run: async () => {} },
      {
        name: 'dismiss-welcome',
        run: async page => {
          await page.waitForSelector('saga-pitch [data-close-welcome]', { timeout: 10000 })
          await page.click('saga-pitch [data-close-welcome]')
          await new Promise(r => setTimeout(r, 400))
        },
      },
      ...['cdn-video', 'accessibility-mode', 'pot-luck', 'bulletin-board'].map((expected, i) => ({
        name: `swipe-${i + 1}-expect-${expected}`,
        run: async (page: any) => {
          if (i > 0) await swipe(page, 'saga-pitch [name="screen"]', -200)
          const tag = await activeSlideTag(page)
          const { timedOut } = await waitForRendered(page, expected, 4000)
          // mounting a "loading…" placeholder already satisfies children.length > 0,
          // so give async fetches (IndexedDB, network) a beat to actually paint.
          if (!timedOut) await new Promise(r => setTimeout(r, 500))
          const note = `active=${tag}` + (timedOut ? ' (timed out waiting for content)' : '')
          return { ok: tag === expected && !timedOut, note }
        },
      })),
    ],
  },
]

function padNum(n: number) { return String(n).padStart(2, '0') }

async function runFlow(flow: Flow, browser: any) {
  const outDir = join(screenshotsRoot, flow.name)
  await Deno.mkdir(outDir, { recursive: true })

  const page = await browser.newPage()
  await page.setViewport({ width: 1280, height: 800 })
  const consoleErrors: string[] = []
  page.on('pageerror', (e: Error) => consoleErrors.push(`pageerror: ${e.message}`))
  page.on('console', (msg: any) => { if (msg.type() === 'error') consoleErrors.push(`console: ${msg.text()}`) })

  await page.goto(flow.url, { waitUntil: 'networkidle0', timeout: 20000 })

  const results = []
  let stepNum = 0
  for (const step of flow.steps) {
    let result: StepResult = { ok: true }
    try {
      const r = await step.run(page)
      if (r) result = r
    } catch (e) {
      result = { ok: false, note: e instanceof Error ? e.message : String(e) }
    }

    const fileName = `${padNum(stepNum)}-${step.name}.png`
    await page.screenshot({ path: join(outDir, fileName) })
    results.push({ step: step.name, screenshot: fileName, ...result })
    console.log(`  ${result.ok ? 'OK  ' : 'FAIL'} ${step.name}${result.note ? '  (' + result.note + ')' : ''}`)
    stepNum++
  }

  await page.close()

  const manifest = {
    flow: flow.name,
    url: flow.url,
    ranAt: new Date().toISOString(),
    ok: results.every(r => r.ok),
    steps: results,
    consoleErrors,
  }
  await Deno.writeTextFile(join(outDir, 'manifest.json'), JSON.stringify(manifest, null, 2))
  return manifest
}

async function upsertIndex(manifest: { flow: string, ok: boolean, ranAt: string, steps: unknown[] }) {
  const indexPath = join(screenshotsRoot, 'index.json')
  let index: Record<string, unknown> = {}
  try { index = JSON.parse(await Deno.readTextFile(indexPath)) } catch { /* first run */ }
  index[manifest.flow] = { ok: manifest.ok, ranAt: manifest.ranAt, stepCount: manifest.steps.length }
  await Deno.mkdir(dirname(indexPath), { recursive: true })
  await Deno.writeTextFile(indexPath, JSON.stringify(index, null, 2))
}

const requested = Deno.args[0]
const flows = requested ? FLOWS.filter(f => f.name === requested) : FLOWS
if (requested && flows.length === 0) {
  console.error(`no such flow: ${requested}\navailable: ${FLOWS.map(f => f.name).join(', ')}`)
  Deno.exit(1)
}

const browser = await puppeteer.launch({
  executablePath: '/usr/bin/chromium',
  headless: true,
  args: ['--no-sandbox', '--disable-gpu'],
})

let allOk = true
for (const flow of flows) {
  console.log(`\n${flow.name}`)
  const manifest = await runFlow(flow, browser)
  await upsertIndex(manifest)
  if (!manifest.ok) allOk = false
}

await browser.close()
console.log(`\n${allOk ? 'all flows passed' : 'some flows failed'}`)
Deno.exit(allOk ? 0 : 1)
