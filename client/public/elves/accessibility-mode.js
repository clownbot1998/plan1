import { Self, Saga } from '@plan98/types'
import IntlMessageFormat from 'intl-messageformat'
import { showModal, hideModal } from '@plan98/modal'
import $paperPocket, { sideEffects, systemMenu, getTheme, afterUpdateTheme } from './paper-pocket.js'
import { get as wasGet, put as wasPut, del as wasDel, ensureSpace } from './plan98-wallet.js'
import Vosk from 'vosk-browser'
import { agent } from './clownbot-agent.js'

const SL = 'https://cdn.jsdelivr.net/npm/@shoelace-style/shoelace@2.16.0/cdn/assets/icons'
const sagaDocs = [
  { name: 'the-story-so-far', path: '/sagas/plan1/the-story-so-far.saga' },
  { name: 'elevator-pitch', path: '/cdn/sillyz.computer/en-us/elevator-pitch.saga' },
  { name: 'plan4', path: '/sagas/sillyz.computer/plan4.saga' },
  { name: 'about', path: '/sagas/sillyz.computer/about.saga' },
]

async function printSaga(sagaScript) {
  const html = Saga(sagaScript)
  const existing = document.getElementById('__print_dialog__')
  if (existing) existing.remove()
  const dialog = document.createElement('dialog')
  dialog.id = '__print_dialog__'
  dialog.innerHTML = `
    <div class="screenplay">${html}</div>
    <div class="print-banner">
      <button class="standard-button bias-generic" id="__print_cancel__">Cancel</button>
      <button class="standard-button bias-positive" id="__print_go__">Print</button>
    </div>
    <style>
      #__print_dialog__ {
        position: fixed;
        inset: 0;
        width: 100%;
        height: 100%;
        max-width: 100%;
        max-height: 100%;
        margin: 0;
        padding: 0;
        border: none;
        overflow-y: auto;
        background: white;
        z-index: 9000;
        font-family: Courier, monospace;
      }
      #__print_dialog__::backdrop { display: none; }
      .print-banner {
        position: fixed;
        bottom: 0;
        left: 0;
        right: 0;
        padding: .75rem 1rem;
        display: flex;
        gap: .5rem;
        justify-content: flex-end;
        z-index: 9001;
      }
      title-page {
        display: block;
        break-after: page;
        page-break-after: always;
        height: 9in;
      }
      .screenplay xml-html {
        overflow: visible !important;
        max-height: none !important;
        display: block;
      }
      @page { size: letter portrait; margin: 1in; }
      @media print {
        .print-banner { display: none; }
        .screenplay { padding-top: 0; }
      }
    </style>
  `
  document.body.appendChild(dialog)
  dialog.showModal()
  document.getElementById('__print_go__').onclick = async () => {
    // wait two frames for elf $.draw() to finish rendering custom elements
    await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)))
    const screenplay = dialog.querySelector('.screenplay')
    const renderedHtml = screenplay.outerHTML
    const allStyles = Array.from(document.querySelectorAll('style'))
      .map(s => s.textContent).join('\n')
    const iframe = document.createElement('iframe')
    iframe.style.cssText = 'position:fixed;top:-9999px;left:-9999px;width:8.5in;height:11in;border:none;visibility:hidden;'
    document.body.appendChild(iframe)
    const doc = iframe.contentDocument
    doc.open()
    doc.write(`<!DOCTYPE html><html><head><style>
      ${allStyles}
      html, body { height: auto !important; overflow: visible !important; margin: 0 !important; padding: 0 !important; background: white; font-family: Courier, monospace; font-size: 12pt; }
      xml-html { display: block !important; overflow: visible !important; max-height: none !important; height: auto !important; }
      @page { size: 8.5in 11in; margin: 1in 1in 1in 1.5in; }
    </style></head><body>${renderedHtml}</body></html>`)
    doc.close()
    iframe.contentWindow.focus()
    iframe.contentWindow.print()
    setTimeout(() => iframe.remove(), 2000)
  }
  document.getElementById('__print_cancel__').onclick = () => {
    dialog.close(); dialog.remove()
  }
}

function luminance(colorStr) {
  const d = document.createElement('div')
  d.style.color = colorStr
  d.style.display = 'none'
  document.body.appendChild(d)
  const rgb = getComputedStyle(d).color
  document.body.removeChild(d)
  const m = rgb.match(/[\d.]+/g)
  if (!m) return 1
  return [+m[0], +m[1], +m[2]].reduce((lum, c) => {
    const s = c / 255
    return lum + (s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4) * [0.2126, 0.7152, 0.0722].shift()
  }, 0)
}

function contrastColor(colorStr) {
  return luminance(colorStr) > 0.179 ? '#1a1a1a' : '#ffffff'
}

function icon(name) {
  return `<span class="icon" style="--i:url('${SL}/${name}.svg')"></span>`
}



const paperPocketHelp = () => {
  const paperPocketPath = Object.keys(sideEffects)
    .filter(key => $paperPocket.learn().settings[key])
    .reduce((path, key) => {
      path[key] = sideEffects[key]
      return path
    }, {})

  return Object.keys(paperPocketPath).map(key => {
  const { label, description, options, value: _value } = $paperPocket.learn().settings[key]
  const value = $paperPocket.learn()[key]
  return `${key}

  ${label}: ${value}
  ${description}
  ${options.join(' ')}
`}).join('\n')
}

// ── i18n ─────────────────────────────────────────────────────────────────────

let _strings = {}
const _fmtCache = {}

function fmt(key, vars = {}) {
  const template = _strings[key]
  if (!template) return key
  if (!Object.keys(vars).length) return template
  if (!_fmtCache[key]) _fmtCache[key] = new IntlMessageFormat(template, 'en-US')
  return String(_fmtCache[key].format(vars))
}

