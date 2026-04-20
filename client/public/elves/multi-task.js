import elf from '@plan98/elf'
import diffHTML from 'diffhtml'
import lunr from 'lunr'

function tagFromUrl(url) {
  return url.replace('/app/', '').split('?')[0]
}

function trayContent(url) {
  if (!url.startsWith('/app/')) return `<iframe src="${url}" style="width:100%;height:100%;border:none;display:block;"></iframe>`
  const [path, qs] = url.split('?')
  const tag = path.replace('/app/', '')
  const attrs = qs ? qs.split('&').map(p => {
    const [k, v] = p.split('=')
    return `${k}="${decodeURIComponent(v || '')}"`
  }).join(' ') : ''
  return `<${tag} ${attrs}></${tag}>`
}

const TYPE_PRIORITY = ['app', 'saga', 'html', 'js', 'audio', 'video', 'img', 'file']
let searchIdx = null
let searchDocs = {}
let fileManifest = []
let fileIdx = null

fetch('/search-manifest.json')
  .then(r => r.json())
  .then(docs => {
    docs.forEach(d => { searchDocs[d.ref] = d })
    searchIdx = lunr(function() {
      this.ref('ref')
      this.field('name', { boost: 10 })
      this.field('type', { boost: 5 })
      this.field('keywords')
      docs.forEach(d => this.add(d))
    })
  })

fetch('/file-manifest.json')
  .then(r => r.json())
  .then(files => {
    fileManifest = files
    fileIdx = lunr(function() {
      this.ref('path')
      this.field('name', { boost: 10 })
      this.field('ext', { boost: 3 })
      files.forEach(f => this.add(f))
    })
  })

function fileType(entry) {
  const { ext, path } = entry
  if (path.includes('/elves/') && ext === '.js') return 'app'
  if (ext === '.saga') return 'saga'
  if (ext === '.html') return 'html'
  if (['.mp3', '.wav', '.ogg', '.m4a'].includes(ext)) return 'audio'
  if (['.mp4', '.webm', '.m3u8'].includes(ext)) return 'video'
  if (['.png', '.jpg', '.jpeg', '.gif', '.svg', '.webp'].includes(ext)) return 'img'
  if (ext === '.js') return 'js'
  return 'file'
}

function fileToResult(f) {
  const type = fileType(f)
  const url = type === 'app' ? '/app/' + f.name : f.path
  return { label: f.name, url, type }
}

const initial = {
  launcherQuery: '',
  startX: null,
  startY: null,
  x: null,
  y: null,
  invertX: false,
  invertY: false,
  isMouseDown: false,
  trayZ: 3,
  focusedTray: null,
  trays: {},
  showSocial: false,
  profile: {
    banner: null
  }
}

const $ = elf('multi-task', initial)

function renderSystemMenu() {
  const { launcherQuery = '' } = $.learn()
  const q = launcherQuery.trim()

  let results
  if (!q) {
    const sorted = [...fileManifest].sort((a, b) => {
      return TYPE_PRIORITY.indexOf(fileType(a)) - TYPE_PRIORITY.indexOf(fileType(b))
    })
    results = sorted.map(fileToResult)
  } else if (fileIdx) {
    try {
      const hits = fileIdx.search(q + '~1').map(h => fileManifest.find(f => f.path === h.ref)).filter(Boolean)
      hits.sort((a, b) => TYPE_PRIORITY.indexOf(fileType(a)) - TYPE_PRIORITY.indexOf(fileType(b)))
      results = hits.map(fileToResult)
    } catch(e) {
      results = fileManifest.filter(f => f.name.toLowerCase().includes(q.toLowerCase())).map(fileToResult)
    }
  } else {
    results = fileManifest.filter(f => f.name.toLowerCase().includes(q.toLowerCase())).map(fileToResult)
  }

  return `
    <div class="mt-launcher">
      <input class="launcher-input" type="text" placeholder="search…" value="${launcherQuery}" autocomplete="off" />
      <ul class="launcher-list">
        ${results.map(({ label, url, type }) => `
          <li>
            <button class="app-select" data-url="${url}" data-title="${label}">
              <span class="app-type">${type}</span>${label}
            </button>
          </li>
        `).join('')}
      </ul>
    </div>
  `
}

function engine(target) {
  const canvas = target.closest($.link).querySelector('.terminal-canvas')
  const rectangle = canvas.getBoundingClientRect()

  return { canvas, rectangle }
}

