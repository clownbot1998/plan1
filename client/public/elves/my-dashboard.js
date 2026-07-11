// my-dashboard — a fork of my-computer.js for administrative/dev tooling.
// Same SPA shell as my-computer: a header/nav that pushState-switches which
// elf is embedded in .page, so navigating between tools never reloads the
// frame. The one thing my-computer's version got wrong (and my-dashboard's
// first pass copied) is using fake paths like /env that only exist in the
// client router — the server has never heard of them, so a hard reload fell
// through to server.js's catch-all, which serves *flip-book* for any unknown
// extensionless path (confirmed: the same thing already happens if you
// reload my-computer at /art). Every route here uses its elf's real
// /app/<tag> path instead — pushState still keeps the frame on ordinary
// clicks, and a hard reload at least lands on the correct standalone elf
// instead of a wrong one, even though (structurally, same as my-computer)
// a hard reload can't preserve this shell around it — /app/<tag> always
// mounts that tag alone server-side.

import Self from '@plan98/elf'
import { showPanel, hidePanel } from './plan98-panel.js'

const elf = 'my-dashboard'

const CHAT = 'chat'
const ENV  = 'env'
const MAP  = 'map'
const CODE = 'code'

// secondary admin tools, reached via the ☰ panel. dream-team is left out
// (it's already the dash/chat entry above) and was-code is left out (it's
// already embedded inside the code/source-code view) — both would just be
// dead-end duplicates of an entry already reachable elsewhere.
const TOOLS = [
  { key: 'cyber-security',   tag: 'cyber-security',   label: '🔐 Security' },
  { key: 'elf-tools',        tag: 'elf-tools',        label: '🛠 File I/O' },
  { key: 'git-elf',          tag: 'git-elf',          label: '🌱 Git' },
  { key: 'help-desk',        tag: 'help-desk',        label: '🎫 Help Desk' },
  { key: 'wireguard-elf',    tag: 'wireguard-elf',    label: '🔒 WireGuard' },
  { key: 'project-manager',  tag: 'project-manager',  label: '📋 Projects' },
  { key: 'clownbot-agent',   tag: 'clownbot-agent',   label: '🤖 Agent' },
  { key: 'clownbot-brief',   tag: 'clownbot-brief',   label: '📰 Briefs' },
  { key: 'clownbot-letters', tag: 'clownbot-letters', label: '✉️ Letters' },
  { key: 'gql-repl',         tag: 'gql-repl',         label: '🧬 GraphQL REPL' },
  { key: 'js-repl',          tag: 'js-repl',          label: '🧪 JS REPL' },
  { key: 'rust-deno',        tag: 'rust-deno',        label: '🦀 Rust/Deno' },
  { key: 'test-runner',      tag: 'test-runner',      label: '🎬 Test Runner' },
]

const config = {
  [CHAT]: {
    label: 'dash',
    path: '/app/my-dashboard',
    // dream-team with no `room` attribute lands on its own profile/hub view
    // (views.profile in dream-team.js) — which now embeds <bulletin-board>
    // in place of the plan98-gallery it used to show there. That
    // bulletin-board has no id="" of its own either, so it falls through to
    // reading ?id= off the page's own URL (bulletin-board.js's own
    // resolution order: element attr → ?id= → mint one). Since dream-team
    // is a same-DOM embed here (not an iframe), "the page" is still
    // /app/my-dashboard — so the id chain is my-dashboard's own URL, all
    // the way down, with no extra plumbing between the three layers.
    body: () => `<dream-team></dream-team>`
  },
  [ENV]: {
    label: 'Env',
    path: '/app/plan98-env',
    body: () => `<plan98-env></plan98-env>`
  },
  [MAP]: {
    label: 'Map',
    path: '/app/elf-map',
    body: () => `<elf-map></elf-map>`
  },
  [CODE]: {
    label: 'Code',
    path: '/app/source-code',
    body: () => `<source-code></source-code>`
  },
  ...TOOLS.reduce((acc, t) => {
    acc[t.key] = { label: t.label, path: `/app/${t.tag}`, body: () => `<${t.tag}></${t.tag}>` }
    return acc
  }, {}),
}

function createPathMap() {
  return Object.keys(config).reduce((paths, key) => {
    const page = config[key]
    paths[page.path] = { page: key, label: page.label, body: page.body }
    return paths
  }, {})
}

const paths = createPathMap()

function router(route) {
  return paths[route] || { page: CHAT, label: config[CHAT].label, body: config[CHAT].body }
}

const initialState = {
  ...router(self.location.pathname),
  route: paths[self.location.pathname] ? self.location.pathname : config[CHAT].path,
}