async function loadStrings() {
  const [system, sagas] = await Promise.all([
    fetch('/cdn/strings/en-us/system.character.json').then(r => r.json()).catch(() => ({})),
    fetch('/cdn/strings/en-us/sagas.character.json').then(r => r.json()).catch(() => ({})),
  ])
  _strings = { ...system, ...sagas }
}

let fileSystem = null

// ── WAS persistence ───────────────────────────────────────────────────────────

const _shellSessionId = new URLSearchParams(location.search).get('id') || 'default'
const _wasPath = `/accessibility-mode/${_shellSessionId}.json`

let _wasSaveTimer = null
function wasSave() {
  clearTimeout(_wasSaveTimer)
  _wasSaveTimer = setTimeout(async () => {
    const { messages, history } = $.learn()
    const json = JSON.stringify({ messages, history })
    try {
      await wasDel(_wasPath).catch(() => null)
      await wasPut(_wasPath, json, { type: 'application/json' })
    } catch {}
  }, 1500)
}

async function wasLoad() {
  await ensureSpace().catch(() => null)
  try {
    const blob = await wasGet(_wasPath)
    if (!blob) return false
    const data = JSON.parse(await blob.text())
    if (data?.messages?.length) {
      $.teach({ messages: data.messages, history: data.history || [] })
      return true
    }
  } catch {}
  return false
}

// tty websocket
let ttySocket = null
let ttyBuffer = ''
let ttyFlushTimer = null
let ttyLastSent = null   // track last sent command to strip echo

// vosk voice
const VOSK_MODEL_URL = '/cdn/sillyz.computer/models/vosk-model-small-en-us-0.15.zip'
const VOSK_WORKLET = '/cdn/sillyz.computer/models/vosk-browser/recognizer-processor.js'
let _voskModel = null
let _voskRecognizer = null
let _voskAudioCtx = null
let _voskStream = null
let _voskSource = null
let _voskProcessor = null
let _voskCommitted = ''

// set theme before first paint so html:has(accessibility-mode) and body:has(accessibility-mode)
// don't flash the fallback color
;(function() {
  const t = getTheme()
  if (t) {
    document.documentElement.style.setProperty('--root-theme', t)
    document.body.style.setProperty('--root-theme', t)
  }
})()

const $ = Self('accessibility-mode', {
  messages: [],
  history: [],
  historyCursor: null,
  messageText: '',
  messageDraft: '',
  cwd: null,
  ttyConnected: false,
  ttyLive: '',
  listening: false,
  voskLoading: false,
  sidebarOpen: false,
  sagaFilter: '',
})

export function sh(message) {
  $.teach({ messageText: message })
  hideModal()
}

export function update(message) {
  const { popped } = $.learn()
  if (popped) hideModal()
}

fileSystem = {}
$.teach({ cwd: '/' })

function history(state, payload) {
  return {
    ...state,
    history: [
      ...state.history,
      payload
    ]
  }
}

function mergeMessage(state, payload) {
  return {
    ...state,
    messages: [
      ...state.messages,
      payload
    ]
  }
}

function addMessage(payload) {
  $.teach(payload, mergeMessage)
  wasSave()
}

function pushHistory(message) {
  $.teach(message, history)
  wasSave()
}

const TMUX_STATUS = /^\[\d+\] \d+:\S+ ".+" \d{2}:\d{2} \d{2}-\w{3}-\d{2}\s*$/