function render(target) {
  const trayContainer = target.querySelector('.trays')
  const taskContainer = target.querySelector('.tasks')
  return function runtime(tray) {
    const {
      showSocial,
      focusedTray
    } = $.learn()
    
    const data = $.learn()[tray]
    if(!data) return
    const {
      maximized,
      minimized,
      grabbed,
      width,
      height,
      x,
      y,
      z,
      title,
      url,
      focused
    } = data

    { //tray logic
      let trayNode = trayContainer.querySelector(`[data-id="${tray}"]`)
      if(!trayNode) {
        trayNode = document.createElement('div')
        trayNode.classList.add('tray');
        trayNode.dataset.id = tray
        diffHTML.innerHTML(trayNode, `
          <button class="tray-wake" data-tray="${tray}"></button>
          <div class="tray-title-bar" data-tray="${tray}" data-url="${url}">
            <button class="tray-action tray-close" data-tray="${tray}">
            </button>
            <button class="tray-action tray-min " data-tray="${tray}">
            </button>
            <button class="tray-action tray-max" data-tray="${tray}">
            </button>
            <div class="grabber"><span class="tray-title">${title}</span>
            </div>
          </div>
          <div class="tray-body">
            ${trayContent(url)}
          </div>
          <div class="resize-actions">
            <button aria-label="resize" data-direction="sw" class="tray-resize minimizable resize-left-bottom" data-tray="${tray}">
            </button>
            <button aria-label="resize" data-direction="se" class="tray-resize minimizable resize-right-bottom" data-tray="${tray}">
            </button>

            <button aria-label="resize" data-direction="nw" class="tray-resize minimizable resize-left-top" data-tray="${tray}">
            </button>
            <button aria-label="resize" data-direction="ne" class="tray-resize minimizable resize-right-top" data-tray="${tray}">
            </button>
          </div>
        `)
        trayContainer.appendChild(trayNode)
      }

      trayNode.style = `--width: ${width}px; --height: ${height}px;--x: ${x}px; --y: ${y}px; --z: ${z}; transform: translate(var(--x), var(--y)); z-index: var(--z);`

      if(focusedTray === tray) {
        trayNode.dataset.focused = true
      } else {
        trayNode.dataset.focused = false
      }

      if(maximized) {
        trayNode.setAttribute('class', 'tray maximized')
      } else if(minimized) {
        trayNode.setAttribute('class', 'tray minimized')
      } else {
        trayNode.setAttribute('class', 'tray')
      }

      if(trayNode.dataset.url !== url) {
        trayNode.dataset.url = url
        diffHTML.innerHTML(trayNode.querySelector('.tray-body'), trayContent(url))
      }

      trayNode.dataset.grabbed = grabbed
      trayNode.persist = true
    }

    { //tray logic
      let taskNode = taskContainer.querySelector(`[data-tray="${tray}"]`)
      if(!taskNode) {
        taskNode = document.createElement('div')
        taskNode.classList.add('taskbar-button');
        taskNode.classList.add('task');
        taskNode.dataset.tray = tray
        diffHTML.innerHTML(taskNode, `
          ${title || url}
        `)
        taskContainer.appendChild(taskNode)
      }

      taskNode.style = ``

      if(!showSocial && focusedTray === tray) {
        taskNode.dataset.focused = true
      } else {
        taskNode.dataset.focused = false
      }

      taskNode.persist = true
    }
  }
}

$.draw((target) => {
  if(target.innerHTML) return
  const src = target.getAttribute('src')
  if(src) {
    requestIdleCallback(() => {
      if(src) {
        $.teach({ tray: self.crypto.randomUUID(), src }, (state, payload) => {
          const { tray, src } = payload
          const newState = {...state}
          newState.trays[tray] = true
          newState.focusedTray = tray
          newState.trayZ += 1
          newState[tray] = {
            width: 300,
            height: 150,
            x: 0,
            y: 0,
            z: newState.trayZ,
            url: src,
            title: 'Welcome',
            maximized: true,
            focused: true
          }
          return newState
        })
      }
    })
  } else {
    requestIdleCallback(() => {
      const taskbarHeight = target.querySelector('.taskbar')?.offsetHeight || 0
      const w = Math.floor(window.innerWidth / 2)
      const h = Math.floor((window.innerHeight - taskbarHeight) / 2)
      const hero = self.crypto.randomUUID()
      const apps = [
        { tray: self.crypto.randomUUID(), url: '/app/ur-shell',    title: 'shell',  x: 0, y: 0, width: w, height: h },
        { tray: self.crypto.randomUUID(), url: '/app/flip-book',    title: 'art',    x: w, y: 0, width: w, height: h },
        { tray: self.crypto.randomUUID(), url: '/app/paper-pocket', title: 'music',  x: 0, y: h, width: w, height: h },
        { tray: self.crypto.randomUUID(), url: '/app/lore-baby',    title: 'coding', x: w, y: h, width: w, height: h },
      ]
      $.teach({ hero, apps, heroUrl: '/app/my-computer' }, (state, { hero, apps, heroUrl }) => {
        const newState = { ...state }
        apps.forEach(({ tray, url, title, x, y, width, height }) => {
          newState.trays[tray] = true
          newState.trayZ += 1
          newState[tray] = { width, height, x, y, z: newState.trayZ, url, title, minimized: false, maximized: false }
        })
        newState.trays[hero] = true
        newState.trayZ += 1
        newState.focusedTray = hero
        newState[hero] = { width: apps[0].width, height: apps[0].height, x: 0, y: 0, z: newState.trayZ, url: heroUrl, title: 'clownbot', maximized: true }
        return newState
      })
    })
  }

  return `
    <div class="desktop">
      <div class="trays"></div>
      <div class="cursor"></div>
      <canvas class="terminal-canvas"></canvas>
    </div>
    <div class="system-menu">
      ${renderSystemMenu()}
    </div>
    <div class="settings-menu">
      ${settingsMenu(target)}
    </div>
    <div class="taskbar">
      <div class="left">
        <button data-start-menu class="taskbar-button"></button>
      </div>
      <div class="center tasks"></div>
      <div class="right">
        <button class="to-social taskbar-button">
          👥
        </button>
      </div>
    </div>
  `
}, { beforeUpdate, afterUpdate })

function beforeUpdate(target) {
  saveCursor(target) // first things first

  { // save suggestion box scroll top
    const list = target.querySelector('.suggestion-box')
    if(list) {
      target.dataset.scrollpos = list.scrollTop
    }
  }

  {
    const { profile } = $.learn()

    if(profile.banner && target.banner !== profile.banner) {
      target.banner = profile.banner
      target.setAttribute('background', `url('${profile.banner}')`)
    }
  }

  {
    const { startX, startY, x, y, invertX, invertY } = $.learn()
    const background = target.getAttribute('background')
    const color = target.getAttribute('color')
    
    target.style = `--start-x: ${startX}px; --start-y: ${startY}px; --x: ${Math.abs(x)}px; --y: ${Math.abs(y)}px; --transform: translate(${invertX ? '-100' : '0' }%, ${invertY ? '-100' : '0'}%); ${background ? `--background: ${background};` : ``} ${color ? `--color: ${color}` : ``}`
  }

  {
    [...(target.querySelectorAll('.tray') || [])].map(x => {
      x.persist = false
    });

    [...(target.querySelectorAll('.task') || [])].map(x => {
      x.persist = false
    });
  }

  {
    const { isMouseDown } = $.learn()
    target.dataset.mouse = isMouseDown
  }
}

