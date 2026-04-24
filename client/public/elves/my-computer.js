import Self from '@plan98/elf'
import './plan98-palette.js'
import { toast } from './plan98-toast.js'
import { showPanel, hidePanel } from './plan98-panel.js'
import Cache from '@silly/cache'

const elf = 'my-computer'
const cache = Cache(elf)
const version = 'plan1-1.0.0'

const HOME   = 'home'
const ART    = 'art'
const MUSIC  = 'music'
const CODING = 'coding'
const SAGAS  = 'sagas'
const TUTORIAL = 'tutorial'
const SHARE  = 'share'
const THEME  = 'theme'
const PROJECT_MANAGER = 'project-manager'

const config = {
  [HOME]: {
    label: 'Home',
    path: '/',
    icon: '🏠',
    body: (target) => `
      <div class="home-layout">
        <div class="home-content">
          <div class="interlude">
            <div class="interlude-title">OpenClown</div>
            <div class="interlude-subtitle">an ai-less agent for the server-less bios unleashing everywhere clownpute</div>
          </div>
          <div class="feature-list">
            <div class="featured-item"><span>✓</span><span>Draw and animate with flip-book, frame by frame</span></div>
            <div class="featured-item"><span>✓</span><span>Compose music with the paper-pocket sequencer</span></div>
            <div class="featured-item"><span>✓</span><span>Write and run code in a live terminal</span></div>
            <div class="featured-item"><span>✓</span><span>Laughter is the only system capable of reducing universal entropy</span></div>
          </div>
          <div class="hero-section -right">
            <div class="hero-content">
              <div class="hero-headline">🎨 Art</div>
              <span class="hero-tag" title="frame by frame">Flip-book animation</span> — draw it,
              <span class="hero-tag" title="no compiler required">flip it</span>,
              <span class="hero-tag" title="the medium is the message">feel it</span>.
              Every frame is a commitment. Every sequence is a spell.
              <div class="hero-action-container">
                <button class="hero-cta" data-nav="/art">Draw Now →</button>
              </div>
            </div>
          </div>
        </div>
        <div class="home-sidebar">
          <project-manager></project-manager>
        </div>
      </div>
    `
  },
  [PROJECT_MANAGER]: {
    label: 'Projects',
    path: '/project-manager',
    icon: '📋',
    body: (target) => `
      <div class="project-manager-view">
        <h2>Project Management</h2>
        <project-manager></project-manager>
      </div>
    `
  },
  [ART]: {
    label: 'Art',
    path: '/art',
    icon: '🎨',
    body: (target) => `<flip-book></flip-book>`
  },
  [MUSIC]: {
    label: 'Music',
    path: '/music',
    icon: '🎵',
    body: (target) => `<paper-pocket></paper-pocket>`
  },
  [CODING]: {
    label: 'Coding',
    path: '/coding',
    icon: '🖥',
    body: (target) => `<ur-shell></ur-shell>`
  },
  [SAGAS]: {
    label: 'Sagas',
    path: '/sagas',
    icon: '📖',
    body: (target) => `<lore-baby></lore-baby>`
  },
  [TUTORIAL]: {
    label: 'Tutorial',
    path: '/tutorial',
    icon: '📚',
    body: (target) => tutorial(target)
  },
  [SHARE]: {
    label: 'Share',
    path: '/share',
    icon: '🔗',
    body: (target) => share(target)
  },
  [THEME]: {
    label: 'Theme',
    path: '/theme',
    icon: '🎨',
    body: (target) => `<plan98-palette style="height:100%;"></plan98-palette>`
  },
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
  const defaultKey = Object.keys(config)[0]
  return paths[route] || { page: defaultKey, label: config[defaultKey].label, body: config[defaultKey].body }
}

const initialState = {
  ...router(self.location.pathname),
  route: paths[self.location.pathname] ? self.location.pathname : '/',
}

const $ = Self(elf, initialState)

export default $

cache.get(elf).then(record => {
  if (!record || version !== record.data) cache.put(elf, version)
})

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
  $.teach({ route: nav, blogUrl: null })
  saveHistory({ route: nav }, nav)
  hidePanel()
})

$.when('click', '[data-post-url]', (event) => {
  event.preventDefault()
  const { postUrl } = event.target.dataset
  $.teach({ blogUrl: postUrl })
  hidePanel()
})