function stripAnsi(str) {
  return str
    .replace(/\x1b\[[0-9;?<>=!]*[a-zA-Z]/g, '')      // CSI: ESC [ ... letter (all param prefixes)
    .replace(/\x1b\][^\x07\x1b]*(\x07|\x1b\\)/g, '') // OSC: ESC ] ... BEL/ST
    .replace(/\x1b[()][0-9A-Za-z]/g, '')              // char set: ESC ( B, ESC ) 0
    .replace(/\x1b[=>MNOPQRSTUVWXYZ\\^_`{|}~]/g, '') // other 2-char ESC sequences
    .replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g, '') // remaining control chars + lone ESC
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .split('\n').filter(l => !TMUX_STATUS.test(l)).join('\n') // drop tmux status bar lines
    .replace(/\n{3,}/g, '\n\n')  // collapse excess blank lines
    .trim()
}

function sendTtyResize(ws) {
  if (!ws || ws.readyState !== WebSocket.OPEN) return
  const cols = Math.floor(window.innerWidth / 9) || 80
  const rows = Math.floor(window.innerHeight / 18) || 24
  const json = JSON.stringify({ columns: cols, rows })
  const enc = new TextEncoder().encode(json)
  const frame = new Uint8Array(1 + enc.length)
  frame[0] = 0x34  // '4' = resize in ttyd protocol
  frame.set(enc, 1)
  ws.send(frame.buffer)
}

function appendTtyOutput(text) {
  let clean = stripAnsi(text)
  if (!clean) return
  if (ttyLastSent) {
    const echo = ttyLastSent + '\n'
    if (clean.startsWith(echo)) clean = clean.slice(echo.length)
    else if (clean.startsWith(ttyLastSent)) clean = clean.slice(ttyLastSent.length)
    ttyLastSent = null
  }
  if (!clean.trim()) return
  ttyBuffer += clean
  $.teach({ ttyLive: ttyBuffer })
  clearTimeout(ttyFlushTimer)
  ttyFlushTimer = setTimeout(flushTtyBuffer, 400)
}

function flushTtyBuffer() {
  if (!ttyBuffer.trim()) { ttyBuffer = ''; $.teach({ ttyLive: '' }); return }
  const output = ttyBuffer
  ttyBuffer = ''
  $.teach({ ttyLive: '' })
  addMessage({ body: output, author: 'assistant', tty: true })
}

async function startVosk() {
  if (_voskRecognizer) return
  $.teach({ voskLoading: true })
  try {
    const channel = new MessageChannel()
    if (!_voskModel) {
      _voskModel = await new Promise((resolve, reject) => {
        const m = new Vosk.Model(VOSK_MODEL_URL)
        m.on('load', v => (v && v.result) ? resolve(m) : reject(new Error('model load failed')))
        m.on('error', e => reject(new Error('model error: ' + JSON.stringify(e))))
      })
    }
    _voskModel.registerPort(channel.port1)
    const sampleRate = 48000
    const recognizer = new _voskModel.KaldiRecognizer(sampleRate)
    recognizer.setWords(false)
    _voskRecognizer = recognizer
    _voskStream = await navigator.mediaDevices.getUserMedia({
      video: false,
      audio: { echoCancellation: true, noiseSuppression: true, channelCount: 1, sampleRate },
    })
    _voskAudioCtx = new AudioContext()
    await _voskAudioCtx.audioWorklet.addModule(VOSK_WORKLET)
    _voskProcessor = new AudioWorkletNode(_voskAudioCtx, 'recognizer-processor', {
      channelCount: 1, numberOfInputs: 1, numberOfOutputs: 1,
    })
    _voskProcessor.port.postMessage({ action: 'init', recognizerId: recognizer.id }, [channel.port2])
    _voskProcessor.connect(_voskAudioCtx.destination)
    _voskSource = _voskAudioCtx.createMediaStreamSource(_voskStream)
    _voskSource.connect(_voskProcessor)
    recognizer.on('partialresult', (msg) => {
      const partial = msg.result?.partial || ''
      const committed = _voskCommitted
      $.teach({ messageText: committed + (partial ? (committed ? ' ' : '') + partial : '') })
    })
    recognizer.on('result', (msg) => {
      const text = msg.result?.text || ''
      if (!text) return
      _voskCommitted = _voskCommitted ? _voskCommitted + ' ' + text : text
      $.teach({ messageText: _voskCommitted })
    })
    $.teach({ listening: true, voskLoading: false })
  } catch (e) {
    console.error('vosk error', e)
    $.teach({ voskLoading: false })
    stopVosk()
  }
}

function stopVosk() {
  if (_voskProcessor) { try { _voskProcessor.disconnect() } catch (e) {} ; _voskProcessor = null }
  if (_voskSource) { try { _voskSource.disconnect() } catch (e) {} ; _voskSource = null }
  if (_voskRecognizer) { try { _voskRecognizer.remove() } catch (e) {} ; _voskRecognizer = null }
  if (_voskStream) { _voskStream.getTracks().forEach(t => t.stop()); _voskStream = null }
  if (_voskAudioCtx) { try { _voskAudioCtx.close() } catch (e) {} ; _voskAudioCtx = null }
  _voskCommitted = ''
  $.teach({ listening: false, voskLoading: false })
}

const killCommands = ['exit', 'quit', 'escape']

function kill(program) {
  return killCommands.includes(program.toLowerCase())
}

const killCommandHandlers = {}

for(const command of killCommands) {
  killCommandHandlers[command] = () => {
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', keyCode: 27, which: 27, bubbles: true }));
  }
}

function disableSecureMode() {
  $.teach({ secureEntry: false })
}

function enableSecureMode() {
  $.teach({ secureEntry: true })
}

function normalMode() {
  $.teach({ modality: null, secureEntry: false })
}

function partial(response) {
  $.teach({ thinkingFace: response })
}

function done(response) {
  $.teach({ thinkingFace: null, thinking: false })
  addMessage({ body: response, author: 'assistant' })
}

async function auth(passphrase, { normalMode }) {
  try {
    const res = await fetch('/api/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ passphrase }),
    })
    if (res.ok) {
      normalMode()
      return fmt('auth.success')
    }
    const data = await res.json().catch(() => ({}))
    if (data.remaining === 0) { normalMode(); return fmt('auth.locked') }
    return fmt('auth.wrong', { remaining: data.remaining != null ? data.remaining : 'unknown' })
  } catch {
    normalMode()
    return fmt('auth.wrong', { remaining: 'unknown' })
  }
}

const modalities = {
  async agent(program) {
    if (program === 'exit' || program === 'quit') {
      $.teach({ modality: null })
      await agent(null)
      return { body: fmt('agent.exit'), system: true }
    }
    $.teach({ thinking: true })
    const message = await agent(program, {
      partial: (text) => $.teach({ thinkingFace: text }),
      done: () => $.teach({ thinkingFace: null }),
    })
    $.teach({ thinking: false })
    return message
  },

  async auth(program) {
    const { secureEntry } = $.learn()
    if(!secureEntry && (program === 'exit' || program === 'quit')) {
      $.teach({ modality: null, secureEntry: false })
      return { body: fmt('auth.aborted'), system: true }
    }
    return await auth(program, {
      enableSecureMode,
      disableSecureMode,
      normalMode
    })
  },
  luau(program) {
    if(kill(program)) {
      $.teach({ modality: null })
      return { body: fmt('luau.exiting'), system: true }
    }
    if(imports.haveLuau) {
      const logs = imports.haveLuau(program)

      return logs.join('\n')
    }
  },
  async js(program) {
    if(program === 'exit' || program === 'quit') {
      $.teach({ modality: null })
      return { body: fmt('js.exiting'), system: true }
    }
    if(imports.runJs) {
      const result = JSON.stringify(await imports.runJs(program), '', 2)
      return { body: result, actor: 'javascript' }
    }
  },

  async tty(program) {
    if (program === 'exit' || program === 'quit') {
      if (ttySocket) ttySocket.close()
      return
    }
    if (!ttySocket || ttySocket.readyState !== WebSocket.OPEN) {
      return { body: fmt('shell.not.connected'), system: true }
    }
    ttyLastSent = program
    const enc = new TextEncoder().encode(program + '\r')
    const msg = new Uint8Array(1 + enc.length)
    msg[0] = 0x30
    msg.set(enc, 1)
    ttySocket.send(msg)
    return null
  },

}

const commands = {
  ...killCommandHandlers,

  'help': () => ({ saga: true, body: `@ Sagas

# apps

<code
text: art

> flip-book animation

<code
text: music

> paper-pocket sequencer

<code
text: coding

> js-repl

<code
text: clownbot

> terminal session

<code
text: js

> quickjs repl

# quit

<code
text: clear

> wipe session history

<code
text: exit

<code
text: quit

> close the current modal

# filesystem

<code
text: pwd

> where am I?

<code
text: ls

> list directory

> cd path - change directory

# keyboard
> up / down - history
> Tab - autocomplete
> Ctrl+C - interrupt` }),

  'clear': async () => {
    $.teach({ messages: [], history: [], historyCursor: null })
    try { await wasDel(_wasPath) } catch {}
    return null
  },

  'pwd': function() {
    const { cwd } = $.learn()
    return { body: cwd || '/', system: true }
  },

  'ls': function() {
    const { cwd } = $.learn()
    const entries = Object.keys(fileSystem || {})
      .filter(k => {
        const rel = k.startsWith(cwd) ? k.slice(cwd.length) : null
        return rel && !rel.includes('/')
      })
    const body = entries.length ? entries.join('  ') : `${cwd || '/'}\n(empty)`
    return { body, system: true }
  },

  'cd': function(path) {
    if (!path || path === '~') {
      $.teach({ cwd: '/' })
      return { body: '/', system: true }
    }
    const { cwd } = $.learn()
    let next
    if (path === '..') {
      const parts = (cwd || '/').replace(/\/$/, '').split('/')
      parts.pop()
      next = parts.join('/') || '/'
    } else if (path.startsWith('/')) {
      next = path
    } else {
      next = ((cwd || '/').replace(/\/$/, '') + '/' + path)
    }
    $.teach({ cwd: next })
    return { body: next, system: true }
  },

  'admin': () => {
    $.teach({ modality: 'auth', secureEntry: true })
    return { body: fmt('auth.prompt'), system: true }
  },
  'agent': async () => {
    $.teach({ modality: 'agent' })
    const { agent } = await import('./clownbot-agent.js')
    const reply = await agent(null)
    return reply
  },
  'color': () => {
    loadModule('<plan98-palette')
    return { body: fmt('palette.launching'), system: true }
  },
  'art': () => {
    loadPath('/app/flip-book')
    return { body: fmt('art.opening'), system: true }
  },
  'music': () => {
    loadPath('/app/paper-pocket')
    return { body: fmt('music.opening'), system: true }
  },
  'coding': () => {
    loadPath('/app/js-repl')
    return { body: fmt('coding.opening'), system: true }
  },
  'clownbot': () => {
    loadPath('/app/tty-elf')
    return { body: fmt('clownbot.connecting'), system: true }
  },
  'tty': async function(sessionArg) {
    if (ttySocket) { ttySocket.close(); ttySocket = null }
    const authCheck = await fetch('/shell/', { method: 'HEAD' })
    if (authCheck.status === 401 || authCheck.redirected && authCheck.url.includes('admin')) {
      return 'shell requires auth -[login](/admin?next=/)'
    }
    const proto = location.protocol === 'https:' ? 'wss' : 'ws'
    const session = sessionArg || 'new'
    const ws = new WebSocket(`${proto}://${location.host}/shell/ws?session=${encodeURIComponent(session)}`, ['tty'])
    ws.binaryType = 'arraybuffer'
    ttySocket = ws
    ws.onopen = () => {
      ws.send(JSON.stringify({ AuthToken: '' }))
      $.teach({ ttyConnected: true, modality: 'tty' })
      sendTtyResize(ws)
    }
    ws.onmessage = (event) => {
      if (event.data instanceof ArrayBuffer) {
        const bytes = new Uint8Array(event.data)
        if (bytes[0] === 0x30) appendTtyOutput(new TextDecoder().decode(bytes.slice(1)))
      } else if (typeof event.data === 'string') {
        if (event.data[0] === '0') appendTtyOutput(event.data.slice(1))
      }
    }
    const onResize = () => sendTtyResize(ws)
    window.addEventListener('resize', onResize)
    ws.onclose = () => {
      ttySocket = null
      window.removeEventListener('resize', onResize)
      clearTimeout(ttyFlushTimer)
      if (ttyBuffer.trim()) flushTtyBuffer()
      $.teach({ ttyConnected: false, modality: null })
      addMessage({ body: fmt('shell.disconnected'), author: 'assistant', system: true })
    }
    ws.onerror = () => {
      ttySocket = null
      window.removeEventListener('resize', onResize)
      $.teach({ ttyConnected: false, modality: null })
      addMessage({ body: fmt('shell.unavailable'), author: 'assistant', system: true })
    }
    return { body: fmt('shell.opening'), system: true }
  },
  'js': () => {
    import('./js-repl.js').then((module) => {
      imports.runJs = module.runJs
      $.teach({ modality: 'js' })
    }).catch(e => console.error(e))
    return { body: fmt('js.entering'), system: true }
  },
}



function mount(target) {
  if(target.mounted) return
  target.mounted = true
  const command = target.getAttribute('command')
  const message = target.getAttribute('message')
  const src = target.getAttribute('src')
  const rom = target.getAttribute('rom')
  loadStrings().then(() => wasLoad()).then(hadHistory => {
    if (!hadHistory) {
      addMessage({ body: '${brand} is a creative suite for ${demographic} for', author: 'unassigned' })
      addMessage({ body: '<code\ntext: art\n\n<code\ntext: music\n\n<code\ntext: coding', author: 'unassigned', saga: true })
      addMessage({ body: `@ Sagas\n> ${fmt('sagas.intro')}`, author: 'assistant', saga: true })
    }
    if(command) execute(command)
    else if(src) execute(src, { suppressBack: true })
    else if(rom) execute('<'+rom, { suppressBack: true })
    else if(message) sh(message)
  })
}

$.draw((target) => {
  mount(target)
  const { secureEntry, messages, messageText, messageHeight, thinking, thinkingFace, ttyLive, ttyConnected, listening, voskLoading, sidebarOpen, sagaFilter } = $.learn()

  const toQuote = (body) =>
    (body || '').split('\n').map(l => l.trim() ? `> ${escapeHyperText(l)}` : '').join('\n')

  const sagaScript = [
    ...messages.map((m, i) => {
      if (m.saga) return m.body
      if (m.author === 'unassigned') return escapeHyperText(m.body)
      if (m.tty || m.system) return escapeHyperText(m.body)
      if (m.author === 'human') return `@ Me\n${toQuote(m.body)}`
      const actor = m.actor || 'Sagas'
      const prev = messages[i - 1]
      const continuingSagas = prev && prev.author === 'assistant' && !prev.saga && !prev.tty && !prev.system && (prev.actor || 'Sagas') === actor
      return continuingSagas ? toQuote(m.body) : `@ ${actor}\n${toQuote(m.body)}`
    }),
    (() => {
      if (!thinkingFace && !ttyLive) return null
      const text = thinkingFace || ttyLive
      if (ttyLive) return escapeHyperText(text)
      const lastMsg = messages[messages.length - 1]
      const continuingSagas = lastMsg && lastMsg.author === 'assistant' && !lastMsg.saga && !lastMsg.tty && !lastMsg.system
      return continuingSagas ? toQuote(text) : `@ Sagas\n${toQuote(text)}`
    })(),
  ].filter(Boolean).join('\n\n')

  const sagaHtml = sagaScript ? Saga(sagaScript) : ''

  const filteredSagas = sagaFilter
    ? sagaDocs.filter(s => s.name.includes(sagaFilter.toLowerCase()))
    : sagaDocs

  return `
      <div class="scroll-back">
        <button type="button" class="sidebar-toggle" data-toggle-sidebar title="sagas">${icon('journal-text')}</button>
        <div class="messages">
          ${sagaHtml}
        </div>
      </div>
      <div class="sagas-sidebar" data-open="${sidebarOpen}">
        <div class="sagas-sidebar-inner">
          <div class="sagas-sidebar-actions">
            <button class="sb-action-btn" data-sb-load>load</button>
            <button class="sb-action-btn" data-sb-save>save</button>
            <button class="sb-action-btn" data-sb-print>print</button>
            <button class="sb-action-btn" data-sb-share>share</button>
            <button class="sb-action-btn" data-close-sidebar>✕</button>
          </div>
          <div class="sagas-sidebar-filter">
            <input class="sagas-filter-input" type="text" placeholder="filter..." value="${escapeHyperText(sagaFilter)}" data-saga-filter>
          </div>
          <div class="sagas-list">
            ${filteredSagas.map(s => `
              <button class="saga-item" data-load-saga="${escapeHyperText(s.path)}">${escapeHyperText(s.name)}</button>
            `).join('')}
          </div>
        </div>
      </div>
      <form>
        ${thinking ? `
          <div class="loading">
            <flying-disk></flying-disk>
          </div>
        ` : ''}
        <div class="compose-row">
          <button type="button" class="compose-btn mic-btn${listening ? ' -active' : ''}${voskLoading ? ' -loading' : ''}" data-mic>${icon(voskLoading ? 'hourglass-split' : listening ? 'record-circle' : 'mic')}</button>
          ${secureEntry ? `
            <input
              type="password"
              data-bind
              name="messageText"
              placeholder="help"
              value="${escapeHyperText(messageText)}">
          ` : `
            <textarea
              data-bind
              name="messageText"
              placeholder="${ttyConnected ? 'say or type a command' : 'help'}"
              value="${escapeHyperText(messageText)}"
            ></textarea>
          `}
          <button type="submit" class="compose-btn send-btn">${icon('send')}</button>
        </div>
      </form>
  `
}, {
  beforeUpdate,
  afterUpdate
})

function beforeUpdate(target) {
  { // convert a query string to new post
    const q = target.getAttribute('q')
    if(!target.initialized) {
      target.initialized = true

      if(q) {
        const message = decodeURIComponent(q)
        $.teach({ messageText: message })
      }
    }
  }

  //saveCursor(target)
}

function afterUpdate(target) {
  if (target.parentElement?.tagName === 'MAIN' && !target._scrollLocked) {
    target._scrollLocked = true

    document.addEventListener('touchstart', (e) => {
      const el = e.target.closest('.scroll-back')
      if (el) el._touchStartY = e.touches[0].clientY
    }, { passive: true })

    document.addEventListener('touchmove', (e) => {
      const el = e.target.closest('.scroll-back')
      if (!el) { e.preventDefault(); return }

      const dy = e.touches[0].clientY - (el._touchStartY || e.touches[0].clientY)
      const atTop    = el.scrollTop <= 0
      const atBottom = el.scrollTop + el.clientHeight >= el.scrollHeight - 1

      if ((dy > 0 && atTop) || (dy < 0 && atBottom)) e.preventDefault()
    }, { passive: false })
  }

  //replaceCursor(target)

  {
    const { messages } = $.learn()
    if(target.lastIndex !== messages.length -1) {
      target.lastIndex = messages.length - 1
      const scrollBack = target.querySelector('.scroll-back')
      if (scrollBack) scrollBack.scrollTop = scrollBack.scrollHeight
    }
  }

  {
    afterUpdateTheme($paperPocket, target)
  }
  {
    const theme = getTheme()
    if(target.theme !== theme) {
      target.theme = theme
      document.body.style.setProperty('--root-theme', theme)
      document.documentElement.style.setProperty('--root-theme', theme)
      document.documentElement.style.setProperty('--compose-btn-contrast', contrastColor(theme))
    }
  }

  {
    {
      const elem = document.querySelector('[name="messageText"]')
      if(elem) {
        const active = document.activeElement
        const inSidebar = active && active.closest('.sagas-sidebar')
        if (!inSidebar) elem.focus()
        elem.style.height = 'auto'
        const sh = elem.scrollHeight
        elem.style.height = sh > 60 ? sh + 'px' : ''
      }
    }
  }
}

let sel = []
const tags = ['TEXTAREA', 'INPUT']
function saveCursor(target) {
  if(target.contains(document.activeElement)) {
    target.dataset.field = document.activeElement.name
    if(tags.includes(document.activeElement.tagName)) {
      const textarea = document.activeElement
      sel = [textarea.selectionStart, textarea.selectionEnd];
    }
  }
}

function replaceCursor(target) {
  const field = target.querySelector(`[name="${target.dataset.field}"]`)

  if(field) {
    field.focus()

    if(tags.includes(field.tagName)) {
      field.selectionStart = sel[0];
      field.selectionEnd = sel[1];
    }
  }
}

function clearCursor(target) {
  target.dataset.field = null
  sel = []
}


$.when('click', '[data-mic]', async () => {
  const { listening } = $.learn()
  if (listening) {
    stopVosk()
  } else {
    await startVosk()
  }
})

$.when('keypress', 'form [name="messageText"]', (event) => {
  if (event.key === "Enter" && !event.shiftKey) {
    event.preventDefault();
    const message = event.target.value
    execute(message)
  }
})

$.when('submit', 'form', (event) => {
  event.preventDefault()
  const message = event.target.messageText.value
  execute(message)
})

const imports = {}

async function execute(message, options={}) {
  if(!message) return

  const { secureEntry } = $.learn()

  if(!secureEntry) {
    pushHistory(message)
    addMessage({ body: message, author: 'human' })
  }

  _voskCommitted = ''
  $.teach({ historyCursor: null, messageText: '', messageDraft: '' })

  if(message.startsWith('<')) {
    addMessage({ body: fmt('load.module'), author: 'assistant', system: true })
    loadModule(message, options)
    return
  }

  if(message.startsWith('/')) {
    addMessage({ body: fmt('load.path'), author: 'assistant', system: true })
    loadPath(message, options)
    return
  }

  const { modality } = $.learn()

  if (modality === 'tty') {
    if (ttySocket && ttySocket.readyState === WebSocket.OPEN) {
      ttyLastSent = message
      const enc = new TextEncoder().encode(message + '\r')
      const frame = new Uint8Array(1 + enc.length)
      frame[0] = 0x30
      frame.set(enc, 1)
      ttySocket.send(frame.buffer)
    }
    return
  }

  if(modalities[modality]) {
    const result = await modalities[modality](message)
    if(result) {
      const msg = typeof result === 'object' ? result : { body: result }
      addMessage({ ...msg, author: 'assistant' })
    }
    return
  }

  const [command, ...args] = message.split(' ')
  const program = commands[command] || commands[command.toLowerCase()]
  if(program) {
    try {
      const result = await program.apply($, args)
      if(result) {
        const msg = typeof result === 'object' ? result : { body: result }
        addMessage({ ...msg, author: 'assistant' })
      }
    } catch(e) {
      addMessage({ body: `Error. Inspect Logs.<br><a href="${window.location.origin + window.location.pathname}?q=${message}&debug=true">Reload in debug mode</a>`, author: 'assistant' })
      console.error(e)
    }
    return
  } else {
    addMessage({ body: fmt('command.unknown'), author: 'assistant', system: true })
  }
}

export function loadPath(message, options = {}) {
  const tag = message.replace('/app/', '').split('?')[0]
  let html = `
    <div style="display: grid; height: 100%; width: 100%; grid-template-rows: auto 1fr;">
      <div style="background: black;">
        <button data-modal-close class="branded-button">Back</button>
      </div>
      <${tag}></${tag}>
    </div>
  `

  if(options.suppressBack) {
    html = `<${tag}></${tag}>`
  }

  // add some hype to our scene
  showModal(html, {
    blockExit: true,
    onHide: () => $.teach({ popped: false })
  })

  $.teach({ popped: true })
}

const elements = "a,abbr,address,area,article,aside,audio,b,base,bdi,bdo,blockquote,body,br,button,canvas,caption,cite,code,col,colgroup,data,datalist,dd,del,details,dfn,dialog,div,dl,dt,em,embed,fieldset,figcaption,figure,footer,form,h1,h2,h3,h4,h5,h6,head,header,hgroup,hr,html,i,iframe,img,input,ins,kbd,label,legend,li,link,main,map,mark,menu,meta,meter,nav,noscript,object,ol,optgroup,option,output,p,param,picture,pre,progress,q,rp,rt,ruby,s,samp,script,section,select,slot,small,source,span,strong,style,sub,summary,sup,table,tbody,td,template,textarea,tfoot,th,thead,time,title,tr,track,u,ul,var,video,wbr"


export async function loadModule(message, options = {}) {
  const [firstLine, ...lines] = message.split('\n')

  const elf = firstLine.slice(1)
  const url = `/public/elves/${elf}.js`
  const exists = (await fetch(url, { method: 'HEAD' })).ok
  if(!exists && !elements.includes(elf)) {
    addMessage({ body: fmt('elf.not.found'), author: 'assistant', system: true })
    return
  }

  const properties = {}

  try {
    // loop over our lines one at a time
    for (const line of lines) {
      // where in the line is our break
      const index = line.indexOf(':')
      // before then is the attribute
      const key = line.substring(0, index)
      // after then is the data
      const value = line.substring(index+1)

      // no data?
      if(!key) {
        return
      }

      properties[key.trim()] = value.trim()
    }
    // collect the properties from our actor
    let innerHTML = ''
    let innerText = ''

    // convert them into hype attributes
    const attributes = Object.keys(properties)
      .map(x => {
        if(x === 'html') {
          innerHTML = properties[x]
          return ''
        }
        if(x === 'text') {
          innerText = properties[x]
          return ''
        }

        return `${x}="${properties[x]}" `
      }).join('')

    const elvish = `<${elf} ${attributes}>${innerHTML || innerText}</${elf}>`


    let html = `
      <div style="display: grid; height: 100%; width: 100%; grid-template-rows: auto 1fr;">
        <div style="background: black;">
          <button data-modal-close class="branded-button">Back</button>
        </div>
        ${elvish}
      </div>
    `

    if(options.suppressBack) {
      html = `
        <div style="width: 100%; height: 100%;">
          ${elvish}
        </div>
      `
    }

    showModal(html, {
      blockExit: true,
      onHide: () => $.teach({ popped: false })
    })

    $.teach({ popped: true })
  } catch(e) {
    console.error(e)
    addMessage({ body: fmt('elf.load.failed'), author: 'assistant', system: true })
  }
}

$.style(`
  html:has(&),
  body:has(&) {
    position: fixed;
    inset: 0;
    overflow: hidden;
    overscroll-behavior: none;
    background: white;
  }

  main > & {
    position: fixed;
    inset: 0;
  }

  & {
    display: grid;
    grid-template-rows: 1fr auto;
    height: 100%;
    overflow: hidden;
    background: white;
    color: black;
    position: relative;
  }

  & .icon {
    display: inline-block;
    width: 1.25rem; height: 1.25rem;
    background: currentColor;
    -webkit-mask: var(--i) center/contain no-repeat;
    mask: var(--i) center/contain no-repeat;
    vertical-align: middle;
    flex-shrink: 0;
  }

  & .compose-row {
    display: grid;
    grid-template-columns: auto 1fr auto;
    align-items: end;
    gap: .5rem;
    padding: 0 .5rem .5rem;
  }

  & .compose-btn {
    width: 44px;
    height: 44px;
    padding: 8px;
    background: var(--root-theme, mediumseagreen);
    border: none;
    border-radius: 100%;
    cursor: pointer;
    color: var(--compose-btn-contrast, #1a1a1a);
    font-size: 1rem;
    display: flex;
    align-items: center;
    justify-content: center;
    touch-action: manipulation;
    user-select: none;
    -webkit-user-select: none;
    flex-shrink: 0;
  }

  & .mic-btn.-loading { opacity: .5; }

  & form input,
  & form textarea {
    width: 100%;
    display: block;
    border: 2px solid var(--root-theme, mediumseagreen);
    border-radius: .5rem;
    padding: 8px;
    margin: 0;
    font-size: 1rem;
    font-family: Courier, 'Courier New', monospace;
    background: white;
    color: black;
    box-sizing: border-box;
  }

  & form textarea {
    resize: none;
    height: 44px;
    max-height: 35vh;
    overflow-y: auto;
    line-height: 1.5;
    margin-bottom: calc(-2px - .5rem);
    border-bottom-left-radius: 0;
    border-bottom-right-radius: 0;
  }

  & textarea:focus,
  & input:focus {
    outline-offset: -2px;
    outline-color: transparent;
    caret-color: black;
  }

  & .scroll-back {
    position: relative;
    height: 100%;
    overflow-y: auto;
    overflow-x: hidden;
    overscroll-behavior: contain;
    -webkit-overflow-scrolling: touch;
  }

  & .sidebar-toggle {
    position: sticky;
    top: .5rem;
    float: right;
    margin: .5rem .5rem 0 0;
    width: 44px;
    height: 44px;
    background: var(--root-theme, mediumseagreen);
    color: var(--compose-btn-contrast, #1a1a1a);
    border: none;
    border-radius: 100%;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: .85rem;
    z-index: 10;
    flex-shrink: 0;
  }

  & .sagas-sidebar {
    position: absolute;
    top: 0; right: 0;
    height: 100%;
    width: 260px;
    z-index: 20;
    transform: translateX(100%);
    transition: transform 220ms cubic-bezier(.4,0,.2,1);
    display: flex;
    flex-direction: column;
    background: white;
    border-left: 2px solid var(--root-theme, mediumseagreen);
    pointer-events: none;
  }

  & .sagas-sidebar[data-open="true"] {
    transform: translateX(0);
    pointer-events: all;
  }

  & .sagas-sidebar-inner {
    display: flex;
    flex-direction: column;
    height: 100%;
    overflow: hidden;
  }

  & .sagas-sidebar-actions {
    display: flex;
    border-bottom: 1px solid #eee;
    flex-shrink: 0;
  }

  & .sb-action-btn {
    flex: 1;
    background: transparent;
    border: none;
    border-right: 1px solid #eee;
    padding: .5rem .25rem;
    font-family: 'Recursive', monospace;
    font-size: .65rem;
    cursor: pointer;
    color: #666;
    text-align: center;
    transition: all 80ms;
  }
  & .sb-action-btn:last-child { border-right: none; }
  & .sb-action-btn:hover { background: var(--root-theme, mediumseagreen); color: var(--compose-btn-contrast, #1a1a1a); }

  & .sagas-sidebar-filter {
    padding: .5rem;
    border-bottom: 1px solid #eee;
    flex-shrink: 0;
  }

  & .sagas-filter-input {
    width: 100%;
    box-sizing: border-box;
    border: 1px solid #ddd;
    padding: .35rem .5rem;
    font-size: .8rem;
    font-family: 'Recursive', monospace;
  }

  & .sagas-list {
    flex: 1;
    overflow-y: auto;
    padding: .25rem 0;
  }

  & .saga-item {
    display: block;
    width: 100%;
    background: transparent;
    border: none;
    border-bottom: 1px solid #f0f0f0;
    padding: .6rem .75rem;
    font-family: 'Recursive', monospace;
    font-size: .8rem;
    text-align: left;
    cursor: pointer;
    color: #333;
  }
  & .saga-item:hover { background: var(--root-theme, mediumseagreen); color: var(--compose-btn-contrast, #1a1a1a); }

  @media print {
    & .sidebar-toggle,
    & .sagas-sidebar,
    & form { display: none; }
    & .scroll-back { height: auto; overflow: visible; }
    & .messages { font-family: Courier, 'Courier New', monospace; }
  }

  & .messages {
    padding: .5rem;
    min-height: 100%;
    font-family: Courier, 'Courier New', monospace;
  }


  & code {
    cursor: pointer;
  }

  & .ur-title {
    color: black;
    font-size: 2rem;
    font-family: 'Recursive';
    font-variation-settings: "MONO" 0, "CASL" 0, "wght" 800, "slnt" 0, "CRSV" 0;
  }
`)

function escapeHyperText(text = '') {
  return text.replace(/[&<>'"]/g,
    actor => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      "'": '&#39;',
      '"': '&quot;'
    }[actor])
  )
}

