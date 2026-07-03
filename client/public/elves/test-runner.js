import { Self } from '@plan98/types'

const tag = 'test-runner'
const $ = Self(tag)

// results-only viewer — runs happen via `./plan1.sh test`, this just reads
// what private/screenshots/e2e/ already has on disk.

function screenshotUrl(flow, file) {
  return `/private/screenshots/e2e/${flow}/${file}`
}

async function loadIndex() {
  $.teach({ loading: true, error: null })
  try {
    const res = await fetch('/private/screenshots/e2e/index.json', { cache: 'no-store' })
    if (!res.ok) throw new Error(`index.json: ${res.status}`)
    const index = await res.json()
    $.teach({ index, loading: false })
  } catch (e) {
    $.teach({ error: e.message, loading: false })
  }
}

async function loadManifest(flow) {
  const { manifests = {} } = $.learn()
  if (manifests[flow]) {
    $.teach({ openFlow: flow })
    return
  }
  try {
    const res = await fetch(`/private/screenshots/e2e/${flow}/manifest.json`, { cache: 'no-store' })
    const manifest = await res.json()
    // nuance fns are stringified + re-eval'd in a sandbox — no closures over
    // outer vars (flow/manifest), everything must travel through `p`.
    $.teach({ openFlow: flow, flow, manifest }, (s, p) => ({
      ...s,
      openFlow: p.openFlow,
      manifests: { ...s.manifests, [p.flow]: p.manifest },
    }))
  } catch (e) {
    $.teach({ error: `${flow}: ${e.message}` })
  }
}

function relativeTime(iso) {
  const ms = Date.now() - new Date(iso).getTime()
  const min = Math.round(ms / 60000)
  if (min < 1) return 'just now'
  if (min < 60) return `${min}m ago`
  const hr = Math.round(min / 60)
  if (hr < 24) return `${hr}h ago`
  return `${Math.round(hr / 24)}d ago`
}

$.draw(target => {
  const { index, loading, error, openFlow, manifests = {} } = $.learn()

  if (!index && !loading && !error) {
    setTimeout(loadIndex, 0)
    return `<div class="tr-msg">loading…</div>`
  }
  if (loading && !index) return `<div class="tr-msg">loading…</div>`
  if (error) return `<div class="tr-msg tr-error">${error}</div>`

  const flows = Object.entries(index ?? {})

  if (!flows.length) {
    return `<div class="tr-msg">no runs yet — try <code>./plan1.sh test</code></div>`
  }

  const rows = flows.map(([flow, meta]) => {
    const open = openFlow === flow
    const manifest = manifests[flow]
    return `
      <div class="tr-flow ${meta.ok ? 'tr-ok' : 'tr-fail'}">
        <button class="tr-flow-head" data-open-flow="${flow}">
          <span class="tr-badge">${meta.ok ? 'pass' : 'fail'}</span>
          <span class="tr-name">${flow}</span>
          <span class="tr-meta">${meta.stepCount} steps · ${relativeTime(meta.ranAt)}</span>
        </button>
        ${open ? renderFilmstrip(flow, manifest) : ''}
      </div>
    `
  }).join('')

  return `
    <div class="tr-shell">
      <div class="tr-header">
        <h2 class="tr-title">test runs</h2>
        <button class="tr-refresh" data-refresh>refresh</button>
      </div>
      <div class="tr-list">${rows}</div>
    </div>
  `
})

function renderFilmstrip(flow, manifest) {
  if (!manifest) return `<div class="tr-msg">loading steps…</div>`
  const frames = manifest.steps.map(step => `
    <div class="tr-frame ${step.ok ? 'tr-ok' : 'tr-fail'}">
      <img class="tr-shot" src="${screenshotUrl(flow, step.screenshot)}" alt="${step.step}" loading="lazy" />
      <div class="tr-frame-label">
        <span class="tr-badge">${step.ok ? '✓' : '✗'}</span>
        ${step.step}${step.note ? ` — ${step.note}` : ''}
      </div>
    </div>
  `).join('')

  const errors = manifest.consoleErrors?.length
    ? `<div class="tr-console-errors">${manifest.consoleErrors.map(e => `<div>${e}</div>`).join('')}</div>`
    : ''

  return `<div class="tr-filmstrip">${frames}</div>${errors}`
}

$.when('click', '[data-open-flow]', event => {
  const flow = event.target.closest('[data-open-flow]').dataset.openFlow
  const { openFlow } = $.learn()
  if (openFlow === flow) {
    $.teach({ openFlow: null })
    return
  }
  loadManifest(flow)
})

$.when('click', '[data-refresh]', () => {
  $.teach({ manifests: {}, openFlow: null })
  loadIndex()
})

$.style(`
  & {
    display: block;
    height: 100%;
    overflow-y: auto;
    background: #f3f1ea;
    color: #1a1a1a;
    font-family: 'Recursive', system-ui, sans-serif;
    padding: 1rem;
  }

  & .tr-msg { padding: 1rem; opacity: .65; }
  & .tr-error { color: #b3261e; }

  & .tr-header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 1rem; }
  & .tr-title { margin: 0; font-size: 1.1rem; }
  & .tr-refresh { border: 1px solid rgba(0,0,0,.25); background: none; padding: .35rem .8rem; cursor: pointer; }

  & .tr-list { display: flex; flex-direction: column; gap: .5rem; }

  & .tr-flow { border: 1px solid rgba(0,0,0,.15); background: white; }
  & .tr-flow-head {
    width: 100%;
    display: flex;
    align-items: center;
    gap: .6rem;
    padding: .6rem .8rem;
    background: none;
    border: none;
    text-align: left;
    cursor: pointer;
    font-family: inherit;
    font-size: .95rem;
  }
  & .tr-name { font-weight: 700; }
  & .tr-meta { margin-left: auto; opacity: .6; font-size: .8rem; }

  & .tr-badge {
    font-size: .7rem;
    text-transform: uppercase;
    padding: .1rem .4rem;
    border-radius: .2rem;
  }
  & .tr-ok .tr-badge { background: #d7f3df; color: #1a7431; }
  & .tr-fail .tr-badge { background: #fbdad7; color: #b3261e; }

  & .tr-filmstrip {
    display: flex;
    gap: .75rem;
    overflow-x: auto;
    padding: .8rem;
    border-top: 1px solid rgba(0,0,0,.1);
  }

  & .tr-frame { flex: 0 0 auto; width: 220px; }
  & .tr-shot {
    width: 100%;
    aspect-ratio: 16/10;
    object-fit: cover;
    object-position: top;
    border: 1px solid rgba(0,0,0,.2);
    background: #eee;
  }
  & .tr-frame.tr-fail .tr-shot { border-color: #b3261e; }
  & .tr-frame-label { font-size: .75rem; padding-top: .3rem; }

  & .tr-console-errors {
    padding: .6rem .8rem;
    border-top: 1px solid rgba(0,0,0,.1);
    color: #b3261e;
    font-size: .75rem;
    font-family: monospace;
  }
`)