function recoverElves(target, tag) {
  [...target.querySelectorAll(tag)].map(node => {
    const nodeParent = node.parentNode
    const newNode = document.createElement(tag)
    for (const attr of node.attributes) {
      newNode.setAttribute(attr.name, attr.value)
    }
    node.remove()
    nodeParent.appendChild(newNode)
  })
}

function afterUpdate(target) {
  {
    const { showStart } = $.learn()

    if(target.startState !== showStart) {
      target.startState = showStart
      target.dataset.menu = showStart
      if(showStart) {
        requestAnimationFrame(() => target.querySelector('.launcher-input')?.focus())
      }
    }
  }

  {
    const { launcherQuery, showStart } = $.learn()
    if(showStart && target.lastQuery !== launcherQuery) {
      target.lastQuery = launcherQuery
      const sysMen = target.querySelector(".system-menu")
      diffHTML.innerHTML(sysMen, renderSystemMenu())
    }
  }

  {
    const { showSocial } = $.learn()

    if(`${showSocial}` !== target.dataset.showSocial) {
      target.dataset.showSocial = showSocial
    }
  }

  {
    const { grabbing } = $.learn()
    const trays = target.querySelector('.trays')
    trays.dataset.grabbing = !!grabbing
  }

  {
    const { resizing } = $.learn()
    const trays = target.querySelector('.trays')
    trays.dataset.resizing = !!resizing
  }


  {
    const { isMouseDown } = $.learn()
    const cursor = target.querySelector('.cursor')
    cursor.style = `${isMouseDown ? 'display: grid;' : 'display: none;'};`
  }

  {
    const { trays } = $.learn()
    Object.keys(trays).map(render(target))
  }

  {
    if(target.matches('.inline')) {
      const { trays } = $.learn()
      const somethingMaxed = trays.some(x => {
        const tray = $.learn()[x]
        return tray.maximized
      })

      if(somethingMaxed) { 
        target.classList.remove('inline'); 
        target.classList.add('online')
      }
    }
  }

  {
    [...(target.querySelectorAll('.tray') || [])].filter(x => {
      return !x.persist
    }).map(x => x.remove());
    [...(target.querySelectorAll('.task') || [])].filter(x => {
      return !x.persist
    }).map(x => x.remove());

  }

  replaceCursor(target) // first things first
}


function settingsMenu(target) {
  return `
  `
}

$.when('click', '.to-social', toSocial)

function toSocial() {
  $.teach({ showSocial: !$.learn().showSocial })
}

function toggleMax(event) {
  const tray = event.target.closest('.tray').dataset.id
  const { maximized } = $.learn()[tray]
  maximized ? restoreMax(tray) : maximize(tray)
}

function maximize(tray) {
  $.teach(tray, (state, payload) => {
    const newState = {...state} 
    newState[payload].maximized = true
    newState[payload].minimized = false
    return newState
  })
}

// restore a pane
function restoreMax(tray) {
  $.teach(tray, (state, payload) => {
    const newState = {...state} 
    newState[payload].maximized = false
    return newState
  })
}

function toggleMin(event) {
  const tray = event.target.closest('.tray').dataset.id
  const { minimized } = $.learn()[tray]
  minimized ? restoreMin(tray) : minimize(tray)
}

function selectPane(event) {
  event.stopPropagation()
  const { pane } = event.target.dataset
  $.teach({ systemPane: pane })
}

function selectApp(event) {
  const { x, y } = event
  const { url, title } = event.target.dataset
  newTray({
    url,
    title,
    x: x > window.innerWidth / 2 ? window.innerWidth - x : x,
    y: y > window.innerHeight / 2 ? window.innerHeight - y : y,
  })

  $.teach({ showStart: false })
}

function closeSystemMenu(event) {
  $.teach({ showStart: false })
}

function closeSettingsMenu(event) {
  $.teach({ showSocial: false })
}

function minimize(tray) {
  $.teach(tray, (state, payload) => {
    const newState = {...state} 
    newState[payload].minimized = true
    newState[payload].maximized = false
    return newState
  })
}

// restore a pane
function restoreMin(tray) {
  $.teach(tray, (state, payload) => {
    const newState = {...state} 
    newState[payload].minimized = false
    return newState
  })
}

function closeTray(event) {
  const { tray } = event.target.dataset
  $.teach(tray, (state, payload) => {
    const newState = {...state} 

    if(newState.trays[payload]) {
      delete newState.trays[payload]
      delete newState[payload]
    }

    return newState
  })
}

// grab a pane
let grabTimeout
let grabOffsetX, grabOffsetY
function grab(event) {
  event.preventDefault()
  const { clientX, clientY } = event
  const { tray } = event.target.dataset
  const { trayZ } = $.learn()
  const newZ = trayZ + 1
  const zoom = parseFloat(getComputedStyle(event.target).getPropertyValue('--zoom')) || 1
  const trayData = $.learn()[tray]
  const { x: trayX, y: trayY } = trayData
  const { canvas, rectangle } = engine(event.target)
  const clickX = (event.clientX - rectangle.left) / zoom
  const clickY = (event.clientY - rectangle.top) / zoom

  $.teach({ trayZ: newZ, focusedTray: tray })
  setState(tray, { z: newZ })
  grabTimeout = setTimeout(() => {
    setState(tray, { grabbed: true })
    $.teach({ grabbing: tray })
    grabOffsetX = clickX - trayX
    grabOffsetY = clickY - trayY
  }, 100)
}

