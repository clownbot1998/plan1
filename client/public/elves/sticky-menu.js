import elf from '@plan98/elf'

const SECTIONS = {
  script: {
    label: 'Script',
    apps: [
      { label: 'Lore Baby',   href: '/app/lore-baby' },
      { label: 'Source Code', href: '/app/source-code' },
      { label: 'ur-shell',    href: '/app/ur-shell' },
      { label: 'Private AI',  href: '/app/private-ai' },
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
    ]
  },
}

const $ = elf('sticky-menu', {
  activeTab: null,
  route: null,
})

$.draw(target => {
  const { activeTab } = $.learn()

  const sections = Object.entries(SECTIONS).map(([key, s]) => {
    const isActive = activeTab === key
    const appLinks = isActive
      ? s.apps.map(app =>
          `<div class="app-row"><a class="app-link" href="${app.href}" data-launch="${app.href}">${app.label}</a></div>`
        ).join('')
      : ''

    return `
      <div class="section">
        <a class="section-head" href="#" data-tab="${key}">${s.label}</a>
        ${appLinks}
      </div>
    `
  }).join('')

  return `
    <div class="sticky" data-dom="iframe"></div>
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
  },
  afterUpdate(target) {
    const { route } = $.learn()
    const sticky = target.querySelector('[data-dom="iframe"]')
    if (sticky && target.currentRoute !== route) {
      target.currentRoute = route
      sticky.innerHTML = route
        ? `<iframe src="${route}"></iframe>`
        : ''
    }
  }
})

$.when('click', '[data-tab]', event => {
  event.preventDefault()
  const tab = event.target.closest('[data-tab]').dataset.tab
  const { activeTab } = $.learn()
  $.teach({ activeTab: activeTab === tab ? null : tab })
})

$.when('click', '[data-launch]', event => {
  event.preventDefault()
  const route = event.target.closest('[data-launch]').dataset.launch
  $.teach({ route })
  history.pushState({ type: 'sticky-menu-navigation', route }, '', route)
})

addEventListener('popstate', event => {
  const { type, route } = event.state || {}
  if (type === 'sticky-menu-navigation') {
    $.teach({ route: route || null })
  }
})

// seed history so back from first app returns here
history.replaceState({ type: 'sticky-menu-navigation', route: null }, '', location.href)

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
    font-family: 'BerkeleyMono', monospace;
  }

  & .section {
    margin-bottom: 0.5rem;
  }

  & .section-head {
    display: inline-block;
    font-size: 2rem;
    font-weight: 700;
    line-height: 1;
    margin: 2rem 0 0.25rem;
  }

  & .app-row {
    margin: 0;
  }

  & .app-link {
    font-size: 1rem;
    font-weight: 400;
    line-height: 1.6;
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