const $ = Self(elf, initialState)

export default $

function saveHistory(patch, url) {
  self.history.pushState({ type: `${$.link}-navigation`, patch }, '', url)
}

addEventListener('popstate', (event) => {
  const { type, patch } = event.state || {}
  if (type === `${$.link}-navigation` && patch?.route) $.teach({ route: patch.route })
})

$.when('click', '[data-nav]', (event) => {
  event.preventDefault()
  const { nav } = event.target.dataset
  $.teach({ route: nav })
  saveHistory({ route: nav }, nav)
  hidePanel()
})

$.head(target => {
  if (target.innerHTML) return

  target.innerHTML = `
    <header>
      <button data-nav="${config[CHAT].path}" class="title">dash</button>
      <nav class="horizontal">
        <button data-nav="${config[ENV].path}">Env</button>
        <button data-nav="${config[MAP].path}">Map</button>
        <button data-nav="${config[CODE].path}">Code</button>
        <button data-panel>☰</button>
      </nav>
    </header>
    <div class="pages">
      <div class="page"></div>
    </div>
  `
}, {
  beforeUpdate(target) {
    if (!target.mounted) {
      target.mounted = true
      saveHistory({ route: window.location.pathname })
    }
  },
  afterUpdate(target) {
    const { route } = $.ear()
    if (target.dataset.routeKey !== route) {
      target.dataset.routeKey = route
      const page = target.querySelector('.page')
      if (page) page.innerHTML = router(route).body(target)
    }
  }
})

$.when('click', '[data-panel]', () => {
  showPanel(`
    <my-dashboard class="passthrough">
      <nav class="vertical">
        <h6 style="padding: 1rem .75rem .5rem;">Admin Tools</h6>
        ${TOOLS.map(t => `<button data-nav="/app/${t.tag}">${t.label}</button>`).join('')}
      </nav>
    </my-dashboard>
  `)
})

$.style(`
  & {
    border-top: 5px solid var(--root-theme, #E83FB8);
    display: grid;
    grid-template-rows: auto 1fr;
    height: 100%;
    overflow: hidden;
    background: white;
    color: black;
    touch-action: manipulation;
    position: relative;
    z-index: 1;
  }

  &.passthrough {
    display: block;
    height: auto;
    border-top: none;
  }

  & .pages {
    height: 100%;
    overflow: hidden;
  }

  & .page {
    height: 100%;
    overflow: auto;
    background: white;
    position: relative;
  }

  & .page > * {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
  }

  ${Object.keys(config).map(key => {
    const { path } = config[key]
    return `
      &[data-route="${path}"] [data-nav="${path}"] {
        border-color: var(--root-theme, #E83FB8);
      }
      &[data-route="${path}"] nav [data-nav="${path}"] {
        background: linear-gradient(rgba(0,0,0,.25), rgba(0,0,0,.5)), linear-gradient(135deg, rgba(255,255,255,.35), rgba(0,0,0,.35), rgba(0,0,0,.25), rgba(0,0,0,.65), rgba(0,0,0,.5)), var(--root-theme, #E83FB8);
        color: white;
      }
    `
  }).join('')}

  & .title {
    color: var(--root-theme, #E83FB8);
    font-size: 2rem;
    font-weight: 800;
    font-family: 'Recursive';
    font-variation-settings: "MONO" 0, "CASL" 0, "wght" 800, "slnt" 0, "CRSV" 0;
    letter-spacing: -.03em;
  }

  & header {
    display: grid;
    grid-template-columns: auto 1fr;
    padding: .25rem .5rem;
    position: relative;
    z-index: 1;
    box-shadow: 0 1px 2px 0px rgba(0,0,0,.1);
  }

  & header button,
  & nav button {
    padding: 0;
    border: none;
    border-radius: 0;
    background: transparent;
    cursor: pointer;
  }

  & nav button {
    color: rgba(0,0,0,.5);
  }

  & nav.horizontal {
    display: inline-flex;
    gap: .5rem;
    align-self: end;
    place-content: end;
  }

  & nav.horizontal button {
    font-size: 1rem;
    line-height: 1;
    display: inline-grid;
    place-content: center;
    padding: .5rem;
    border-bottom: 2px solid rgba(0,0,0,.2);
  }

  & nav.vertical {
    display: flex;
    align-self: end;
    flex-direction: column;
  }

  & nav.vertical button {
    font-size: 1rem;
    line-height: 1;
    display: inline-grid;
    place-content: start;
    padding: .5rem;
    border-bottom: 1px solid rgba(0,0,0,.1);
    text-align: left;
  }
`)