// drag a pane
let lastX, lastY;
function drag(event) {
  let { target, clientX, clientY } = event
  const { grabbing, resizing } = $.learn()
  const tray = grabbing || resizing
  if(!tray) return
  const { grabbed, resize, x, y, width, height } = $.learn()[tray]

  const panX = getComputedStyle(event.target).getPropertyValue("--pan-x") || 0;
  const panY = getComputedStyle(event.target).getPropertyValue("--pan-y") || 0;
  const zoom = parseFloat(getComputedStyle(event.target).getPropertyValue('--zoom')) || 1

  if (lastX !== undefined && lastY !== undefined) {
    const movementX = (clientX - lastX) / zoom;
    const movementY = (clientY - lastY) / zoom;
    // Use movementX and movementY here
    if(grabbed) {
      setState(tray, {
        x: x + movementX,
        y: y + movementY
      })
    }
    if(resize) {
      if(resize === 'sw') {
        setState(tray, {
          x: x + movementX,
          height: height + movementY,
          width: width - movementX
        })
      }
      if(resize === 'se') {
        setState(tray, {
          height: height + movementY,
          width: width + movementX
        })
      }
      if(resize === 'ne') {
        setState(tray, {
          y: y + movementY,
          height: height - movementY,
          width: width + movementX
        })
      }
      if(resize === 'nw') {
        setState(tray, {
          x: x + movementX,
          y: y + movementY,
          height: height - movementY,
          width: width - movementX
        })
      }

    }
  } else {
    const { canvas, rectangle } = engine(event.target)

    if(grabbed) {
      const canvasX = (clientX - rectangle.left) / zoom
      const canvasY = (clientY - rectangle.top) / zoom

      setState(tray, {
        x: canvasX - grabOffsetX,
        y: canvasY - grabOffsetY
      })
    }

  }

  lastX = clientX;
  lastY = clientY;
}

// release a pane
function ungrab(event) {
  clearTimeout(grabTimeout)
  const tray = $.learn().grabbing
  if(!tray) return
  setState(tray, { grabbed: false })
  $.teach({ grabbing: null })
  lastX = undefined;
  lastY = undefined;
  grabOffsetX = undefined
  grabOffsetY = undefined
}

// grab a pane
function resize(event) {
  event.preventDefault()
  const { clientX, clientY } = event
  const { tray } = event.target.dataset
  const { trayZ } = $.learn()
  const newZ = trayZ + 1
  const zoom = parseFloat(getComputedStyle(event.target).getPropertyValue('--zoom')) || 1
  const trayData = $.learn()[tray]
  const { x: trayX, y: trayY } = trayData
  const { canvas, rectangle } = engine(event.target)
  const clickX = (event.clientX - rectangle.left) / zoom
  const clickY = (event.clientY - rectangle.top) / zoom

  $.teach({ resizing: tray, trayZ: newZ, focusedTray: tray })
  setState(tray, { resize: event.target.dataset.direction, z: newZ })
  grabOffsetX = clickX - trayX
  grabOffsetY = clickY - trayY
}
function unresize({ target }) {
  const tray = $.learn().resizing
  if(!tray) return
  setState(tray, { resize: null })
  $.teach({ resizing: null })
  lastX = undefined;
  lastY = undefined;
  grabOffsetX = undefined
  grabOffsetY = undefined
}

function setState(tray, payload) {
  $.teach({ tray, ...payload }, (state, payload) => {
    const { tray, ...rest } = payload
    return {
      ...state,
      [tray]: {
        ...state[tray],
        ...rest
      }
    }
  })
}

