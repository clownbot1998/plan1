import elf from '@plan98/elf'
import './lrud-elf.js'

const SECTIONS = {
  script: {
    label: 'Script',
    apps: [
      { label: 'Lore Baby',   href: '/app/lore-baby' },
      { label: 'Source Code', href: '/app/source-code' },
      { label: 'ur-shell',    href: '/app/ur-shell' },
      { label: 'Private AI',  href: '/app/private-ai' },
      { label: 'Hail Mary',   href: '/app/hail-mary' },
      { label: 'Drop Saga',   href: '/app/drop-saga' },
      { label: 'My Sagas',   href: '/app/my-sagas' },
    ]
  },
  sketch: {
    label: 'Sketch',
    apps: [
      { label: 'Flip Book', href: '/app/flip-book' },
    ]
  },
  screen: {
    label: 'Screen',
    apps: [
      { label: 'Open Clown',   href: '/app/my-computer' },
      { label: 'Paper Pocket', href: '/app/paper-pocket' },
      { label: 'Multi Task',   href: '/app/multi-task' },
      { label: 'Couch Coop',   href: '/app/couch-coop' },
      { label: 'Bulletin Board', href: '/app/bulletin-board' },
      { label: 'Clown Map: Circus Mesh SF', href: '/app/clown-map' },
    ]
  },
  blog: {
    label: 'Clog',
    apps: [
      { label: 'All Posts', href: '/blog/' },
    ]
  },
}

const AXIS_RANGES = [
  ['MONO', 0, 1],
  ['CASL', 0, 1],
  ['wght', 300, 1000],
  ['slnt', -15, 0],
  ['CRSV', 0, 1],
]

function randomAxes() {
  const result = {}
  for (const [name, min, max] of AXIS_RANGES) {
    result[name] = min + Math.random() * (max - min)
  }
  return result
}

function allAxes() {
  const result = {}
  for (const key of Object.keys(SECTIONS)) result[key] = randomAxes()
  return result
}

function fvs(ax) {
  return `'MONO' ${ax.MONO.toFixed(3)}, 'CASL' ${ax.CASL.toFixed(3)}, 'wght' ${ax.wght.toFixed(0)}, 'slnt' ${ax.slnt.toFixed(2)}, 'CRSV' ${ax.CRSV.toFixed(3)}`
}

// flat list of navigable items for current menu state
function navList(activeTab) {
  const items = []
  for (const [key, s] of Object.entries(SECTIONS)) {
    items.push({ type: 'tab', key })
    if (activeTab === key) {
      s.apps.forEach((app, i) => items.push({ type: 'app', key, appIndex: i, href: app.href }))
    }
  }
  return items
}

let _ctx = null
function getCtx() {
  if (!_ctx) _ctx = new AudioContext()
  return _ctx
}

function audioFactory(url) {
  let buffer = null
  fetch(url).then(r => r.arrayBuffer()).then(ab => getCtx().decodeAudioData(ab)).then(b => { buffer = b }).catch(() => {})
  return function play() {
    if (!buffer) return
    const ctx = getCtx()
    if (ctx.state === 'suspended') ctx.resume()
    const src = ctx.createBufferSource()
    src.buffer = buffer
    src.connect(ctx.destination)
    src.start(0)
  }
}

const playNavigateSound = audioFactory('/cdn/sillyz.computer/beat-tape-extractor/output/a.mp3')
const playStuckSound = audioFactory('/cdn/sillyz.computer/beat-tape-extractor/output/b.mp3')

const initialRoute = location.pathname.startsWith('/app/')
  ? location.pathname
  : '/app/plan98-boxart'

const $ = elf('sticky-menu', {
  activeTab: null,
  route: initialRoute,
  axes: allAxes(),
  cursor: initialRoute ? navList(null).findIndex(n => n.type === 'app' && n.href === initialRoute) : 0,
})

let _axesInterval = null
function startAxes() {
  if (_axesInterval) return
  _axesInterval = setInterval(() => $.teach({ axes: allAxes() }), 5000)
}
function stopAxes() {
  clearInterval(_axesInterval)
  _axesInterval = null
}
startAxes()
document.addEventListener('visibilitychange', () => {
  document.visibilityState === 'visible' ? startAxes() : stopAxes()
})

$.draw(target => {
  const { activeTab, cursor, axes, route } = $.learn()
  const list = navList(activeTab)

  const sections = Object.entries(SECTIONS).map(([key, s]) => {
    const tabIdx = list.findIndex(n => n.type === 'tab' && n.key === key)
    const isOpen = activeTab === key
    const ax = axes?.[key] ?? { MONO: 0, CASL: 0, wght: 700, slnt: 0, CRSV: 0 }

    const appLinks = isOpen
      ? s.apps.map((app, i) => {
          const appIdx = list.findIndex(n => n.type === 'app' && n.key === key && n.appIndex === i)
          const hot = cursor === appIdx
          return `<div class="app-row${hot ? ' gp-cursor' : ''}">
            <a class="app-link" href="${app.href}" data-launch="${app.href}">${app.label}</a>
          </div>`
        }).join('')
      : ''

    return `
      <div class="section">
        <a class="section-head${cursor === tabIdx ? ' gp-cursor' : ''}"
           style="font-variation-settings: ${fvs(ax)};"
           href="#" data-tab="${key}">${s.label}</a>
        ${appLinks}
      </div>
    `
  }).join('')

  return `
    <div class="sticky" data-dom="iframe">${route ? `<iframe src="${route}"></iframe>` : ''}</div>
    <div class="menu">
      <div style="max-width: 70ch; margin: 0 auto;">
        ${sections}
      </div>
    </div>
  `
}, {
  beforeUpdate(target) {
    const { route } = $.learn()
    if (route) target.dataset.route = route
    else delete target.dataset.route
  }
})