$.head(target => {
  if (target.innerHTML) return

  target.innerHTML = `
    <header>
      <button data-nav="/" class="title">
        🤡 clownbot
      </button>
      <nav class="horizontal">
        <button data-nav="/art">Art</button>
        <button data-nav="/music">Music</button>
        <button data-nav="/coding">Coding</button>
        <button data-nav="/sagas">Sagas</button>
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
    const { route, blogUrl } = $.ear()
    const key = route + (blogUrl || '')
    if (target.dataset.routeKey !== key) {
      target.dataset.routeKey = key
      const page = target.querySelector('.page')
      if (page) {
        if (blogUrl) {
          page.innerHTML = `<iframe src="${blogUrl}" style="position:absolute;inset:0;width:100%;height:100%;border:none;display:block;"></iframe>`
        } else {
          page.innerHTML = router(route).body(target)
        }
      }
    }
  }
})


$.when('click', '[data-panel]', () => {
  showPanel(`
    <my-computer class="passthrough">
      <nav class="vertical">
        <h6 style="padding: 1rem .75rem .5rem;">Quick Links</h6>
        <button data-nav="/tutorial">📚 Learn More</button>
        <button data-nav="/share">🔗 Share</button>
        <button data-nav="/theme">🎨 Theme Picker</button>
      </nav>
      <div class="panel-posts">
        <h6>Blog Posts</h6>
        <ul id="panel-post-list"><li><a style="opacity:.4">loading…</a></li></ul>
      </div>
    </my-computer>
  `)

  fetch('/search-manifest.json')
    .then(r => r.json())
    .then(docs => {
      const posts = docs.filter(d => d.type === 'html')
      const el = document.querySelector('#panel-post-list')
      if (el) {
        el.innerHTML = posts.map(p =>
          `<li><a data-post-url="${p.ref}" href="#">${p.name}</a></li>`
        ).join('')
      }
    })
})

$.when('click', '[data-share]', async (event) => {
  const { share } = event.target.dataset
  if (!share) return
  const copyTarget = event.target.closest($.link).querySelector(`[id="${share}"]`)
  if (!copyTarget) return

  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(copyTarget.textContent)
      toast('Copied to clipboard')
    } else {
      const ta = document.createElement('textarea')
      ta.value = copyTarget.textContent
      ta.style.cssText = 'position:fixed;left:-999999px;top:-999999px'
      document.body.appendChild(ta)
      ta.focus()
      ta.select()
      try { document.execCommand('copy'); toast('Copied to clipboard') }
      catch { toast('Failed to copy') }
      document.body.removeChild(ta)
    }
  } catch { toast('Failed to copy') }
})

function tutorial(target) {
  return `
    <div style="padding: 1rem; max-width: 55ch; margin: 0 auto; display: flex; gap: 1rem; flex-direction: column; overflow: auto; height: 100%; box-sizing: border-box;">
      <h2>🤡 clownbot</h2>
      <p>
        A creative suite for kids at heart. Explore and absorb the ability to create art, music, and code — by learning from it.
      </p>

      <ul>
        <li>🎨 Art — flip-book animation</li>
        <li>🎵 Music — paper-pocket sequencer</li>
        <li>🖥 Coding — ur-shell terminal</li>
        <li>📖 Sagas — lore-baby storytelling</li>
      </ul>

      <div>
        <plan98-palette style="height: 50vh"></plan98-palette>
      </div>

      <hr>

      <p>
        <center>
          <strong>The imagination:</strong> <strike>Space!</strike> <u>Time!</u> <sup>Sight!</sup> <sub>Sound!</sub> <em>Mind!</em>
        </center>
      </p>

      <p style="opacity:.5; font-size:.85rem; text-align:center;">
        Thanks for playing. -Ty
      </p>
    </div>
  `
}

function share(target) {
  const shareLink = `${window.location.origin}${window.location.pathname}`
  const copyId = self.crypto.randomUUID()

  return `
    <div class="share-view">
      <div style="padding: 1rem;">
        <div class="copy-area">
          <div id="${copyId}" class="share-link-copyable-url">${shareLink}</div>
          <button data-share="${copyId}">📋</button>
        </div>
        <p>Copy this link and share it online!</p>
      </div>
    </div>
  `
}

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

  & .page > *:not(.home-layout) {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
  }

  & .home-layout {
    height: 100%;
    overflow: hidden;
  }

  & .home-content {
    height: 100%;
    overflow-y: auto;
    overflow-x: hidden;
  }

  & .panel-posts h6 {
    margin: 0;
    padding: .75rem .75rem .4rem;
    text-transform: uppercase;
    font-size: .7rem;
    opacity: .5;
    letter-spacing: .07em;
  }

  & .panel-posts ul {
    list-style: none;
    padding: 0;
    margin: 0;
  }

  & .panel-posts li {
    border-bottom: 1px solid rgba(0,0,0,.06);
  }

  & .panel-posts a {
    display: block;
    padding: .4rem .75rem;
    color: inherit;
    text-decoration: none;
    font-size: .85rem;
    opacity: .75;
    line-height: 1.35;
  }

  & .panel-posts a:hover { opacity: 1; background: rgba(0,0,0,.03); }

  & .interlude {
    min-height: 50vh;
    display: grid;
    background: linear-gradient(rgba(0,0,0,.5), rgba(0,0,0,.85)), linear-gradient(135deg, rgba(255,255,255,.65), rgba(0,0,0,.65), rgba(0,0,0,.5), rgba(0,0,0,.65), rgba(0,0,0,.85)), var(--root-theme, #E83FB8);
    place-content: center;
    text-align: center;
    padding: 2rem 1rem;
    gap: 1rem;
    color: white;
  }

  & .interlude-title {
    font-size: 3rem;
    font-weight: 800;
    color: var(--root-theme, #E83FB8);
    font-family: 'BerkeleyMono', 'Monaco', 'Courier New', monospace;
    letter-spacing: -.03em;
  }

  & .interlude-subtitle {
    font-size: 1.25rem;
    color: rgba(255,255,255,.75);
    max-width: 45ch;
    margin: 0 auto;
    line-height: 1.6;
  }

  & .feature-list {
    padding: 2rem 1rem;
    font-size: 1.25rem;
    display: grid;
    gap: .75rem;
  }

  & .featured-item {
    display: grid;
    grid-template-columns: 1.5rem 1fr;
    gap: .75rem;
    opacity: .8;
  }

  & .featured-item span:first-child {
    color: var(--root-theme, #E83FB8);
    font-weight: bold;
  }

  & .hero-section {
    font-size: 1.2rem;
    min-height: 30vh;
    padding: 2rem;
    line-height: 1.7;
  }

  @media (min-width: 768px) {
    & .hero-section {
      display: grid;
      gap: 3rem;
    }
    & .hero-section.-left {
      grid-template-columns: 1fr 200px;
      grid-template-areas: "content graphic";
    }
    & .hero-section.-right {
      grid-template-columns: 200px 1fr;
      grid-template-areas: "graphic content";
    }
  }

  & .hero-content { grid-area: content; }

  & .hero-headline {
    margin: 0 0 .5rem;
    font-size: 1.75rem;
    font-weight: bold;
    color: rgba(0,0,0,.75);
  }

  & .hero-tag {
    display: inline;
    text-decoration: underline;
    text-decoration-thickness: 2px;
    text-decoration-color: var(--root-theme, #E83FB8);
    text-underline-offset: 4px;
    font-weight: bold;
    cursor: help;
  }

  & .hero-action-container { margin-top: 1rem; }

  & .hero-cta {
    font-weight: 800;
    color: var(--root-theme, #E83FB8);
    border: none;
    font-size: 1.5rem;
    padding: 0;
    background: transparent;
    cursor: pointer;
  }

  & .hero-cta:hover { opacity: .75; }

  & .os-table-section {
    padding: 0 0 2rem;
  }

  & .os-table-wrap {
    overflow-x: auto;
    padding: 0 1rem 1rem;
  }

  & .os-table {
    border-collapse: collapse;
    width: 100%;
    min-width: 900px;
    font-size: .85rem;
    line-height: 1.4;
  }

  & .os-table th {
    background: rgba(0,0,0,.85);
    color: white;
    padding: .6rem .75rem;
    text-align: left;
    font-weight: 600;
    white-space: nowrap;
  }

  & .os-table td {
    padding: .6rem .75rem;
    border-bottom: 1px solid rgba(0,0,0,.08);
    vertical-align: top;
  }

  & .os-table tbody tr:nth-child(even) td { background: rgba(0,0,0,.02); }
  & .os-table tbody tr:hover td { background: rgba(0,0,0,.04); }

  & .feature-name {
    font-weight: 600;
    white-space: nowrap;
  }

  & .cell-yes { color: mediumseagreen; font-weight: 600; }
  & .cell-no { color: firebrick; opacity: .75; }
  & .cell-partial { color: darkorange; }

  & .plan98-col {
    background: linear-gradient(rgba(0,0,0,.02), rgba(0,0,0,.02)), linear-gradient(var(--root-theme, #E83FB8), var(--root-theme, #E83FB8));
    background-blend-mode: screen;
    border-left: 3px solid var(--root-theme, #E83FB8);
  }

  & .os-table th.plan98-col {
    background: var(--root-theme, #E83FB8);
    color: white;
    border-left: 3px solid rgba(255,255,255,.3);
  }

  & .plan98-row td { font-weight: 500; }

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
    font-family: 'BerkeleyMono', 'Monaco', 'Courier New', monospace;
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

  & nav.vertical ul {
    list-style: none;
    padding: 0;
    margin: 0;
  }

  & nav.vertical li { padding: .25rem .5rem; border-bottom: 1px solid rgba(0,0,0,.05); }

  & nav.vertical a {
    color: inherit;
    text-decoration: none;
    opacity: .7;
    font-size: .9rem;
  }

  & nav.vertical a:hover { opacity: 1; }

  & .copy-area {
    display: grid;
    grid-template-columns: 1fr auto;
    gap: .5rem;
    align-items: center;
  }

  & .share-view {
    padding: .5rem;
  }

  & .share-link-copyable-url {
    white-space: nowrap;
    overflow-x: auto;
    display: block;
    padding: .4rem .6rem;
    background: rgba(0,0,0,.05);
    border-radius: .25rem;
    font-family: 'BerkeleyMono', monospace;
    font-size: .85rem;
  }
`)