$.when('input', '[data-bind]', event => {
  const { name, value } = event.target;
  $.teach({ [name]: value })
})



$.when('input', '[name="messageText"]', (event) => {
  const { value } = event.target;
  _voskCommitted = value
  $.teach({ messageDraft: value })
});

$.when('click', 'code', (event) => {
  const value = event.target.innerText;
  execute(value)
});



$.when('keydown', '[name="messageText"]', event => {
  const { history, historyCursor, messageText, messageDraft } = $.learn()
  if(event.key === 'Tab') {
    event.preventDefault()
    const command = Object.keys(commands).find(x => x.startsWith(messageText))
    if(command) {
      $.teach({ messageText: command })
    }

    return
  }

  if(event.key === 'ArrowDown') {
    if(!isLastLine(event.target)) return
    if(historyCursor === null) return
    event.preventDefault()
    const cursor = historyCursor + 1
    if(cursor >= history.length) {
      $.teach({ historyCursor: null, messageText: messageDraft })
    } else {
      $.teach({ historyCursor: cursor, messageText: history[cursor] })
    }
    return
  }

  if(event.key === 'ArrowUp') {
    if(!isFirstLine(event.target)) return
    event.preventDefault()
    const cursor = (historyCursor === null) ? history.length - 1 : historyCursor - 1
    if(cursor < 0) return
    $.teach({ historyCursor: cursor, messageText: history[cursor] })
    return
  }
})