$.style(`
  & {
    position: relative;
    touch-action: none;
    overflow: hidden;
    display: grid;
    height: 100%;
    grid-template-rows: 1fr auto;
    background:
      linear-gradient(335deg, rgba(255,255,255,.15), rgba(255,255,255,.25), rgba(255,255,255,0), rgba(0,0,0,0), rgba(0,0,0,.35)),
      radial-gradient(circle at bottom left, rgba(255,255,255,0.2), rgba(0,0,0,.2) 70%),
      conic-gradient(from 45deg at 25% 75%, rgba(255,255,255,0.2), rgba(0,0,0,0)),
      repeating-linear-gradient(180deg, rgba(0,0,0,0.05) 0px, rgba(0,0,0,0.1) 10px, rgba(255,255,255,0.05) 10px, rgba(255,255,255,.1) 20px),
      repeating-radial-gradient(circle at bottom left, rgba(255,255,255,0.1) 0px, rgba(255,255,255,0.1) 10px, rgba(255,255,255,0) 10px, rgba(255,255,255,0) 20px),
      var(--root-theme, mediumseagreen);
    user-select: none; /* supported by Chrome and Opera */
		-webkit-user-select: none; /* Safari */
		-khtml-user-select: none; /* Konqueror HTML */
		-moz-user-select: none; /* Firefox */
		-ms-user-select: none; /* Internet Explorer/Edge */
    overflow-x: auto;
  }

  &[background="transparent"] {
    background: transparent;
  }

  & .desktop {
    position: relative;
    overflow: hidden;
    height: 100%;
    z-index: 4;
  }

  & .taskbar {
    background:
      linear-gradient(rgba(0,0,0,.25), rgba(0,0,0,.25)),
      linear-gradient(rgba(255,255,255,.15) 1%, rgba(255,255,255,.45) 10%, rgba(255,255,255,0) 50%, rgba(0,0,0,0) 70%, rgba(0,0,0,.45)),
      var(--root-theme, mediumseagreen);
    z-index: 5;
    padding: 3px;
    display: grid;
    grid-template-columns: auto 1fr auto;
    gap: 1rem;
    position: relative;
  }

  & .system-menu {
    display: none;
    position: absolute;
    inset: 0;
    z-index: 100;
    background: rgba(0,0,0,.6);
    backdrop-filter: blur(4px);
    align-items: flex-start;
    justify-content: center;
    padding-top: 10vh;
  }

  &[data-menu="true"] .system-menu {
    display: flex;
  }

  & [data-snap] {
    padding: 0;
    width: 50px;
    height: 50px;
    border-radius: 100%;
    display: grid;
    place-items: center;
    border: none;
    margin: auto;
    font-size: 25px;
    background: linear-gradient(rgba(0,0,0,.5), rgba(0,0,0,.85)), var(--root-theme, mediumseagreen);
    color: white;
  }

  & [data-snap]:hover,
  & [data-snap]:focus {
    background: linear-gradient(rgba(0,0,0,.15), rgba(0,0,0,.5)), var(--root-theme, mediumseagreen);
  }

  & .taskbar .left,
  & .taskbar .center,
  & .taskbar .right {
    display: flex;
    align-items: center;
  }

  & .taskbar .center {
    overflow: hidden;
    white-space: nowrap;
    width: 100%;
    gap: 3px;
  }

  & .taskbar-button {
    cursor: pointer;
    padding: 0;
    padding: .5rem;
    display: grid;
    place-items: center;
    border-radius: 4px;
    border: none;
    font-size: 1rem;
    color: white;
    text-shadow: 1px 1px var(--root-theme, mediumseagreen);
    backdrop-filter: blur(10px) opacity(20%);
    background: radial-gradient(
      at center top,
      rgba(255, 255, 255, 0.5) 0%,
      rgba(0, 0, 0, 0.1) 31%
    ), var(--root-theme, mediumseagreen);
    background-repeat: no-repeat;
    background-size: 300% 100%;
    background-position: center -50%;
    box-shadow: 1px 1px 1px 0 rgba(0,0,0,.35);
    flex-shrink: 1; /* Allow buttons to shrink */
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    line-height: 1;
    max-width: 100%;
  }

  & .taskbar-button:hover,
  & .taskbar-button:focus {
    background: radial-gradient(
      at center bottom,
      rgba(0, 0, 0, 0.5) 0%,
      rgba(255, 255, 255, 0.25) 31%
    ), var(--root-theme, mediumseagreen);
    background-repeat: no-repeat;
    background-size: 300% 100%;
    background-position: center -50%;
    box-shadow: 1px 1px 1px 0 rgba(0,0,0,.65);
  }

  & .taskbar-button[data-focused="true"] {
    background: radial-gradient(
      at center bottom,
      rgba(0, 0, 0, 0.5) 0%,
      rgba(255, 255, 255, 0.25) 31%
    ), var(--root-theme, mediumseagreen);
    background-repeat: no-repeat;
    background-size: 300% 100%;
    background-position: center -50%;
    box-shadow: 1px 1px 1px 0 rgba(0,0,0,.65) inset;
  }


  & .taskbar-button[data-start-menu] {
    font-weight: bold;
    aspect-ratio: 1;
    height: 2rem;
    width: 2rem;
    background: radial-gradient(
      at center top,
      rgba(255, 255, 255, 0.5) 0%,
      rgba(0, 0, 0, 0.1) 31%
    ), lemonchiffon;
    background-repeat: no-repeat;
    background-size: 300% 100%;
    background-position: center -50%;
    color: var(--root-theme, mediumseagreen);
    text-shadow: none;
    border-radius: 0;
    animation: &-spin ease-in-out 5000ms alternate infinite;
  }

  @keyframes &-spin {
    0% {
      transform: rotate(-360deg);
    }
    100% {
      transform: rotate(360deg);
    }
  }

  @keyframes &-marquee-track {
    0% {
      transform: translateX(20px);
    }

    100% {
      transform: translateX(calc(-50%));
    }
  }



  & .taskbar-button[data-start-menu]:hover,
  & .taskbar-button[data-start-menu]:focus {
    background: radial-gradient(
      at center bottom,
      rgba(0, 0, 0, 0.5) 0%,
      rgba(255, 255, 255, 0.25) 31%
    ), lemonchiffon;
    background-repeat: no-repeat;
    background-size: 300% 100%;
    background-position: center -50%;
  }

  & .to-social {
    border-radius: 100%;
  }

  &.cinema {
    --draw-term-bg: #54796d;
    --draw-term-fg: #54796d;
  }

  & .resize-right-bottom,
  & .resize-left-bottom {
    position: absolute;
    bottom: -5px;
    width: 30px;
    height: 30px;
    border: none;
    padding: 0;
    background-color: #333333;
    cursor: resize;
  }

  & .resize-left-bottom {
    left: -5px;
    cursor: sw-resize;
    border-radius: 0 0 0 4px;
  }

  & .resize-right-bottom {
    right: -5px;
    cursor: se-resize;
    border-radius: 0 0 4px 0;
  }

  & .resize-right-top,
  & .resize-left-top {
    position: absolute;
    top: -5px;
    width: 30px;
    height: 30px;
    border: none;
    padding: 0;
    background-color: #333333;
    cursor: resize;
  }

  & .resize-left-top {
    left: -5px;
    cursor: nw-resize;
    border-radius: 4px 0 0 0;
  }

  & .resize-right-top {
    right: -5px;
    cursor: ne-resize;
    border-radius: 0 4px 0 0;
  }

  & .resize-right-bottom,
  & .resize-left-bottom,
  & .resize-right-top,
  & .resize-left-top {
    opacity: 0;
  }

  & .resize-right-bottom:hover,
  & .resize-left-bottom:hover,
  & .resize-right-top:hover,
  & .resize-left-top:hover {
    opacity: .5;
  }


  &.inline {
    display: inline-block;
    height: 2.2rem;
  }

  &.inline .tray:not(.minimized) {
    transform: translate(0, 0) !important;
    position: absolute;
    inset: 0;
    width: 100% !important;
    height: 100% !important;
  }

  &.online {
    display: block;
    position: absolute;
    inset: 0;
    z-index: 100;
  }

  & .grabber {
    display: block;
    width: 100%;
    padding: 0 .25rem;
  }

  & .terminal-canvas {
    display: block;
    width: 100%;
    height: 100%;
  }

  & .terminal-canvas {
    background-size: cover;
    background-position: cover;
    touch-action: none;
    user-select: none; /* supported by Chrome and Opera */
		-webkit-user-select: none; /* Safari */
		-khtml-user-select: none; /* Konqueror HTML */
		-moz-user-select: none; /* Firefox */
		-ms-user-select: none; /* Internet Explorer/Edge */
  }

  & .cursor {
    position: absolute;
    left: var(--start-x);
    top: var(--start-y);
    width: var(--x);
    height: var(--y);
    background: var(--draw-term-bg, var(--color, lemonchiffon));
    transform: var(--transform);
    pointer-events: none;
    z-index: 9001;
    opacity: 1;
    display: grid;
    place-items: center;
  }

  & .trays[data-resizing="true"],
  & .trays[data-grabbing="true"] {
    pointer-events: none !important;
  }

  & .tray {
    pointer-events: none;
    filter: grayscale(1);
  }

  &[data-mouse="true"] .tray {
    pointer-events: none !important;
  }

  & .tray[data-focused="true"] {
    pointer-events: all;
    filter: grayscale(0);
  }

  & .tray-wake {
    background: none;
    position: absolute;
    inset: 0;
    background: 0;
    border: 0;
    padding: 0;
    pointer-events: all;
  }

  & .tray-wake:hover,
  & .tray-wake:focus {
    background: rgba(0,0,0,.85);
    outline: 2px solid var(--root-theme, mediumseagreen);
    outline-offset: 2px;
  }

  & .tray[data-focused="true"] .tray-wake {
    display: none;
  }

  & [data-resizing="true"] .tray[data-focused="true"],
  & [data-grabbing="true"] .tray[data-focused="true"],
  &[data-mouse="true"] .tray[data-focused="true"],
  & [data-resizing="true"] .tray-wake,
  & [data-grabbing="true"] .tray-wake,
  &[data-mouse="true"] .tray-wake {
    pointer-events: none !important;
  }

  & .grabber {
    pointer-events: none;
  }

  & [data-grabbed="true"] {
    transform: scale(1.1);
    outline: 2px solid var(--root-theme, mediumseagreen);
    outline-offset: 2px;
  }

  & .trays[data-mousedown="true"] {
    pointer-events: none;
  }

  & .trays:empty::before {
    content: 'Draw a rectangle that is not tiny."
    position: absolute;
    inset: 0;
    margin: auto;
  }

  & .tray {
    position: absolute;
    width: var(--width, 160px);
    height: var(--height, 90px);
    background:
      linear-gradient(rgba(0,0,0,.85), rgba(0,0,0,.85)),
      var(--root-theme, mediumseagreen);
    display: grid;
    grid-template-rows: auto 1fr;
    max-width: 100vw;
    max-height: 100vh;
    border-radius: 5px;
    box-shadow: 0 0 1px 2px rgba(0,0,0,.4);
    box-shadow: 0 0 2px 4px rgba(0,0,0,.2);
    box-shadow: 0 0 4px 8px rgba(0,0,0,.1);
  }

  & .tray iframe {
    position: absolute;
    inset: 0;
  }

  & .tray-title-bar {
    border-radius: 4px 4px 0 0;
    background:
      linear-gradient(rgba(0,0,0,.25), rgba(0,0,0,.25)),
      linear-gradient(rgba(255,255,255,.15) 1%, rgba(255,255,255,.45) 10%, rgba(255,255,255,0) 50%, rgba(0,0,0,0) 70%, rgba(0,0,0,.45)),
      var(--root-theme, mediumseagreen);
    z-index: 2;
    padding: .5rem;
    font-size: 1rem;
    line-height: 1;
    color: white;
    position: relative;
    display: grid;
    grid-template-columns: auto auto auto 1fr;
    gap: .5rem;
    touch-action: none;
    user-select: none; /* supported by Chrome and Opera */
		-webkit-user-select: none; /* Safari */
		-khtml-user-select: none; /* Konqueror HTML */
		-moz-user-select: none; /* Firefox */
		-ms-user-select: none; /* Internet Explorer/Edge */
    overflow-x: auto;
    place-items: center;
  }

  & .tray-title-bar input {
    border: none;
    border-radius: 0;
    background: transparent;
    color: rgba(255,255,255,.65);
    width: 100%;
    padding: 0 4px 0;
    height: 100%;
  }

  & .tray-title-bar input:focus {
    color: rgba(255,255,255,.85);
    column-span: 2;
  }

  & .tray-body {
    border-radius: 0 0 4px 4px;
    background: white;
    color: black;
    height: 100%;
    position: relative;
    z-index: 2;
    overflow: auto;
    container-type: inline-size;
    container-name: tray-body;
  }

  & .tray-resize {
    pointer-events: all;
  }

  &:not(.infinite) .tray.maximized {
    transform: translate(0, 0) !important;
 }

  & .tray.maximized {
    position: absolute;
    inset: 0;
    width: 100% !important;
    height: 100% !important;
  }

  & .tray.maximized .tray-title-bar,
  & .tray.maximized .tray-body {
    border-radius: 0;
  }

  & .tray.minimized .tray-title-bar {
    border-radius: 1rem;
  }

  & .tray-title {
    line-height: 1;
    color: rgba(255,255,255,.65);
  }

  & .tray.minimized .tray-title {
    display: none;
  }

  & .tray.minimized:not(.maximized) {
    width: auto;
    height: auto;
    grid-template-rows: auto 0 0;
    border-radius: 1rem;
  }

  & .tray.minimized:not(.maximized) .tray-title-bar {
    grid-template-columns: auto auto auto 2rem;
  }

  & .tray.minimized:not(.maximized) .minimizable {
    display: none;
  }

  & .tray [type="color"] {
    border: none;
    width: 100%;
    height: 100%;
    padding: 0;
  }

  & .tray-action {
    background: transparent;
    border: none;
    border-radius: 0;
    color: white;
    padding: 0;
    opacity: .65;
    transition: opacity 100ms;
    display: grid;
    place-items: center;
    width: 1rem;
    height: 1rem;
  }

  & .tray-action:hover,
  & .tray-action:focus {
    opacity: 1;
  }

  & .tray-toggle {
  }

  & .tray-close {
    margin-left: auto;
  }

  & .tray-close {
    border-radius: 100%;
    background: firebrick;
  }

  & .tray-min {
    border-radius: 100%;
    background: gold;
  }

  & .tray-max {
    border-radius: 100%;
    background: var(--green);
  }

  & .mt-launcher {
    width: min(40rem, 90vw);
    display: flex;
    flex-direction: column;
  }

  & .launcher-input {
    display: block;
    width: 100%;
    background: rgba(255,255,255,.12);
    border: 1px solid rgba(255,255,255,.2);
    border-radius: .75rem;
    color: white;
    font-size: 1.8rem;
    padding: 1rem 1.4rem;
    outline: none;
    box-shadow: 0 4px 24px rgba(0,0,0,.4);
  }

  & .launcher-input::placeholder {
    color: rgba(255,255,255,.35);
  }

  & .launcher-list {
    list-style: none;
    margin: .5rem 0 0;
    padding: 0;
    max-height: 55vh;
    overflow-y: auto;
    scrollbar-width: thin;
    scrollbar-color: rgba(255,255,255,.2) transparent;
  }

  & .launcher-list li {
    padding: 0;
  }

  & .app-select {
    display: flex;
    align-items: center;
    gap: .6rem;
    width: 100%;
    border: none;
    background: transparent;
    color: rgba(255,255,255,.85);
    font-size: 1.4rem;
    text-align: left;
    padding: .6rem .8rem;
    border-radius: .5rem;
    cursor: pointer;
  }

  & .app-select:hover,
  & .app-select:focus {
    background: rgba(255,255,255,.12);
    color: white;
  }

  & .app-type {
    font-size: 1rem;
    opacity: .45;
    min-width: 4rem;
    text-transform: uppercase;
    letter-spacing: .05em;
  }

  & .settings-menu:empty {
    display: none;
  }

  & .settings-menu {
    position: absolute;
    inset: 0;
    z-index: 200;
    display: none;
  }

  &[data-show-social="true"] .settings-menu {
    display: block;
  }

  & .faux-mobile {
    max-width: 320px;
    max-height: 480px;
    width: 100%;
    height: 100%;
    border-radius: 1rem;
    border: 5px solid var(--root-theme, mediumseagreen);
    overflow: hidden;
    right: .5rem;
    bottom: .5rem;
  }

`)