$.when('click', '[data-tab]', event => {
  event.preventDefault()
  playNavigateSound()
  const tab = event.target.closest('[data-tab]').dataset.tab
  const { activeTab } = $.learn()
  const newActive = activeTab === tab ? null : tab
  const newList = navList(newActive)
  const cursor = newList.findIndex(n => n.type === 'tab' && n.key === tab)
  $.teach({ activeTab: newActive, cursor })
})

$.when('click', '[data-launch]', event => {
  event.preventDefault()
  playNavigateSound()
  const el = event.target.closest('[data-launch]')
  const route = el.dataset.launch
  const { activeTab } = $.learn()
  const list = navList(activeTab)
  const cursor = list.findIndex(n => n.type === 'app' && n.href === route)
  $.teach({ route, cursor: cursor >= 0 ? cursor : $.learn().cursor })
  history.pushState({ type: 'sticky-menu-navigation', route }, '', route)
})

addEventListener('popstate', event => {
  const { type, route } = event.state || {}
  if (type === 'sticky-menu-navigation') {
    $.teach({ route: route || null })
  }
})

history.replaceState({ type: 'sticky-menu-navigation', route: initialRoute }, '', location.href)

// iframe signals it's done — rotate focus back to sticky-menu
function onStickyDone() {
  $.teach({ route: null })
  history.pushState({ type: 'sticky-menu-navigation', route: null }, '', '/')
}

window.addEventListener('sticky-menu:done', onStickyDone)
window.addEventListener('message', e => {
  if (e.data?.type === 'sticky-menu:done') onStickyDone()
})

// gamepad / keyboard navigation via lrud-elf
window.addEventListener('lrud:press', e => {
  const { route, activeTab, cursor } = $.learn()
  if (route) return  // iframe is showing, menu is hidden — don't navigate

  const { button } = e.detail
  const list = navList(activeTab)

  if (button === 'up') {
    if (cursor === 0) { playStuckSound(); return }
    playNavigateSound()
    $.teach({ cursor: cursor - 1 })
    return
  }

  if (button === 'down') {
    if (cursor === list.length - 1) { playStuckSound(); return }
    playNavigateSound()
    $.teach({ cursor: cursor + 1 })
    return
  }

  if (button === 'b') {
    if (!activeTab) return
    playNavigateSound()
    const tabIdx = Object.keys(SECTIONS).indexOf(activeTab)
    $.teach({ activeTab: null, cursor: tabIdx })
    return
  }

  if (button === 'a') {
    const item = list[cursor]
    if (!item) return

    if (item.type === 'tab') {
      playNavigateSound()
      const isOpen = activeTab === item.key
      const newActive = isOpen ? null : item.key
      const newList = navList(newActive)
      if (isOpen) {
        const tabIdx = newList.findIndex(n => n.type === 'tab' && n.key === item.key)
        $.teach({ activeTab: newActive, cursor: tabIdx })
      } else {
        const firstApp = newList.findIndex(n => n.type === 'app' && n.key === item.key)
        $.teach({ activeTab: newActive, cursor: firstApp >= 0 ? firstApp : cursor })
      }
      return
    }

    if (item.type === 'app') {
      playNavigateSound()
      $.teach({ route: item.href })
      history.pushState({ type: 'sticky-menu-navigation', route: item.href }, '', item.href)
    }
  }
})

$.style(`
  & {
    display: grid;
    height: 100%;
    overflow: hidden;
    place-items: center;
    grid-template-areas: 'zone';
  }

  & a {
    color: var(--root-theme, dodgerblue);
    text-decoration: none;
  }

  & a:link,
  & a:visited {
    color: dodgerblue;
  }

  & a:hover,
  & a:focus {
    color: mediumseagreen;
  }

  & a:active {
    color: firebrick;
  }

  & .sticky,
  & .menu {
    height: 100%;
    width: 100%;
    overflow: auto;
    transition: opacity 1000ms ease-in-out;
    grid-area: zone;
  }

  & .sticky {
    pointer-events: none;
    display: none;
    opacity: 0;
  }

  & .sticky iframe {
    height: 100%;
    width: 100%;
    border: none;
    display: block;
  }

  & .menu {
    padding: calc(0.382rem * 4) calc(0.618rem * 4);
    background: lemonchiffon;
    font-family: 'Recursive';
  }

  & .section {
    margin-bottom: 0.5rem;
  }

  & .section-head {
    display: inline-block;
    font-size: 2rem;
    line-height: 1;
    margin: 0 0 0.25rem;
    padding: 1rem;
    border-radius: 4px;
    transition: font-variation-settings 5000ms linear;
  }

  & .section-head.gp-cursor {
    background: dodgerblue;
    color: lemonchiffon;
  }

  & .app-row {
    margin: 0;
    padding-left: 1rem;
  }

  & .app-row.gp-cursor .app-link {
    background: dodgerblue;
    color: lemonchiffon;
  }

  & .app-link {
    font-size: 1rem;
    font-weight: 400;
    line-height: 1.6;
    padding: 0.5rem;
    border-radius: 2px;
    display: inline-block;
  }

  &[data-route] .sticky {
    opacity: 1;
    pointer-events: all;
    display: block;
  }

  &[data-route] .menu {
    pointer-events: none;
    opacity: 0;
  }
`)