function isFirstLine(textarea) {
  const cursorPosition = textarea.selectionStart;
  const fullText = textarea.value;
  const textBeforeCursor = fullText.substring(0, cursorPosition);
  return !textBeforeCursor.includes('\n');
}

function isLastLine(textarea) {
  const cursorPosition = textarea.selectionStart;
  const fullText = textarea.value;
  const textAfterCursor = fullText.substring(cursorPosition);
  return !textAfterCursor.includes('\n');
}

function interrupt() {
  normalMode()
  $.teach({ secureEntry: false, messageHeight: null, messageText: '', messageDraft: '' })
  addMessage({ body: fmt('sagas.interrupted'), author: 'assistant' })
}

const hotkeys = {}

$.when('keydown', '[name="messageText"]', (event) => {
  hotkeys[event.key] = true

  if(hotkeys['Control'] && (event.key === 'c' || event.key === 'C')) {
    interrupt()
  }
})

$.when('keyup', '[name="messageText"]', (event) => {
  hotkeys[event.key] = false
})

$.when('click', '[data-toggle-sidebar]', () => {
  $.teach({ sidebarOpen: !$.learn().sidebarOpen })
})

$.when('click', '[data-close-sidebar]', () => {
  $.teach({ sidebarOpen: false })
})

$.when('input', '[data-saga-filter]', (event) => {
  $.teach({ sagaFilter: event.target.value })
})