$.when('click', '[data-start-menu]', () => {
  const showStart = !$.learn().showStart
  $.teach({ showStart, showSocial: false, launcherQuery: '' })
})

$.when('click', '.tray-wake', wake)
function wake (e) {
  const { trayZ } = $.learn()
  const newZ = trayZ + 1
  const { tray } = event.target.dataset
  $.teach({ trayZ: newZ, focusedTray: tray })
  setState(tray, { z: newZ })
}

$.when('click', '.task', focusTray)
function focusTray (e) {
  const { trayZ, showSocial } = $.learn()

  if(showSocial) {
    $.teach({ showSocial: false })
    return
  }

  const { tray } = event.target.dataset

  const { z, maximized } = $.learn()[tray]

  if(z === trayZ) {
    setState(tray, { maximized: !maximized, minimized: false })
    $.teach({ showStart: false })
  } else {
    const newZ = trayZ + 1
    $.teach({ trayZ: newZ, focusedTray: tray, showStart: false })
    setState(tray, { z: newZ, minimized: false })
  }
}


function newTray(overrides) {
  const tray = self.crypto.randomUUID()
  const taskbarHeight = document.querySelector(`${$.link} .taskbar`)?.offsetHeight || 0
  const w = Math.floor(window.innerWidth / 2)
  const h = Math.floor((window.innerHeight - taskbarHeight) / 2)
  const defaults = {
    width: w,
    height: h,
    x: Math.floor(window.innerWidth / 4),
    y: Math.floor((window.innerHeight - taskbarHeight) / 4),
  }
  $.teach({ tray, overrides: { ...defaults, ...overrides } }, (state, { tray, overrides }) => {
    const newState = { ...state }
    newState.trays ||= {}
    newState.trays[tray] = true
    newState.trayZ += 1
    newState.focusedTray = tray
    newState[tray] = { z: newState.trayZ, ...overrides }
    return newState
  })
}

