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
type Flow = { name: string, url: string, steps: Step[], waitUntil?: 'networkidle0' | 'domcontentloaded', beforeGoto?: () => Promise<void> }

// shells out to `deno run reset_test_state.ts` — a fresh puppeteer profile
// does NOT mean a fresh app state for anything that persists server-side
// (WAS), and accessibility-mode's workspaces/tabs/chat history do exactly
// that. any flow that needs a deterministic starting point should reset
// first, the same way a test fixture gets a factory reset.
async function resetTestState() {
  const root = new URL('../', import.meta.url).pathname
  const cmd = new Deno.Command('deno', {
    args: ['run', '--node-modules-dir=none', '--allow-net', '--allow-env', '--env-file=' + join(root, '.env'), join(root, 'debugging_utilities', 'reset_test_state.ts')],
    stdout: 'piped', stderr: 'piped',
  })
  const { success, stdout, stderr } = await cmd.output()
  const out = new TextDecoder().decode(success ? stdout : stderr).trim()
  console.log(`  reset-test-state: ${out}`)
}

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

// the model list is fetched from whatever remote endpoint
// ACCESSIBILITY_MODE_LOCK points at — latency is real and variable, so poll
// instead of trusting a single fixed delay to be enough.
async function selectModel(page: any, modelSubstring: string, timeoutMs = 15000) {
  await page.waitForSelector('[data-model-select]', { timeout: 10000 })
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    const result = await page.evaluate((sub: string) => {
      const sel = document.querySelector('[data-model-select]') as HTMLSelectElement
      const opt = [...sel.options].find(o => o.value.includes(sub))
      if (!opt) return { ok: false, options: [...sel.options].map(o => o.value) }
      if (sel.value !== opt.value) {
        sel.value = opt.value
        sel.dispatchEvent(new Event('change', { bubbles: true }))
      }
      return { ok: true, selected: sel.value }
    }, modelSubstring)
    if (result.ok) return result
    await new Promise(r => setTimeout(r, 500))
  }
  return { ok: false, selected: null }
}

async function sendChatMessage(page: any, text: string) {
  const ta = await page.waitForSelector('textarea[name="messageText"], input[name="messageText"]', { timeout: 8000 })
  await ta.click({ clickCount: 3 })
  await ta.type(text)
  await page.keyboard.press('Enter')
}

// approves every human-permission prompt as it appears, up to timeoutMs total,
// stopping once no prompt is showing AND the agent isn't mid tool-call (a
// short settle window after the last approval, so we don't quit between two
// back-to-back prompts).
async function approveAllPrompts(page: any, timeoutMs: number) {
  const start = Date.now()
  let approvals = 0
  let sinceLastPrompt = 0
  while (Date.now() - start < timeoutMs) {
    const hasPrompt = await page.evaluate(() => !!document.querySelector('.human-prompt-yes'))
    if (hasPrompt) {
      await page.click('.human-prompt-yes')
      approvals++
      sinceLastPrompt = 0
      await new Promise(r => setTimeout(r, 700))
      continue
    }
    sinceLastPrompt += 500
    // a 24b model generating the next tool call after digesting a read_file
    // result can genuinely take longer than a few seconds against a real
    // remote endpoint — too short a window here reads as "done" when it's
    // actually just thinking.
    if (sinceLastPrompt > 60000) break
    await new Promise(r => setTimeout(r, 500))
  }
  return approvals
}