$.when('click', '[data-load-saga]', async (event) => {
  const path = event.target.dataset.loadSaga
  try {
    const text = await fetch(path).then(r => r.text())
    $.teach({ messages: [{ body: text, author: 'unassigned', saga: true, id: Date.now() }] })
  } catch (e) {
    $.teach({ messages: [{ body: `could not load ${path}`, author: 'unassigned', system: true, id: Date.now() }] })
  }
  $.teach({ sidebarOpen: false })
})

$.when('click', '[data-sb-print]', () => {
  const { messages } = $.learn()
  const toQuote = (body) => (body || '').split('\n').map(l => l.trim() ? `> ${l}` : '').join('\n')
  const script = messages.map(m => {
    if (m.saga) return m.body
    if (m.author === 'unassigned') return m.body
    if (m.tty || m.system) return m.body
    if (m.author === 'human') return `@ Me\n${toQuote(m.body)}`
    return `@ ${m.actor || 'Sagas'}\n${toQuote(m.body)}`
  }).filter(Boolean).join('\n\n')
  printSaga(script)
})

$.when('click', '[data-sb-save]', () => {
  const { messages } = $.learn()
  const toQuote = (body) => (body || '').split('\n').map(l => l.trim() ? `> ${l}` : '').join('\n')
  const script = messages.map(m => {
    if (m.saga) return m.body
    if (m.author === 'unassigned') return m.body
    if (m.tty || m.system) return m.body
    if (m.author === 'human') return `@ Me\n${toQuote(m.body)}`
    return `@ ${m.actor || 'Sagas'}\n${toQuote(m.body)}`
  }).filter(Boolean).join('\n\n')
  const blob = new Blob([script], { type: 'text/plain' })
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = `session-${Date.now()}.saga`
  a.click()
})

$.when('click', '[data-sb-share]', async () => {
  const url = location.href
  if (navigator.share) {
    await navigator.share({ url }).catch(() => {})
  } else {
    await navigator.clipboard.writeText(url).catch(() => {})
  }
})

$.when('click', '[data-sb-load]', () => {
  const input = document.createElement('input')
  input.type = 'file'
  input.accept = '.saga,.txt'
  input.onchange = async () => {
    const file = input.files[0]
    if (!file) return
    const text = await file.text()
    $.teach({ messages: [{ body: text, author: 'unassigned', saga: true, id: Date.now() }], sidebarOpen: false })
  }
  input.click()
})