$.when('pointerdown', '.terminal-canvas', start)

function start(e) {
  e.preventDefault()
  const { grabbing } = $.learn()
  if(grabbing) return
  const { canvas, rectangle } = engine(e.target)
  const zoom = parseFloat(getComputedStyle(event.target).getPropertyValue('--zoom')) || 1
  const context = canvas.getContext('2d')
  let startX, startY, x, y;
  if (e.touches && e.touches[0] && typeof e.touches[0]["force"] !== "undefined") {
    startX = (e.touches[0].clientX - rectangle.left) / zoom
    startY = (e.touches[0].clientY - rectangle.top) / zoom
  } else {
    startX = (e.clientX - rectangle.left) / zoom
    startY = (e.clientY - rectangle.top) / zoom
  }

  x = 0
  y = 0

  $.teach({ startX, startY, isMouseDown: true, x, y })
}

$.when('pointermove', '.terminal-canvas', move)

function move (e) {
  e.preventDefault()
  const { startX, isMouseDown, startY, grabbing } = $.learn()
  if(grabbing) return
  const { canvas, rectangle } = engine(e.target)
  const context = canvas.getContext('2d')
  if (!isMouseDown) return

  const zoom = parseFloat(getComputedStyle(event.target).getPropertyValue('--zoom')) || 1
  let x, y
  if (e.touches && e.touches[0] && typeof e.touches[0]["force"] !== "undefined") {
    x = (e.touches[0].clientX - rectangle.left) / zoom - startX
    y = (e.touches[0].clientY - rectangle.top) / zoom - startY
  } else {
    x = (e.clientX - rectangle.left) / zoom - startX
    y = (e.clientY - rectangle.top) / zoom - startY
  }
  $.teach({ x, y, invertX: x < 0, invertY: y < 0 })
}