const FLOWS: Flow[] = [
  {
    name: 'accessibility-mode-edit-loop',
    url: `${plan1Base}/app/accessibility-mode`,
    waitUntil: 'domcontentloaded',
    beforeGoto: resetTestState,
    steps: [
      // the model list is fetched from the configured remote endpoint
      // (ACCESSIBILITY_MODE_LOCK) and the sessions/workspace view is
      // populated from IndexedDB, both async — neither is done right after
      // domcontentloaded.
      { name: 'load', run: async () => { await new Promise(r => setTimeout(r, 4000)) } },
      {
        name: 'new-chat-and-select-model',
        run: async page => {
          // the model-select dropdown lives in a persistent topbar shared by
          // BOTH the sessions/workspace browser and the actual compose view
          // — its presence doesn't confirm we've left the sessions view.
          // the textarea only exists in the compose view, so wait for THAT,
          // retrying the click if it doesn't show up the first time.
          let newChatClicked = false
          let reachedCompose = false
          for (let attempt = 0; attempt < 3 && !reachedCompose; attempt++) {
            try {
              const btn = await page.waitForSelector('[data-new-chat]', { timeout: 5000 })
              await btn.click()
              newChatClicked = true
            } catch {}
            try {
              await page.waitForSelector('textarea[name="messageText"], input[name="messageText"]', { timeout: 4000 })
              reachedCompose = true
            } catch {}
          }
          const model = await selectModel(page, 'ornith:9b')
          return { ok: !!model.ok && reachedCompose, note: `model=${model.selected ?? 'NOT FOUND'} newChat=${newChatClicked} composeView=${reachedCompose}` }
        },
      },
      {
        name: 'authenticate',
        // patch_file 401s without this. going through "admin" as a typed
        // chat command opens a separate full-screen accessibility keyboard
        // overlay (unrelated to the tool-calling loop this flow is actually
        // demonstrating) — hit the login API directly instead, the same
        // request that flow ends up making anyway.
        run: async page => {
          const ok = await page.evaluate(async (passphrase: string) => {
            const res = await fetch('/api/login', {
              method: 'POST',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify({ passphrase }),
            })
            return res.ok
          }, Deno.env.get('PLAN1_PASSPHRASE') ?? 'clownbot')
          return { ok, note: ok ? 'authenticated' : 'login failed' }
        },
      },
      {
        name: 'send-edit-request',
        run: async page => {
          await sendChatMessage(page, 'change the button color in pot-luck to orange')
        },
      },
      {
        // some models answer with a clarifying question instead of acting
        // right away (confirmed: ornith:9b asked "which buttons — all of
        // them, or just specific ones?" instead of picking one, unlike
        // mistral-small3.2:24b which just went with .po-btn-go directly —
        // a real behavior difference, not a bug). give it a beat, then
        // answer if no tool-call prompt showed up on its own.
        name: 'answer-clarifying-question-if-asked',
        run: async page => {
          await new Promise(r => setTimeout(r, 8000))
          const state = await page.evaluate(() => ({
            hasPrompt: !!document.querySelector('.human-prompt-yes'),
            thinking: !!document.querySelector('.thinking-disk'),
          }))
          if (!state.hasPrompt && !state.thinking) {
            await sendChatMessage(page, 'just the primary action button (.po-btn-go)')
            return { ok: true, note: 'answered a clarifying question' }
          }
          return { ok: true, note: 'no clarifying question — proceeding' }
        },
      },
      {
        name: 'approve-tool-calls',
        run: async page => {
          const approvals = await approveAllPrompts(page, 240000)
          return { ok: approvals > 0, note: `${approvals} tool call(s) approved` }
        },
      },
      {
        name: 'view-agent-logs',
        run: async page => {
          // the agent's own final step (per its system prompt) is calling
          // set_preview once the edit succeeds, which takes over the WHOLE
          // view (previewOpen replaces chat/logs entirely) — the logs
          // toggle button does nothing while that's showing. close it first.
          const isPreviewOpen = await page.evaluate(() => !!document.querySelector('[data-toggle-preview].-active'))
          if (isPreviewOpen) {
            await page.click('[data-toggle-preview]').catch(() => {})
            await new Promise(r => setTimeout(r, 300))
          }
          await page.click('[data-toggle-logs]').catch(() => {})
          await new Promise(r => setTimeout(r, 500))
          const logsText = await page.evaluate(() => document.querySelector('.messages')?.innerText ?? '')
          const sawPatch = /patch_file/.test(logsText)
          return { ok: sawPatch, note: sawPatch ? 'patch_file call visible in logs' : 'no patch_file call found in logs' }
        },
      },
      {
        name: 'preview-pot-luck-button-color',
        run: async page => {
          // /elves/*.js is served WAS-first (server.js: "reads come back
          // from WAS so any node sharing the same space sees live edits") —
          // patch_file's own PUT round-trip to WAS can trail its HTTP
          // response by a beat, so poll a few fresh loads instead of
          // trusting the very next request to already reflect it.
          //
          // which SELECTOR gets the edit varies by model — confirmed
          // directly: mistral-small3.2:24b picked .po-btn-go (the colored
          // primary-action button), ornith:9b picked the neutral base
          // .po-btn instead (affecting every button). check every po-btn
          // variant and accept any orange-ish shade, not one exact RGB
          // formula — #FFA500 and #e67e22 (carrot orange) are both
          // reasonable answers to "make it orange" and neither should read
          // as a false failure just because it's not the other one's exact
          // hex.
          const isOrangeish = (rgb: string | null) => {
            if (!rgb) return false
            const m = rgb.match(/rgb\((\d+),\s*(\d+),\s*(\d+)\)/)
            if (!m) return false
            const [, r, g, b] = m.map(Number)
            return r >= 180 && g >= 60 && g <= 200 && b <= 100 && r > g && g > b
          }
          let colors: string[] = []
          for (let attempt = 0; attempt < 5; attempt++) {
            await page.goto(`${plan1Base}/app/pot-luck?_v=${Date.now()}`, { waitUntil: 'domcontentloaded', timeout: 15000 })
            await new Promise(r => setTimeout(r, 1500))
            colors = await page.evaluate(() => {
              const btns = [...document.querySelectorAll('pot-luck [class*="po-btn"]')]
              return btns.map(b => getComputedStyle(b).backgroundColor)
            })
            if (colors.some(isOrangeish)) break
            await new Promise(r => setTimeout(r, 1500))
          }
          const found = colors.find(isOrangeish)
          return { ok: !!found, note: `button colors seen: ${colors.join(', ') || 'none found'}` }
        },
      },
    ],
  },
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
      ...['cdn-video', 'accessibility-mode', 'pot-luck', 'bulletin-board', 'cdn-video', 'elf-map'].map((expected, i) => ({
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
  {
    name: 'elf-jo-book',
    url: `${plan1Base}/app/elf-jo`,
    steps: [
      { name: 'load', run: async () => {} },
      ...Array.from({ length: 12 }, (_, i) => ({
        name: `next-to-chapter-${i + 2}`,
        run: async (page: any) => {
          await page.click('elf-jo .nav.next')
          await new Promise(r => setTimeout(r, 100))
          const progress = await page.$eval('elf-jo .progress', (el: any) => el.textContent)
          const ok = progress.includes(`Chapter ${i + 2} `)
          return { ok, note: progress }
        },
      })),
      {
        name: 'hello-demo',
        run: async (page: any) => {
          // walked to chapter 13 by the loop above; back up to 7 for hello()
          for (let i = 0; i < 6; i++) await page.click('elf-jo .nav.prev')
          await new Promise(r => setTimeout(r, 100))
          await page.click('elf-jo [data-run="hello"]')
          const out = await page.$eval('elf-jo .demo .out', (el: any) => el.textContent)
          return { ok: out.includes('Hello'), note: out }
        },
      },
      {
        name: 'social-vibe-toggle',
        run: async (page: any) => {
          await page.click('elf-jo .nav.next')
          await new Promise(r => setTimeout(r, 100))
          await page.click('elf-jo .vibe-toggle')
          const out = await page.$eval('elf-jo .demo .out', (el: any) => el.textContent)
          return { ok: out.includes('Goodbye'), note: out }
        },
      },
      {
        name: 'math-demo-multiply',
        run: async (page: any) => {
          await page.click('elf-jo .nav.next')
          await new Promise(r => setTimeout(r, 100))
          await page.select('elf-jo .demo select.op', 'Multiply')
          await page.evaluate(() => {
            const a = document.querySelector('elf-jo .demo input.a') as any
            const b = document.querySelector('elf-jo .demo input.b') as any
            a.value = '4'; a.dispatchEvent(new Event('input', { bubbles: true }))
            b.value = '5'; b.dispatchEvent(new Event('input', { bubbles: true }))
          })
          await new Promise(r => setTimeout(r, 100))
          const out = await page.$eval('elf-jo .demo .out', (el: any) => el.textContent)
          return { ok: out.includes('20'), note: out }
        },
      },
      {
        name: 'boot-demos',
        run: async (page: any) => {
          // chapter 9 (math) -> 10 (errors, no demo) -> 11 (error handling, demo=boot)
          await page.click('elf-jo .nav.next')
          await new Promise(r => setTimeout(r, 100))
          await page.click('elf-jo .nav.next')
          await new Promise(r => setTimeout(r, 100))
          await page.click('elf-jo [data-run="boot-ok"]')
          await page.click('elf-jo [data-run="boot-bad"]')
          const log = await page.$eval('elf-jo .bootlog', (el: any) => el.textContent)
          return { ok: log.includes('main()') && log.includes('caught:'), note: log }
        },
      },
      {
        name: 'chapter-13-locked-until-choice',
        run: async (page: any) => {
          // chapter 11 (error handling) -> 12 (main street) -> 13 (infinite reality, demo=choice)
          await page.click('elf-jo .nav.next')
          await new Promise(r => setTimeout(r, 100))
          await page.click('elf-jo .nav.next')
          await new Promise(r => setTimeout(r, 100))
          const disabledBefore = await page.$eval('elf-jo .nav.next', (el: any) => el.disabled)
          await page.click('elf-jo [data-run="no"]')
          await new Promise(r => setTimeout(r, 100))
          const stillLockedAfterNo = await page.$eval('elf-jo .nav.next', (el: any) => el.disabled)
          await page.click('elf-jo [data-run="yes"]')
          await new Promise(r => setTimeout(r, 100))
          const progress = await page.$eval('elf-jo .progress', (el: any) => el.textContent)
          const ok = disabledBefore && stillLockedAfterNo && progress.includes('Chapter 14')
          return { ok, note: `before=${disabledBefore} afterNo=${stillLockedAfterNo} ${progress}` }
        },
      },
      {
        name: 'fiction-set-demo',
        run: async (page: any) => {
          await page.click('elf-jo .nav.next')
          await new Promise(r => setTimeout(r, 100))
          await page.click('elf-jo [data-run="fiction-name"]')
          await new Promise(r => setTimeout(r, 100))
          await page.click('elf-jo [data-run="fiction-beverage"]')
          await new Promise(r => setTimeout(r, 100))
          const out = await page.$eval('elf-jo .demo .out', (el: any) => el.textContent)
          return { ok: out.includes('name') && out.includes('beverage'), note: out }
        },
      },
    ],
  },
  {
    name: 'flip-book-sidebar',
    url: `${plan1Base}/app/flip-book`,
    steps: [
      { name: 'load', run: async () => { await new Promise(r => setTimeout(r, 500)) } },
      {
        name: 'open-sidebar',
        run: async (page: any) => {
          await page.click('flip-book [data-toggle-sidebar]')
          await new Promise(r => setTimeout(r, 200))
          const open = await page.$eval('flip-book [data-sidebar]', (el: any) => el.dataset.open)
          return { ok: open === 'true', note: `data-open=${open}` }
        },
      },
      {
        name: 'brush-open-by-default',
        run: async (page: any) => {
          const collapsed = await page.$eval('flip-book [data-fb-section-body="brush"]', (el: any) => el.classList.contains('fb-acc-collapsed'))
          return { ok: !collapsed, note: `collapsed=${collapsed}` }
        },
      },
      {
        name: 'expand-playback-accordion',
        run: async (page: any) => {
          await page.click('flip-book [data-toggle-fb-section="playback"]')
          await new Promise(r => setTimeout(r, 150))
          const collapsed = await page.$eval('flip-book [data-fb-section-body="playback"]', (el: any) => el.classList.contains('fb-acc-collapsed'))
          return { ok: !collapsed, note: `collapsed=${collapsed}` }
        },
      },
      {
        name: 'stroke-swatch-opens-popover-with-palette',
        run: async (page: any) => {
          await page.click('flip-book [data-open-popover="stroke"]')
          await new Promise(r => setTimeout(r, 150))
          const open = await page.$eval('flip-book [data-fb-popover]', (el: any) => el.classList.contains('open'))
          const hasPalette = await page.$('flip-book [data-fb-popover] plan98-palette') !== null
          return { ok: open && hasPalette, note: `open=${open} palette=${hasPalette}` }
        },
      },
      {
        name: 'outside-click-closes-popover',
        run: async (page: any) => {
          // click a plain kv-row label inside the (still-open) sidebar — closes the
          // popover without tripping flip-book's own click-outside-sidebar auto-close
          await page.click('flip-book .fb-kv-key')
          await new Promise(r => setTimeout(r, 150))
          const open = await page.$eval('flip-book [data-fb-popover]', (el: any) => el.classList.contains('open'))
          return { ok: !open, note: `open=${open}` }
        },
      },
      {
        name: 'size-popover-pick-closes-and-updates-value',
        run: async (page: any) => {
          await page.click('flip-book [data-open-popover="size"]')
          await new Promise(r => setTimeout(r, 150))
          await page.click('flip-book [data-fb-popover] [data-thick="32"]')
          await new Promise(r => setTimeout(r, 150))
          const label = await page.$eval('flip-book [data-open-popover="size"]', (el: any) => el.textContent)
          const open = await page.$eval('flip-book [data-fb-popover]', (el: any) => el.classList.contains('open'))
          return { ok: label.includes('32px') && !open, note: `label=${label} popoverOpen=${open}` }
        },
      },
      {
        name: 'fps-select-popover-pick-closes-and-updates-value',
        run: async (page: any) => {
          await page.click('flip-book [data-open-popover="fps"]')
          await new Promise(r => setTimeout(r, 150))
          await page.select('flip-book [data-fb-popover] [data-fps-select]', '24')
          await new Promise(r => setTimeout(r, 150))
          const label = await page.$eval('flip-book [data-open-popover="fps"]', (el: any) => el.textContent)
          const open = await page.$eval('flip-book [data-fb-popover]', (el: any) => el.classList.contains('open'))
          return { ok: label.trim() === '24' && !open, note: `label=${label} popoverOpen=${open}` }
        },
      },
      {
        name: 'camera-toggle-is-direct-no-popover',
        run: async (page: any) => {
          await page.click('flip-book [data-toggle-fb-section="camera"]')
          await new Promise(r => setTimeout(r, 150))
          await page.click('flip-book [data-toggle-camera]')
          await new Promise(r => setTimeout(r, 150))
          const active = await page.$eval('flip-book [data-toggle-camera]', (el: any) => el.classList.contains('active'))
          const popoverOpen = await page.$eval('flip-book [data-fb-popover]', (el: any) => el.classList.contains('open'))
          // camera device may not exist headless — toggling the control itself (not the resulting video state) is what we're checking
          return { ok: !popoverOpen, note: `cameraActive=${active} popoverOpen=${popoverOpen}` }
        },
      },
      {
        name: 'chromakey-rows-appear-only-when-enabled',
        run: async (page: any) => {
          const hiddenBefore = await page.$eval('flip-book [data-fb-ck-row]', (el: any) => getComputedStyle(el).display === 'none')
          await page.click('flip-book [data-toggle-ck]')
          await new Promise(r => setTimeout(r, 150))
          const visibleAfter = await page.$eval('flip-book [data-fb-ck-row]', (el: any) => getComputedStyle(el).display !== 'none')
          return { ok: hiddenBefore && visibleAfter, note: `hiddenBefore=${hiddenBefore} visibleAfter=${visibleAfter}` }
        },
      },
    ],
  },
  {
    name: 'flip-book-erase-live',
    url: `${plan1Base}/app/flip-book`,
    steps: [
      { name: 'load', run: async () => { await new Promise(r => setTimeout(r, 500)) } },
      {
        name: 'draw-a-stroke',
        run: async (page: any) => {
          const box = await (await page.$('flip-book .output-canvas')).boundingBox()
          const cx = box.x + box.width / 2, cy = box.y + box.height / 2
          await page.mouse.move(cx - 100, cy)
          await page.mouse.down()
          for (let i = 0; i <= 20; i++) await page.mouse.move(cx - 100 + i * 10, cy, { steps: 1 })
          await page.mouse.up()
          await new Promise(r => setTimeout(r, 200))
          return { ok: true }
        },
      },
      {
        name: 'erase-live-mid-drag-matches-post-release',
        run: async (page: any) => {
          // tool petals are pointer-events:none until the compass root opens
          await page.click('flip-book [data-menu]')
          await new Promise(r => setTimeout(r, 150))
          await page.click('flip-book [data-tool="erase"]')
          await new Promise(r => setTimeout(r, 100))

          const box = await (await page.$('flip-book .output-canvas')).boundingBox()
          const cx = box.x + box.width / 2, cy = box.y + box.height / 2
          await page.mouse.move(cx - 30, cy)
          await page.mouse.down()
          for (let i = 0; i <= 6; i++) {
            await page.mouse.move(cx - 30 + i * 10, cy, { steps: 1 })
            // rAF-throttled teachPlayer broadcasts fire between moves during a real drag —
            // this is exactly the timing that used to stomp the live erase back out
            await new Promise(r => setTimeout(r, 60))
          }
          const midDrag = await page.evaluate(() => {
            const oc = document.querySelector('flip-book .output-canvas')
            const ctx = oc.getContext('2d')
            return [...ctx.getImageData(Math.round(oc.width/2), Math.round(oc.height/2), 1, 1).data]
          })
          await page.mouse.up()
          await new Promise(r => setTimeout(r, 200))
          const afterRelease = await page.evaluate(() => {
            const oc = document.querySelector('flip-book .output-canvas')
            const ctx = oc.getContext('2d')
            return [...ctx.getImageData(Math.round(oc.width/2), Math.round(oc.height/2), 1, 1).data]
          })
          const matches = JSON.stringify(midDrag) === JSON.stringify(afterRelease)
          return { ok: matches, note: `midDrag=${midDrag} afterRelease=${afterRelease}` }
        },
      },
    ],
  },
]

function padNum(n: number) { return String(n).padStart(2, '0') }

async function runFlow(flow: Flow, browser: any) {
  const outDir = join(screenshotsRoot, flow.name)
  await Deno.mkdir(outDir, { recursive: true })

  if (flow.beforeGoto) await flow.beforeGoto()

  const page = await browser.newPage()
  await page.setViewport({ width: 1280, height: 800 })
  const consoleErrors: string[] = []
  page.on('pageerror', (e: Error) => consoleErrors.push(`pageerror: ${e.message}`))
  page.on('console', (msg: any) => { if (msg.type() === 'error') consoleErrors.push(`console: ${msg.text()}`) })

  // networkidle0 hangs for any elf with a persistent connection live from the
  // moment it mounts (WAS, SSE, multiplayer) — fine for dweb-camp-swipe
  // (accessibility-mode isn't the active saga beat on initial load), not
  // fine for a flow that opens accessibility-mode directly.
  await page.goto(flow.url, { waitUntil: flow.waitUntil ?? 'networkidle0', timeout: 20000 })

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

// puppeteer.launch() needs an actual path, unlike Deno.Command('chromium', ...)
// (used elsewhere in this dir) which resolves through $PATH itself.
async function findChromium() {
  for (const name of ['chromium', 'chromium-browser', 'google-chrome']) {
    try {
      const cmd = new Deno.Command('which', { args: [name], stdout: 'piped', stderr: 'null' })
      const { success, stdout } = await cmd.output()
      if (success) return new TextDecoder().decode(stdout).trim()
    } catch { /* try next */ }
  }
  throw new Error('no chromium/chromium-browser/google-chrome found on $PATH')
}

const browser = await puppeteer.launch({
  executablePath: await findChromium(),
  headless: true,
  args: ['--no-sandbox', '--disable-gpu'],
})

// puppeteer spawns chromium as a CHILD process — killing this deno process
// (an external timeout sending SIGTERM/SIGKILL, an uncaught step error, a
// non-zero Deno.exit before this had a chance to run) does NOT take chromium
// down with it. every one of those paths used to leak an orphaned chromium
// process tree that kept running indefinitely, and enough of them
// accumulated across repeated runs to peg the whole machine. SIGTERM is
// catchable (best-effort close); SIGKILL is not — the timeout given to
// whatever invokes this script has to stay within what the flow can
// actually finish in, there's no signal handler that saves you from that.
let _closed = false
async function closeBrowser() {
  if (_closed) return
  _closed = true
  await browser.close().catch(() => {})
}
Deno.addSignalListener('SIGINT', async () => { await closeBrowser(); Deno.exit(130) })
Deno.addSignalListener('SIGTERM', async () => { await closeBrowser(); Deno.exit(143) })

let allOk = true
try {
  for (const flow of flows) {
    console.log(`\n${flow.name}`)
    const manifest = await runFlow(flow, browser)
    await upsertIndex(manifest)
    if (!manifest.ok) allOk = false
  }
} finally {
  await closeBrowser()
}

console.log(`\n${allOk ? 'all flows passed' : 'some flows failed'}`)
Deno.exit(allOk ? 0 : 1)