$.when('pointerup', '.terminal-canvas', end)
function end (e) {
  e.preventDefault()
  const { grabbing } = $.learn()
  if(grabbing) return
  const { focusedTray, trayZ=1, startX, x, y, invertX, invertY, startY } = $.learn()

  if(Math.abs(x) > 50 && Math.abs(y) > 50) {
    const { canvas, rectangle } = engine(e.target)
    const context = canvas.getContext('2d')

    const tray = self.crypto.randomUUID()
    const width = Math.max(300, Math.abs(x))
    const height = Math.max(150, Math.abs(y))

    const src = event.target.closest($.link).getAttribute('src')
    setState(tray, {
      width,
      height,
      x: invertX ? startX + x : startX,
      y: invertY ? startY + y : startY,
      z: trayZ + 1,
      title: 'My Computer',
      url: src ? `${src}?${tray}` : `/app/ur-shell?id=${tray}`
    })


    $.teach(tray, (state, payload) => {
      return {
        ...state,
        trays: {
          ...state.trays,
          [payload]: true
        }
      }
    })

    $.teach({ focusedTray: tray, startX: null, startY: null, isMouseDown: false, x: 0, y: 0 })
  } else {
    $.teach({ startX: null, startY: null, isMouseDown: false, x: 0, y: 0 })
  }
};

const tags = ['TEXTAREA', 'INPUT']
let sel = []
function saveCursor(target) {
  if(target.contains(document.activeElement)) {
    target.dataset.paused = document.activeElement.name
    if(tags.includes(document.activeElement.tagName)) {
      const textarea = document.activeElement
      sel = [textarea.selectionStart, textarea.selectionEnd];
    }
  } else {
    target.dataset.paused = null
  }
}

function replaceCursor(target) {
  const paused = target.querySelector(`[name="${target.dataset.paused}"]`)
  
  if(paused) {
    paused.focus()

    if(tags.includes(paused.tagName)) {
      paused.selectionStart = sel[0];
      paused.selectionEnd = sel[1];
    }
  }
}

function launchTray(event) {
  event.preventDefault()
  const { tray } = event.target.dataset
  const { url } = $.learn()[tray]

  window.top.location.href = url
}

function preventDefault(e) { e.preventDefault() }
$.when('contextmenu', '.tray-title-bar', preventDefault)
$.when('pointerdown', '.tray-title-bar', grab)
$.when('pointerdown', '.tray-wake', grab)
$.when('pointerdown', '.tray-resize', resize)

$.when('pointermove', '.terminal-canvas', drag)
$.when('pointermove', '.tray-title-bar', drag)
$.when('pointermove', '.tray-wake', drag)
$.when('pointermove', '.tray-resize', drag)

// ungrab is important to come fairly last so early returns grab grabbing right
$.when('dblclick', '.tray-title-bar', toggleMax)
//$.when('click', '.tray-maxer', toggleMax)
$.when('pointerup', '.terminal-canvas', ungrab)
$.when('pointerup', '.terminal-canvas', unresize)
$.when('pointerup', '.tray-title-bar', ungrab)
$.when('pointerup', '.tray-wake', ungrab)
$.when('pointerup', '.tray-resize', unresize)
$.when('click', '.tray-close', closeTray)
$.when('click', '.tray-launch', launchTray)
$.when('click', '.tray-min', toggleMin)
$.when('click', '.tray-max', toggleMax)

$.when('click', '.system-menu', closeSystemMenu)
$.when('click', '.app-select', selectApp)
$.when('input', '.launcher-input', (event) => {
  $.teach({ launcherQuery: event.target.value })
})

const WINDOW_MANAGER_ALLOW_LIST = ['ur-shell', 'paper-pocket', 'lore-baby']

$.when('open-app', WINDOW_MANAGER_ALLOW_LIST.join(','), (event) => {
  const { url, title } = event.detail
  newTray({ url, title })
  $.teach({ showStart: false })
})
