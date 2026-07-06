import { Self, Saga } from '@plan98/types'
import IntlMessageFormat from 'intl-messageformat'
import { showModal, hideModal } from '@plan98/modal'
import $paperPocket, { sideEffects, systemMenu, getTheme, afterUpdateTheme } from './paper-pocket.js'
import { get as wasGet, put, del as wasDel, ensureSpace } from './plan98-wallet.js'
import {
  loadSession, saveSession, deleteSession,
  listSessions, upsertManifest, removeFromManifest,
  messagesToSaga, scheduleFlush, getSaga, putSaga,
  subscribeSession, subscribeSaga,
} from './my-sagas.js'
import Vosk from 'vosk-browser'
import { agent } from './clownbot-agent.js'
import { getEnv } from './plan98-env.js'
import { callTool as elfCallTool } from './elf-tools.js'
import { checkPhysicalButton } from './debug-gamepads.js'

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

// ── WAS persistence (via my-sagas) ───────────────────────────────────────────

const _urlParams = new URLSearchParams(location.search)
let _shellSessionId = _urlParams.get('id') || 'default'
// Optional override: when embedded in another elf that owns a different WAS path
const _overrideSagaPath = _urlParams.get('saga-path') || null

let _gamepadRaf = null
const _prevPhysGpad = {}
const _gpadButtons = { a:0, b:1, x:3, y:2, lb:4, rb:5, lt:6, rt:7, select:8, start:9, ls:10, rs:11, up:12, down:13, left:14, right:15, os:16 }

function newSession() {
  _unsubscribeSaga?.()
  _unsubscribeSession?.()
  _unsubscribeSaga = null
  _unsubscribeSession = null
  _shellSessionId = crypto.randomUUID()
  window.history.replaceState(null, '', `?id=${_shellSessionId}`)
}

async function switchSession(id) {
  _unsubscribeSaga?.()
  _unsubscribeSession?.()
  _shellSessionId = id
  window.history.replaceState(null, '', `?id=${id}`)
  $.teach({ messages: [], history: [], historyCursor: null, sidebarOpen: false, exportOpen: false })
  const hadHistory = await wasLoad()
  if (!hadHistory) showPreroll()
}

function wasSave() {
  const { messages, history } = $.learn()
  if (!messages.length) return
  scheduleFlush(_shellSessionId, { messages, history })
  if (_overrideSagaPath) {
    const sagaText = messagesToSaga(messages)
    ensureSpace().catch(() => null).then(() => {
      put(_overrideSagaPath, sagaText, { type: 'text/plain' }).catch(() => null)
      fetch(`/sync${_overrideSagaPath}`, {
        method: 'PUT',
        headers: { 'content-type': 'text/plain', 'Version': `"${Date.now()}"` },
        body: sagaText,
      }).catch(() => null)
    })
  }
}

let _unsubscribeSaga = null
let _unsubscribeSession = null

function writeToTab(tabId, updates) {
  const { activeTabId, tabSnapshots } = $.learn()
  if (tabId === activeTabId) {
    $.teach(updates)
  } else {
    const snap = tabSnapshots[tabId] || { messages: [], history: [], agentLogs: [], previewUrl: '/app/bulletin-board' }
    $.teach({ tabSnapshots: { ...tabSnapshots, [tabId]: { ...snap, ...updates } } })
  }
}

function makeApplySaga(tabId) {
  return function(text) {
    if (!text || !text.trim()) return
    const { activeTabId, tabSnapshots, messages } = $.learn()
    const src = tabId === activeTabId ? messages : (tabSnapshots[tabId]?.messages || [])
    const sagaIdx = src.findIndex(m => m.author === 'unassigned' && m.saga)
    if (sagaIdx !== -1) {
      const updated = [...src]
      updated[sagaIdx] = { ...updated[sagaIdx], body: text }
      writeToTab(tabId, { messages: updated })
    } else if (!src.some(m => m.author === 'human')) {
      writeToTab(tabId, { messages: [{ body: text, author: 'unassigned', saga: true, id: Date.now() }] })
    }
  }
}

async function wasLoad() {
  _unsubscribeSaga?.()
  _unsubscribeSession?.()
  const myTabId = $.learn().activeTabId

  if (_overrideSagaPath) {
    await ensureSpace().catch(() => null)
    let text = ''
    try {
      const blob = await wasGet(_overrideSagaPath)
      text = blob ? await blob.text() : ''
    } catch {}
    if (text && text.trim()) {
      writeToTab(myTabId, { messages: [{ body: text, author: 'unassigned', saga: true, id: Date.now() }] })
    }
    const es = new EventSource(`/sync${_overrideSagaPath}`)
    es.onmessage = e => { if (e.data) makeApplySaga(myTabId)(e.data) }
    es.onerror = () => {}
    _unsubscribeSaga = () => es.close()
    return !!(text && text.trim())
  }

  const session = await loadSession(_shellSessionId)
  if (session) {
    writeToTab(myTabId, { messages: session.messages, history: session.history })
    _unsubscribeSession = subscribeSession(_shellSessionId, s => {
      writeToTab(myTabId, { messages: s.messages, history: s.history })
    })
    return true
  }

  const text = await getSaga(_shellSessionId)
  if (text && text.trim()) {
    writeToTab(myTabId, { messages: [{ body: text, author: 'unassigned', saga: true, id: Date.now() }] })
  }
  _unsubscribeSaga = subscribeSaga(_shellSessionId, makeApplySaga(myTabId))
  return !!(text && text.trim())
}

async function loadBoardCards() {
  try {
    const blob = await wasGet('/bulletin-board/default.json')
    if (!blob) return
    const data = JSON.parse(await blob.text())
    const boardCards = Object.entries(data.cards || {}).map(([id, c]) => ({
      id,
      label: (c.text || '').trim().split('\n')[0].slice(0, 40) || id.slice(0, 8),
    }))
    $.teach({ boardCards })
  } catch {}
}

// tty websocket
let ttySocket = null
let ttyBuffer = ''
let ttyFlushTimer = null
let ttyLastSent = null   // track last sent command to strip echo

const WORKSPACES_PATH = '/my-sagas/workspaces.json'

// ui audio
let _audioCtx = null
function _getAudioCtx() {
  if (!_audioCtx) _audioCtx = new AudioContext()
  return _audioCtx
}
function _audioFactory(url) {
  let buffer = null
  fetch(url).then(r => r.arrayBuffer()).then(ab => _getAudioCtx().decodeAudioData(ab)).then(b => { buffer = b }).catch(() => {})
  return function play() {
    if (!buffer) return
    const ctx = _getAudioCtx()
    if (ctx.state === 'suspended') ctx.resume()
    const src = ctx.createBufferSource()
    src.buffer = buffer
    src.connect(ctx.destination)
    src.start(0)
  }
}
const playA = _audioFactory('/cdn/sillyz.computer/beat-tape-extractor/output/a.mp3')
const playB = _audioFactory('/cdn/sillyz.computer/beat-tape-extractor/output/b.mp3')

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
  sessions: [],
  boardCards: [],
  exportOpen: false,
  metaSession: null,
  humanPrompt: null,
  previewUrl: '/app/bulletin-board',
  previewOpen: false,
  tabs: [{ id: 'default', label: 'Chat' }],
  activeTabId: 'default',
  tabSnapshots: {},
  tabLive: {},
  logsOpen: false,
  agentLogs: [],
  availableModels: ['silly'],
  selectedModel: 'silly',
  workspaces: [{ id: 'ws-default', label: 'Workspace 1', updatedAt: 0, tabs: [{ id: 'default', label: 'Chat' }], tabSnapshots: {}, activeTabId: 'default', messages: [], history: [], agentLogs: [], previewUrl: '/app/bulletin-board' }],
  activeWorkspaceId: 'ws-default',
  sessionsCursor: { section: 'workspaces', wsIdx: 0, listIdx: 0 },
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


const _humanCallbacks = {}

function humanRPC(request, tabId) {
  const id = crypto.randomUUID()
  const tid = tabId || tabIdForWrite()
  pushLog({ kind: 'rpc', text: (request.action || 'permission') + (request.description ? ': ' + request.description : '') }, tid)
  return new Promise((resolve, reject) => {
    _humanCallbacks[id] = { resolve, reject }
    $.teach({ humanPrompt: { id, tabId: tid, ...request } })
  })
}

function humanRPCRespond(id, yes) {
  const cb = _humanCallbacks[id]
  if (!cb) return
  delete _humanCallbacks[id]
  $.teach({ humanPrompt: null })
  pushLog({ kind: 'rpc-response', text: yes ? 'approved' : 'declined' })
  if (yes) cb.resolve(true)
  else cb.reject(Object.assign(new Error('Declined.'), { declined: true }))
}

// tracks which tab's agent is currently running — set at start of agentChat, cleared in finally

function tabIdForWrite() {
  const { activeTabId } = $.learn()
  return activeTabId
}

function teachLive(updates, tabId) {
  const id = tabId || $.learn().activeTabId
  const { tabLive } = $.learn()
  $.teach({ tabLive: { ...tabLive, [id]: { ...(tabLive[id] || {}), ...updates } } })
}

function pushLog(entry, tabId) {
  const id = tabId || tabIdForWrite()
  const { activeTabId, agentLogs, tabSnapshots } = $.learn()
  const log = { ...entry, ts: Date.now() }
  if (id === activeTabId) {
    $.teach({ agentLogs: [...agentLogs, log] })
  } else {
    const snap = tabSnapshots[id] || { messages: [], history: [], agentLogs: [], previewUrl: '/app/bulletin-board' }
    $.teach({ tabSnapshots: { ...tabSnapshots, [id]: { ...snap, agentLogs: [...(snap.agentLogs || []), log] } } })
  }
}

// any subsystem can dispatch plan98-log to surface into the panel
window.addEventListener('plan98-log', (e) => {
  pushLog({ kind: e.detail.kind || 'system', text: e.detail.text || String(e.detail) })
})

function addMessage(payload, tabId) {
  const id = tabId || tabIdForWrite()
  const { activeTabId, tabSnapshots, messages } = $.learn()
  if (id === activeTabId) {
    $.teach({ messages: [...messages, payload] })
  } else {
    const snap = tabSnapshots[id] || { messages: [], history: [], agentLogs: [], previewUrl: '/app/bulletin-board' }
    $.teach({ tabSnapshots: { ...tabSnapshots, [id]: { ...snap, messages: [...snap.messages, payload] } } })
  }
  wasSave()
}

function pushHistory(message) {
  const { history } = $.learn()
  $.teach({ history: [...history, message] })
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
  teachLive({ thinkingFace: response })
}

function done(response) {
  teachLive({ thinkingFace: null, thinking: false })
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
    teachLive({ thinking: true })
    const message = await agent(program, {
      partial: (text) => teachLive({ thinkingFace: text }),
      done: () => teachLive({ thinkingFace: null }),
    })
    teachLive({ thinking: false })
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

const shellToolDefinitions = [
  {
    type: 'function',
    function: {
      name: 'shell',
      description: 'Run a shell command and return its output. Available commands: git (clone/pull/fetch/log/ls-files/ls/cat/grep/show/status), ls [path], pwd, cd <path>, help.',
      parameters: { type: 'object', properties: { command: { type: 'string', description: 'Full command string, e.g. "git log --oneline" or "ls /blog"' } }, required: ['command'] },
    }
  },
  {
    type: 'function',
    function: {
      name: 'read_file',
      description: 'Read a file from the server and return its contents.',
      parameters: { type: 'object', properties: { path: { type: 'string', description: 'File path, e.g. /elves/my-computer.js' } }, required: ['path'] },
    }
  },
  {
    type: 'function',
    function: {
      name: 'write_file',
      description: 'Write content to a file on the server (persists to disk).',
      parameters: { type: 'object', properties: { path: { type: 'string' }, content: { type: 'string' } }, required: ['path', 'content'] },
    }
  },
  {
    type: 'function',
    function: {
      name: 'patch_file',
      description: 'Find and replace text in a file on the server.',
      parameters: { type: 'object', properties: { path: { type: 'string' }, find: { type: 'string' }, replace: { type: 'string' } }, required: ['path', 'find', 'replace'] },
    }
  },
  {
    type: 'function',
    function: {
      name: 'list_files',
      description: 'List files in a directory using the file manifest.',
      parameters: { type: 'object', properties: { dir: { type: 'string', description: 'Directory path, use "/" for all' } }, required: ['dir'] },
    }
  },
  {
    type: 'function',
    function: {
      name: 'set_preview',
      description: 'Open the preview panel to show a URL in an iframe. Call this after editing a file so the user can see the live result. Do not ask for permission — just call it.',
      parameters: { type: 'object', properties: { url: { type: 'string', description: 'URL to preview, e.g. /app/pot-luck' } }, required: ['url'] },
    }
  },
  {
    type: 'function',
    function: {
      name: 'web_search',
      description: 'Search the web for current, real-time information — weather, news, prices, anything that changes after your training cutoff or that you are not certain about. Use this whenever the user asks about live/current conditions instead of guessing.',
      parameters: { type: 'object', properties: { query: { type: 'string', description: 'The search query, e.g. "weather in San Francisco right now"' } }, required: ['query'] },
    }
  },
]

async function callToolGated(name, args, tabId) {
  if (name === 'set_preview') {
    const ts = Date.now()
    const url = args.url.includes('?') ? `${args.url}&_v=${ts}` : `${args.url}?_v=${ts}`
    $.teach({ previewUrl: url, previewOpen: true })
    return { ok: true }
  }
  if (name === 'web_search') {
    // `features: { web_search: true }` on /chat/completions turned out to be
    // silently ignored on this OpenWebUI's plain OpenAI-compatible passthrough
    // — confirmed empirically (direct curl test came back ungrounded). The
    // mechanism that actually works is OpenWebUI's own retrieval endpoint,
    // which runs the admin-configured search engine (searxng here) directly
    // and hands back real results — no chat completion involved at all.
    const apiUrl = getEnv('ACCESSIBILITY_MODE_LOCK') || getEnv('FALLBACK_LLM_URL') || getEnv('OLLAMA_HOST') || ''
    const apiKey = getEnv('ACCESSIBILITY_MODE_KEY') || getEnv('FALLBACK_LLM_KEY') || getEnv('OLLAMA_KEY') || 'ollama'
    if (!apiUrl) return { error: 'no AI endpoint configured for web_search' }
    try {
      const res = await fetch(apiUrl + '/v1/retrieval/process/web/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
        body: JSON.stringify({ queries: [args.query] }),
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        return { error: err.detail?.[0]?.msg || err.error?.message || `web_search request failed: ${res.status}` }
      }
      const data = await res.json()
      const items = data.items || []
      if (!items.length) return { error: 'web_search returned no results — is a search engine configured in OpenWebUI\'s admin settings?' }
      return { results: items.map(i => ({ title: i.title, url: i.link, snippet: i.snippet })) }
    } catch (e) {
      return { error: e.message }
    }
  }
  const desc = Object.entries(args).map(([k, v]) => `${k}: ${String(v).slice(0, 100)}`).join(' | ')
  await humanRPC({ action: name, description: desc }, tabId)
  if (name === 'shell') {
    const parts = args.command.trim().split(/\s+/)
    const [cmd, ...rest] = parts
    const program = commands[cmd] || commands[cmd?.toLowerCase()]
    if (!program) return { error: `unknown command: ${cmd}` }
    const result = await program.apply($, rest)
    if (!result) return { ok: true }
    return { output: typeof result === 'object' ? result.body : result }
  }
  return elfCallTool(name, args)
}

const _tabAborts = {}  // per-tab abort controllers — one in-flight request per tab max

async function loadModels() {
  const apiUrl = getEnv('ACCESSIBILITY_MODE_LOCK') || getEnv('FALLBACK_LLM_URL') || getEnv('OLLAMA_HOST') || ''
  const apiKey = getEnv('ACCESSIBILITY_MODE_KEY') || getEnv('FALLBACK_LLM_KEY') || getEnv('OLLAMA_KEY') || 'ollama'
  const envModel = getEnv('ACCESSIBILITY_MODE_DEFAULT_MODEL') || getEnv('FALLBACK_LLM_MODEL') || getEnv('OLLAMA_MODEL') || ''
  if (!apiUrl) return
  try {
    const res = await fetch(apiUrl + '/models', { headers: { 'Authorization': `Bearer ${apiKey}` } })
    if (!res.ok) return
    const data = await res.json()
    const ids = (data.data || data.models || []).map(m => m.id || m.name).filter(Boolean)
    if (!ids.length) return
    const models = ['silly', ...ids]
    const current = $.learn().selectedModel
    const selected = current !== 'silly' ? current : (envModel && ids.includes(envModel) ? envModel : 'silly')
    $.teach({ availableModels: models, selectedModel: selected })
  } catch { /* silent — server may not be running */ }
}

async function agentChat(userMessage) {
  const { selectedModel, activeTabId } = $.learn()
  const myTabId = activeTabId  // closed over — concurrent calls each track their own tab

  if (selectedModel === 'silly') {
    addMessage({ body: 'silly — no AI active. select a model above to enable the agent.', author: 'assistant', system: true }, myTabId)
    return
  }

  // accessibility-mode has its own dedicated config — the LOCK is the endpoint,
  // the KEY fits it. Falls back to the shared FALLBACK_LLM / OLLAMA chain.
  // All read live via getEnv so end-user overrides (plan98-env) take effect.
  const apiUrl = getEnv('ACCESSIBILITY_MODE_LOCK') || getEnv('FALLBACK_LLM_URL') || getEnv('OLLAMA_HOST') || ''
  const apiKey = getEnv('ACCESSIBILITY_MODE_KEY') || getEnv('FALLBACK_LLM_KEY') || getEnv('OLLAMA_KEY') || 'ollama'
  const model = selectedModel
  if (!apiUrl) return addMessage({ body: 'no AI configured — set ACCESSIBILITY_MODE_LOCK (url) + ACCESSIBILITY_MODE_KEY, or open plan98-env to set one live', author: 'assistant', system: true }, myTabId)

  if (_tabAborts[myTabId]) _tabAborts[myTabId].abort()
  const _abort = new AbortController()
  _tabAborts[myTabId] = _abort
  let _thinkingRaf = null
  function flushThinking(text) {
    if (_thinkingRaf) return
    _thinkingRaf = requestAnimationFrame(() => {
      _thinkingRaf = null
      teachLive({ thinkingFace: text }, myTabId)
    })
  }
  const { agentLogs: prevLogs } = $.learn()
  teachLive({ thinking: true }, myTabId)
  $.teach({ agentLogs: [...prevLogs, { kind: 'session', text: userMessage, ts: Date.now() }] })

  const { messages: history } = $.learn()
  const historyMessages = history
    .filter(m => (m.author === 'human' || m.author === 'assistant') && m.body && !m.system && !m.tty && !m.saga)
    .slice(-30)
    .map(m => ({ role: m.author === 'human' ? 'user' : 'assistant', content: m.body }))

  const messages = [
    { role: 'system', content: `You are clownbot, an AI agent that lives in a browser shell called plan1. You have tools and you USE them — you never tell the user to edit files themselves.

CORE SKILL — request → edit → preview:
1. read_file the relevant file to see the EXACT current text
2. patch_file to make the change — the find argument must be EXACT TEXT copied from the file, not a description
3. set_preview with the /app/<elf-name> URL so the user sees the live result
4. Say "try it now" as your final line — ONLY after a SUCCESSFUL patch_file or write_file

CRITICAL RULES:
- "try it now" must NEVER appear unless the previous tool call was a SUCCESSFUL patch_file or write_file
- If read_file shows the text already matches what was requested: say "I see X in the file already — did you mean something else?" — do NOT say "try it now"
- The find argument must be EXACT TEXT from the file — not the user's words, not a description. If you can't find the right string, read the file again and quote it precisely
- Button/label text should be SHORT — if user says "make it say Back", insert "Back", not their full sentence
- If the user says "still nothing": do NOT give up — read the file again, check what's there, patch the right string
- Never say "I can't edit files" — you have patch_file and write_file, use them
- Never describe edits for the user to make manually — just call the tool
- Never ask "shall I proceed?" — just call the tool
- Elves live at /elves/<name>.js — e.g. pot-luck is at /elves/pot-luck.js (NOT /public/elves/)
- If a tool returns 401: tell user to type "admin" in the shell to authenticate, then retry
- For questions about current/live information (weather, news, prices, anything that could have changed since training) call web_search — never guess or say you don't have real-time access` },
    ...historyMessages,
  ]

  try {
    while (true) {
      const resp = await fetch(apiUrl + '/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
        body: JSON.stringify({ model, messages, stream: true, tools: shellToolDefinitions }),
        signal: _abort.signal,
      })
      if (!resp.ok) {
        const err = await resp.json().catch(() => ({}))
        throw new Error(err.error?.message || `API error: ${resp.status}`)
      }

      let accumulated = ''
      const toolCallAcc = {}
      const reader = resp.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''

      stream: while (true) {
        const { done, value } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')
        buffer = lines.pop()
        for (const line of lines) {
          if (!line.startsWith('data: ')) continue
          const data = line.slice(6).trim()
          if (data === '[DONE]') break stream
          let chunk
          try { chunk = JSON.parse(data) } catch { continue }
          const delta = chunk.choices?.[0]?.delta
          if (!delta) continue
          if (delta.content) {
            accumulated += delta.content
            flushThinking(accumulated)
          }
          if (delta.tool_calls) {
            for (const tc of delta.tool_calls) {
              const i = tc.index ?? 0
              if (!toolCallAcc[i]) toolCallAcc[i] = { id: '', type: 'function', function: { name: '', arguments: '' } }
              if (tc.id) toolCallAcc[i].id = tc.id
              if (tc.function?.name) toolCallAcc[i].function.name += tc.function.name
              if (tc.function?.arguments) toolCallAcc[i].function.arguments += tc.function.arguments
            }
          }
        }
      }

      let toolCalls = Object.values(toolCallAcc)

      // fallback: model emitted tool call as text instead of structured delta
      if (!toolCalls.length && accumulated.trim().startsWith('{')) {
        try {
          const parsed = JSON.parse(accumulated.trim())
          if (parsed.name && parsed.arguments) {
            toolCalls = [{ id: crypto.randomUUID(), type: 'function', function: { name: parsed.name, arguments: JSON.stringify(parsed.arguments) } }]
            accumulated = ''
          }
        } catch { /* not a tool call, render as text */ }
      }

      if (!toolCalls.length) {
        teachLive({ thinking: false, thinkingFace: null }, myTabId)
        addMessage({ body: accumulated || '(no response)', author: 'assistant' }, myTabId)
        return
      }

      if (accumulated) addMessage({ body: accumulated, author: 'assistant' }, myTabId)
      teachLive({ thinkingFace: null }, myTabId)
      messages.push({ role: 'assistant', content: accumulated || null, tool_calls: toolCalls })

      for (const tc of toolCalls) {
        let args = {}
        try { args = JSON.parse(tc.function.arguments) } catch {}

        const logText = tc.function.name + ' ' + JSON.stringify(args)
        pushLog({ kind: 'tool', text: logText }, myTabId)

        try {
          const result = await callToolGated(tc.function.name, args, myTabId)
          messages.push({ role: 'tool', tool_call_id: tc.id, content: JSON.stringify(result) })
          const isError = result && result.error
          pushLog({ kind: isError ? 'error' : 'result', text: JSON.stringify(result) }, myTabId)
        } catch (e) {
          if (e.declined) {
            pushLog({ kind: 'rpc-response', text: 'declined' }, myTabId)
            teachLive({ thinking: false, thinkingFace: null }, myTabId)
            addMessage({ body: 'declined.', author: 'assistant', system: true }, myTabId)
            return
          }
          pushLog({ kind: 'error', text: e.message }, myTabId)
          messages.push({ role: 'tool', tool_call_id: tc.id, content: JSON.stringify({ error: e.message }) })
        }
      }
    }
  } catch (e) {
    teachLive({ thinking: false, thinkingFace: null }, myTabId)
    if (e.name !== 'AbortError') {
      addMessage({ body: `agent error: ${e.message}`, author: 'assistant', system: true }, myTabId)
    }
  } finally {
    if (_tabAborts[myTabId] === _abort) delete _tabAborts[myTabId]
  }
}

const GIT_REMOTE = 'https://tangled.org/clowncode.bsky.social/plan1'
const GIT_DIR = '/plan1'
let _gitLib, _gitFS, _gitPFS

async function getGit() {
  if (_gitLib) return { git: _gitLib, fs: _gitFS, pfs: _gitPFS }
  const [{ default: git }, { default: FS }] = await Promise.all([
    import('isomorphic-git'),
    import('@isomorphic-git/lightning-fs'),
  ])
  _gitFS = new FS('git-elf')
  _gitPFS = _gitFS.promises
  _gitLib = git
  return { git, fs: _gitFS, pfs: _gitPFS }
}

const gitHttp = {
  async request({ url, method, headers, body }) {
    let reqBody
    if (body) {
      const chunks = []
      for await (const chunk of body) chunks.push(chunk)
      const len = chunks.reduce((n, c) => n + c.length, 0)
      const buf = new Uint8Array(len)
      let off = 0
      for (const c of chunks) { buf.set(c, off); off += c.length }
      reqBody = buf
    }
    const resp = await fetch(`/api/git-proxy?url=${encodeURIComponent(url)}`, { method, headers, body: reqBody })
    return {
      url: resp.url, method,
      headers: Object.fromEntries(resp.headers),
      body: [new Uint8Array(await resp.arrayBuffer())],
      statusCode: resp.status,
      statusMessage: resp.statusText,
    }
  }
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
    const id = _shellSessionId
    $.teach({ messages: [], history: [], historyCursor: null })
    deleteSession(id).catch(() => null)
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

  'preview': function(url) {
    if (!url) {
      $.teach({ previewOpen: !$.learn().previewOpen })
      return null
    }
    const ts = Date.now()
    const fullUrl = url.includes('?') ? `${url}&_v=${ts}` : `${url}?_v=${ts}`
    $.teach({ previewUrl: fullUrl, previewOpen: true })
    return { body: `preview: ${url}`, system: true }
  },

  'git': async function(...args) {
    const [sub, ...rest] = args
    const { git, fs, pfs } = await getGit()

    if (!sub || sub === 'help') {
      return { saga: true, body: `@ git

# clone
<code
text: git clone

> clone plan1 from tangled (depth 1)

# read
<code
text: git log --oneline

<code
text: git ls-files

<code
text: git grep pattern

<code
text: git cat path/to/file

<code
text: git show HEAD:path/to/file

> update with: git pull` }
    }

    if (sub === 'clone') {
      await humanRPC({ action: 'git clone', description: `clone ${GIT_REMOTE} into local IndexedDB` })
      const lines = [`cloning ${GIT_REMOTE} → ${GIT_DIR} (depth 1)...`]
      await git.clone({
        fs, http: gitHttp, dir: GIT_DIR, url: GIT_REMOTE,
        depth: 1, singleBranch: true,
        onProgress: e => { if (e.phase !== lines[lines.length - 1]?.trim()) lines.push(`  ${e.phase}`) },
      })
      lines.push('done')
      return { body: lines.join('\n'), system: true }
    }

    if (sub === 'pull') {
      await humanRPC({ action: 'git pull', description: `pull latest from ${GIT_REMOTE}` })
      await git.pull({ fs, http: gitHttp, dir: GIT_DIR, author: { name: 'git-elf', email: 'elf@plan98' } })
      return { body: 'pulled', system: true }
    }

    if (sub === 'fetch') {
      await git.fetch({ fs, http: gitHttp, dir: GIT_DIR, depth: 1 })
      return { body: 'fetched', system: true }
    }

    if (sub === 'log') {
      const n = parseInt((rest.find(a => /^-n\d+$/.test(a)) || '-n20').slice(2)) || 20
      const oneline = rest.includes('--oneline')
      const commits = await git.log({ fs, dir: GIT_DIR, depth: n })
      const body = commits.map(({ oid, commit }) =>
        oneline
          ? `${oid.slice(0, 7)} ${commit.message.split('\n')[0]}`
          : `commit ${oid}\n    ${commit.message.split('\n')[0]}`
      ).join('\n')
      return { body, system: true }
    }

    if (sub === 'ls-files') {
      const files = await git.listFiles({ fs, dir: GIT_DIR })
      return { body: files.join('\n'), system: true }
    }

    if (sub === 'ls') {
      const p = rest[0] ? `${GIT_DIR}/${rest[0]}` : GIT_DIR
      const entries = await pfs.readdir(p)
      return { body: entries.join('  '), system: true }
    }

    if (sub === 'cat') {
      if (!rest[0]) return { body: 'usage: git cat <path>', system: true }
      const body = await pfs.readFile(`${GIT_DIR}/${rest[0]}`, 'utf8')
      return { body, system: true }
    }

    if (sub === 'grep') {
      if (!rest[0]) return { body: 'usage: git grep <pattern>', system: true }
      const re = new RegExp(rest[0], 'i')
      const files = await git.listFiles({ fs, dir: GIT_DIR })
      const hits = []
      for (const f of files) {
        try {
          const txt = await pfs.readFile(`${GIT_DIR}/${f}`, 'utf8')
          txt.split('\n').forEach((line, i) => {
            if (re.test(line)) hits.push(`${f}:${i + 1}: ${line}`)
          })
        } catch { /* binary */ }
      }
      return { body: hits.length ? hits.join('\n') : 'no matches', system: true }
    }

    if (sub === 'show') {
      const ref = rest[0]
      if (!ref) return { body: 'usage: git show <ref>:<path>', system: true }
      const colon = ref.indexOf(':')
      if (colon === -1) {
        const commit = await git.readCommit({ fs, dir: GIT_DIR, oid: ref })
        return { body: JSON.stringify(commit, null, 2), system: true }
      }
      const refName = ref.slice(0, colon) || 'HEAD'
      const filepath = ref.slice(colon + 1)
      const oid = await git.resolveRef({ fs, dir: GIT_DIR, ref: refName })
      const { blob } = await git.readBlob({ fs, dir: GIT_DIR, oid, filepath })
      return { body: new TextDecoder().decode(blob), system: true }
    }

    if (sub === 'status') {
      const matrix = await git.statusMatrix({ fs, dir: GIT_DIR })
      const dirty = matrix.filter(([, h, w, s]) => h !== 1 || w !== 1 || s !== 1)
      return { body: dirty.length ? dirty.map(([f, h, w, s]) => `${f}  ${h}${w}${s}`).join('\n') : 'clean', system: true }
    }

    return { body: `unknown git subcommand: ${sub} — try git help`, system: true }
  },
}



function showPreroll() {
  const now = Date.now()
  $.teach({ messages: [
    { body: '${brand} is a creative suite for ${demographic} for', author: 'unassigned', id: now },
    { body: '<code\ntext: art\n\n<code\ntext: music\n\n<code\ntext: coding', author: 'unassigned', saga: true, id: now + 1 },
    { body: `@ Sagas\n> ${fmt('sagas.intro')}`, author: 'assistant', saga: true, id: now + 2 },
  ]})
}

// ── Gamepad loop ─────────────────────────────────────────────────────────────

function gamepadLoop() {
  const p = {}
  const r = {}
  for (const name of Object.keys(_gpadButtons)) {
    const val = checkPhysicalButton(0, _gpadButtons[name]) || 0
    const prev = _prevPhysGpad[name] || 0
    _prevPhysGpad[name] = val
    p[name] = val > 0.5 && prev <= 0.5
    r[name] = val <= 0.5 && prev > 0.5
  }

  const { previewOpen, tabs, activeTabId, availableModels, selectedModel, humanPrompt } = $.learn()
  const activePrompt = humanPrompt?.tabId === activeTabId ? humanPrompt : null

  if (activePrompt) {
    if (p['a']) humanRPCRespond(activePrompt.id, true)
    if (p['b']) humanRPCRespond(activePrompt.id, false)
  } else if (activeTabId !== 'sessions') {
    if (p['a']) { const text = $.learn().messageText; if (text.trim()) { playA(); execute(text) } else { playB() } }
    if (p['b']) { playB(); $.teach({ messageText: '' }) }
  }
  if (p['x']) { playA(); $.teach({ previewOpen: !previewOpen }) }
  if (p['y']) {
    playA()
    const idx = availableModels.indexOf(selectedModel)
    $.teach({ selectedModel: availableModels[(idx + 1) % availableModels.length] })
  }
  if (p['start']) {
    playA()
    $.teach({ tabSnapshots: snapshotCurrentTab() })
    listSessions().then(sessions => $.teach({ sessions, activeTabId: 'sessions' }))
  }
  if (p['select']) {
    playA()
    startVosk()
  }
  if (r['select']) {
    stopVosk()
    const { messageText } = $.learn()
    if (messageText.trim()) { playA(); execute(messageText) } else { playB() }
  }
  if (p['lb']) {
    const idx = tabs.findIndex(t => t.id === activeTabId)
    if (idx > 0) { playA(); const s = snapshotCurrentTab(); restoreTab(tabs[idx - 1].id, s) } else { playB() }
  }
  if (p['rb']) {
    const idx = tabs.findIndex(t => t.id === activeTabId)
    if (idx !== -1 && idx < tabs.length - 1) { playA(); const s = snapshotCurrentTab(); restoreTab(tabs[idx + 1].id, s) } else { playB() }
  }
  if (p['lt']) { if (tabs.length) { playA(); const s = snapshotCurrentTab(); restoreTab(tabs[0].id, s) } }
  if (p['rt']) { if (tabs.length) { playA(); const s = snapshotCurrentTab(); restoreTab(tabs[tabs.length - 1].id, s) } }

  if (activeTabId === 'sessions') {
    const { sessions, workspaces, sagaFilter, sessionsCursor } = $.learn()
    const filtered = sagaFilter ? sessions.filter(s => (s.title || s.id).toLowerCase().includes(sagaFilter.toLowerCase())) : sessions
    const sortedWs = [...(workspaces || [])].sort((a, b) => b.updatedAt - a.updatedAt)
    const wsCount = 1 + sortedWs.length // 0 = new-workspace btn, 1+ = workspace buttons
    const cur = sessionsCursor || { section: 'workspaces', wsIdx: 0, listIdx: 0 }

    if (p['up']) {
      if (cur.section === 'newchat') {
        playA(); $.teach({ sessionsCursor: { ...cur, section: 'workspaces' } })
      } else if (cur.section === 'list') {
        if (cur.listIdx > 0) { playA(); $.teach({ sessionsCursor: { ...cur, listIdx: cur.listIdx - 1 } }) }
        else { playB(); $.teach({ sessionsCursor: { ...cur, section: 'newchat' } }) }
      } else { playB() }
    }
    if (p['down']) {
      if (cur.section === 'workspaces') {
        playA(); $.teach({ sessionsCursor: { ...cur, section: 'newchat' } })
      } else if (cur.section === 'newchat') {
        if (filtered.length) { playA(); $.teach({ sessionsCursor: { ...cur, section: 'list', listIdx: 0 } }) }
        else { playB() }
      } else if (cur.section === 'list') {
        if (cur.listIdx < filtered.length - 1) { playA(); $.teach({ sessionsCursor: { ...cur, listIdx: cur.listIdx + 1 } }) }
        else { playB() }
      }
    }
    if (p['left']) {
      if (cur.section === 'workspaces') {
        if (cur.wsIdx > 0) { playA(); $.teach({ sessionsCursor: { ...cur, wsIdx: cur.wsIdx - 1 } }) } else { playB() }
      } else if (cur.section === 'list' && filtered.length) {
        // left = demote to bottom
        playA()
        const sess = filtered[cur.listIdx]
        const rest = sessions.filter(s => s.id !== sess.id)
        $.teach({ sessions: [...rest, sess], sessionsCursor: { ...cur, listIdx: Math.min(cur.listIdx, filtered.length - 1) } })
      }
    }
    if (p['right']) {
      if (cur.section === 'workspaces') {
        if (cur.wsIdx < wsCount - 1) { playA(); $.teach({ sessionsCursor: { ...cur, wsIdx: cur.wsIdx + 1 } }) } else { playB() }
      } else if (cur.section === 'list' && filtered.length) {
        // right = promote to top
        playA()
        const sess = filtered[cur.listIdx]
        const rest = sessions.filter(s => s.id !== sess.id)
        $.teach({ sessions: [sess, ...rest], sessionsCursor: { ...cur, listIdx: Math.min(cur.listIdx, filtered.length - 1) } })
      }
    }
    if (p['a']) {
      playA()
      if (cur.section === 'workspaces') {
        if (cur.wsIdx === 0) {
          newWorkspace()
        } else {
          const w = sortedWs[cur.wsIdx - 1]
          if (w) switchWorkspace(w.id)
        }
      } else if (cur.section === 'newchat') {
        $.teach({ tabSnapshots: snapshotCurrentTab() })
        const freshTab = { id: crypto.randomUUID(), label: 'Chat' }
        $.teach({ tabs: [...$.learn().tabs, freshTab] })
        restoreTab(freshTab.id, $.learn().tabSnapshots)
        newSession()
        showPreroll()
      } else if (cur.section === 'list') {
        const sess = filtered[cur.listIdx]
        if (sess) switchSession(sess.id)
      }
    }
    if (p['b']) {
      playB()
      const firstTab = $.learn().tabs[0]
      if (firstTab) restoreTab(firstTab.id, snapshotCurrentTab())
    }
  }

  if (previewOpen) {
    const iframe = document.querySelector('.am-preview-inframe')
    if (iframe?.contentWindow) {
      for (const name of ['a', 'b', 'lb', 'rb', 'lt', 'rt']) {
        if (p[name]) iframe.contentWindow.postMessage({ type: 'gamepad-button', button: name }, '*')
      }
    }
  }

  _gamepadRaf = requestAnimationFrame(gamepadLoop)
}

function mount(target) {
  if(target.mounted) return
  target.mounted = true
  const command = target.getAttribute('command')
  const message = target.getAttribute('message')
  const src = target.getAttribute('src')
  const rom = target.getAttribute('rom')

  gamepadLoop()
  loadWorkspaces().then(() =>
    loadStrings().then(() => wasLoad()).then(hadHistory => {
      if (!hadHistory && !$.learn().messages.length) showPreroll()
      if(command) execute(command)
      else if(src) execute(src, { suppressBack: true })
      else if(rom) execute('<'+rom, { suppressBack: true })
      else if(message) sh(message)
    })
  )
  loadBoardCards()
}

function embedStub({ tag, props, innerHTML, innerText }) {
  if ('text' in props || 'html' in props) {
    const attrs = Object.entries(props)
      .filter(([k]) => k !== 'text' && k !== 'html')
      .map(([k, v]) => `${k}="${escapeHyperText(v)}"`)
      .join(' ')
    return `<${tag} ${attrs}>${innerHTML || innerText}</${tag}>`
  }
  const shorthand = `&lt;${tag}\n` + Object.entries(props).map(([k, v]) => `${k}: ${v}`).join('\n')
  return `<a class="am-embed-stub" href="javascript:;" data-embed-tag="${escapeHyperText(tag)}" data-embed-props="${escapeHyperText(JSON.stringify(props))}"><pre>${shorthand}</pre></a>`
}

function renderAgentLogs(logs, thinkingFace) {
  const fmtTime = ts => {
    if (!ts) return ''
    const d = new Date(ts)
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
  }
  const header = `
    <div class="log-header">
      <span class="log-header-title">logs (${logs.length})</span>
      <button class="log-clear-btn" data-clear-logs>clear</button>
    </div>`
  if (!logs.length && !thinkingFace) {
    return header + '<div class="log-empty">no activity yet — ask the agent to edit a file</div>'
  }
  const entries = logs.map(l => {
    const t = `<span class="log-ts">${fmtTime(l.ts)}</span>`
    if (l.kind === 'session') return `<div class="log-entry log-entry--session">${t}<span class="log-session-text">${escapeHyperText(l.text.slice(0, 80))}</span></div>`
    if (l.kind === 'tool')    return `<div class="log-entry log-entry--tool">${t}⚙ <code class="log-code">${escapeHyperText(l.text)}</code></div>`
    if (l.kind === 'result')  return `<div class="log-entry log-entry--result">${t}← <span class="log-result">${escapeHyperText(l.text)}</span></div>`
    if (l.kind === 'error')   return `<div class="log-entry log-entry--error">${t}✗ <span class="log-error">${escapeHyperText(l.text)}</span></div>`
    if (l.kind === 'rpc')     return `<div class="log-entry log-entry--rpc">${t}? <span class="log-rpc">${escapeHyperText(l.text)}</span></div>`
    if (l.kind === 'rpc-response') return `<div class="log-entry log-entry--rpc-response">${t}<span class="log-rpc-resp">${escapeHyperText(l.text)}</span></div>`
    return `<div class="log-entry log-entry--system">${t}<span class="log-system">${escapeHyperText(l.text)}</span></div>`
  }).join('')
  const live = thinkingFace
    ? `<div class="log-entry log-entry--live"><pre class="log-stream">${escapeHyperText(thinkingFace)}</pre></div>`
    : ''
  return header + entries + live
}

$.draw((target) => {
  mount(target)
  const { secureEntry, messages, messageText, messageHeight, ttyLive, ttyConnected, listening, voskLoading, sagaFilter, sessions, boardCards, exportOpen, metaSession, humanPrompt, previewUrl, previewOpen, tabs, activeTabId, tabLive, logsOpen, agentLogs, availableModels, selectedModel, workspaces, activeWorkspaceId, sessionsCursor } = $.learn()
  const { thinking = false, thinkingFace = null } = tabLive[activeTabId] || {}
  const displayMessages = messages

  const toQuote = (body) =>
    (body || '').split('\n').map(l => l.trim() ? `> ${escapeHyperText(l)}` : '').join('\n')

  const historyScript = displayMessages.map((m, i) => {
    if (m.saga) return m.body
    if (m.author === 'unassigned') return escapeHyperText(m.body)
    if (m.tty || m.system) return escapeHyperText(m.body)
    if (m.author === 'human') return `@ Me\n${toQuote(m.body)}`
    const actor = m.actor || 'Sagas'
    const prev = displayMessages[i - 1]
    const continuingSagas = prev && prev.author === 'assistant' && !prev.saga && !prev.tty && !prev.system && (prev.actor || 'Sagas') === actor
    return continuingSagas ? toQuote(m.body) : `@ ${actor}\n${toQuote(m.body)}`
  }).filter(Boolean).join('\n\n')
  const sagaHistoryHtml = historyScript ? Saga(historyScript, { actor: embedStub }) : ''

  const streamScript = (() => {
    if (!thinkingFace && !ttyLive) return null
    const text = thinkingFace || ttyLive
    if (ttyLive) return escapeHyperText(text)
    const lastMsg = displayMessages[displayMessages.length - 1]
    const continuingSagas = lastMsg && lastMsg.author === 'assistant' && !lastMsg.saga && !lastMsg.tty && !lastMsg.system
    return continuingSagas ? toQuote(text) : `@ Sagas\n${toQuote(text)}`
  })()

  const sagaHtml = sagaHistoryHtml + (streamScript ? Saga(streamScript, { actor: embedStub }) : '')

  const allSagas = [
    ...sagaDocs,
    ...sessions.map(s => ({ name: s.id, path: `/accessibility-mode/${s.id}.saga` }))
  ]
  const filteredSagas = sagaFilter
    ? allSagas.filter(s => s.name.includes(sagaFilter.toLowerCase()))
    : allSagas

  const topbar = `
      <div class="am-topbar">
        <select class="am-model-select" data-model-select>
          ${availableModels.map(m => `<option value="${escapeHyperText(m)}"${m === selectedModel ? ' selected' : ''}>${escapeHyperText(m)}</option>`).join('')}
        </select>
        <div class="am-chat-tabs">
          ${tabs.map(t => `<button class="am-chat-tab${activeTabId === t.id ? ' -active' : ''}" data-tab-drag="${escapeHyperText(t.id)}">${escapeHyperText(t.label)}</button>`).join('')}
          <button class="am-sessions-btn${activeTabId === 'sessions' ? ' -active' : ''}" data-sessions-tab title="new / open">+</button>
        </div>
        <button class="am-preview-toggle${previewOpen ? ' -active' : ''}" data-toggle-preview title="${previewOpen ? 'close preview' : 'open preview'}">⧉</button>
      </div>`

  if (metaSession) {
    const s = sessions.find(x => x.id === metaSession) || { id: metaSession }
    const fmtTs = ts => ts ? new Date(ts).toLocaleString() : '—'
    return topbar + `
      <div class="meta-screen">
        <div class="meta-screen-header">
          <button class="meta-back-btn" data-close-meta>${icon('arrow-left')} Back</button>
          <span class="meta-screen-title">Session</span>
        </div>
        <div class="meta-screen-body">
          <label class="field">
            <span class="label">Title</span>
            <input class="standard-input" type="text" name="metaTitle" placeholder="untitled" value="${escapeHyperText(s.title || '')}">
          </label>
          <label class="field">
            <span class="label">Created</span>
            <input class="standard-input" type="text" disabled value="${fmtTs(s.created)}">
          </label>
          <label class="field">
            <span class="label">Last saved</span>
            <input class="standard-input" type="text" disabled value="${fmtTs(s.updated)}">
          </label>
          <div class="meta-screen-actions">
            <button class="standard-button bias-positive" data-meta-save>Save</button>
            <button class="standard-button bias-negative" data-meta-delete="${escapeHyperText(s.id)}">Delete</button>
          </div>
        </div>
      </div>
    `
  }

  if (activeTabId === 'sessions') {
    const filtered = sagaFilter ? sessions.filter(s => (s.title || s.id).toLowerCase().includes(sagaFilter.toLowerCase())) : sessions
    const sortedWs = [...(workspaces || [])].sort((a, b) => b.updatedAt - a.updatedAt)
    const cur = sessionsCursor || { section: 'workspaces', wsIdx: 0, listIdx: 0 }
    return topbar + `
      <div class="am-sessions-view">
        <div class="am-workspace-bar">
          <button class="am-new-workspace-btn${cur.section === 'workspaces' && cur.wsIdx === 0 ? ' -gpad' : ''}" data-new-workspace>+ workspace</button>
          <div class="am-workspace-strip">
            ${sortedWs.map((w, i) => `
              <button class="am-workspace-btn${w.id === activeWorkspaceId ? ' -active' : ''}${cur.section === 'workspaces' && cur.wsIdx === i + 1 ? ' -gpad' : ''}" data-switch-workspace="${escapeHyperText(w.id)}">${escapeHyperText(w.label)}</button>
            `).join('')}
          </div>
        </div>
        <div class="am-sessions-scroll">
          <div class="am-sessions-inner">
            <button class="am-new-chat-hero${cur.section === 'newchat' ? ' -gpad' : ''}" data-new-chat>New Chat</button>
            ${filtered.length ? `
              <div class="am-sessions-list">
                ${filtered.map((s, i) => `
                  <button class="am-session-item${cur.section === 'list' && cur.listIdx === i ? ' -gpad' : ''}" data-open-session="${escapeHyperText(s.id)}">${escapeHyperText(s.title || s.id.slice(0, 8))}</button>
                `).join('')}
              </div>
            ` : '<div class="am-sessions-empty">no saved chats yet</div>'}
          </div>
        </div>
      </div>`
  }

  if (previewOpen) {
    return topbar + `<iframe src="${escapeHyperText(previewUrl || '/app/bulletin-board')}" class="am-preview-inframe"></iframe>`
  }

  const chatContent = `
      <div class="scroll-back">
        <div class="messages">
          ${logsOpen ? renderAgentLogs(agentLogs, thinkingFace) : sagaHtml}
        </div>
      </div>
      <button class="thinking-bar" data-toggle-logs title="${logsOpen ? 'back to chat' : 'view agent logs'}">
        ${thinking ? '<div class="thinking-disk"></div>' : '<span class="thinking-bar-dot">&#9673;</span>'}
        <span class="thinking-bar-label">${logsOpen ? '← chat' : thinking ? 'thinking…' : agentLogs.length ? `logs (${agentLogs.length})` : '· · ·'}</span>
        ${thinking && thinkingFace ? `<span class="thinking-bar-stream">${escapeHyperText(thinkingFace.slice(-80))}</span>` : ''}
      </button>
      <form>
        ${humanPrompt && humanPrompt.tabId === activeTabId ? `
          <div class="human-prompt">
            <span class="human-prompt-label">permission request</span>
            <span class="human-prompt-action">${escapeHyperText(humanPrompt.action || '')}</span>
            ${humanPrompt.description ? `<span class="human-prompt-desc">${escapeHyperText(humanPrompt.description)}</span>` : ''}
            <div class="human-prompt-btns">
              <button class="human-prompt-yes" data-rpc-id="${humanPrompt.id}">yes (A)</button>
              <button class="human-prompt-no" data-rpc-id="${humanPrompt.id}">no (B)</button>
            </div>
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
      </form>`

  return topbar + chatContent
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

}

function afterUpdate(target) {
  const diskWrap = target.querySelector('.thinking-bar .thinking-disk')
  if (diskWrap && !diskWrap.querySelector('flying-disk')) {
    diskWrap.appendChild(document.createElement('flying-disk'))
  }
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

  {
    const scrollBack = target.querySelector('.scroll-back')
    if (scrollBack) {
      if (!target._scrollListening) {
        target._scrollListening = true
        target._scrollAnchored = true
        scrollBack.addEventListener('scroll', () => {
          const { scrollTop, scrollHeight, clientHeight } = scrollBack
          target._scrollAnchored = scrollTop + clientHeight >= scrollHeight - 80
        }, { passive: true })
      }

      if (target._scrollAnchored) {
        requestAnimationFrame(() => {
          scrollBack.scrollTop = scrollBack.scrollHeight
        })
      }
    }
  }

  {
    // scroll focused gamepad item into view on sessions screen
    const gpadEl = target.querySelector('.-gpad')
    if (gpadEl) gpadEl.scrollIntoView({ block: 'nearest', inline: 'nearest' })
    // also scroll active workspace button into view when no gpad cursor is on it
    if (!gpadEl) {
      const activeWs = target.querySelector('.am-workspace-btn.-active')
      if (activeWs) activeWs.scrollIntoView({ block: 'nearest', inline: 'nearest' })
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
    playB()
    stopVosk()
  } else {
    playA()
    await startVosk()
  }
})

$.when('keypress', 'form [name="messageText"]', (event) => {
  if (event.key === "Enter" && !event.shiftKey) {
    event.preventDefault();
    execute(event.target.value)
  }
})

$.when('submit', 'form', (event) => {
  event.preventDefault()
  const text = event.target.messageText.value
  if (text.trim()) playA()
  execute(text)
})

const imports = {}

async function execute(message, options={}) {
  if(!message) return

  const { secureEntry, activeTabId } = $.learn()
  const myTabId = activeTabId  // closed over — responses go back to this tab regardless of switches

  if(!secureEntry) {
    pushHistory(message)
    addMessage({ body: message, author: 'human' }, myTabId)
  }

  _voskCommitted = ''
  $.teach({ historyCursor: null, messageText: '', messageDraft: '' })

  if(message.startsWith('<')) {
    addMessage({ body: fmt('load.module'), author: 'assistant', system: true }, myTabId)
    loadModule(message, options)
    return
  }

  if(message.startsWith('/')) {
    addMessage({ body: fmt('load.path'), author: 'assistant', system: true }, myTabId)
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
      addMessage({ ...msg, author: 'assistant' }, myTabId)
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
        addMessage({ ...msg, author: 'assistant' }, myTabId)
      }
    } catch(e) {
      if (e.declined) {
        addMessage({ body: 'declined.', author: 'assistant', system: true }, myTabId)
      } else {
        addMessage({ body: `Error. Inspect Logs.<br><a href="${window.location.origin + window.location.pathname}?q=${message}&debug=true">Reload in debug mode</a>`, author: 'assistant' }, myTabId)
        console.error(e)
      }
    }
    return
  } else {
    agentChat(message)
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

  & .am-embed-stub {
    display: inline-block;
    color: dodgerblue;
    text-decoration: none;
    cursor: pointer;
    border: 1px solid dodgerblue;
    border-radius: 4px;
    padding: 2px 6px;
    margin: 2px 0;
  }
  & .am-embed-stub:hover {
    background: color-mix(in srgb, dodgerblue 12%, transparent);
  }
  & .am-embed-stub pre {
    margin: 0;
    font-family: Courier, monospace;
    font-size: .8rem;
    pointer-events: none;
  }

  & {
    display: grid;
    grid-template-rows: auto 1fr auto auto;
    height: 100%;
    overflow: hidden;
    background: white;
    color: black;
    position: relative;
  }

  & .am-workspace-bar {
    display: flex;
    flex-direction: row;
    align-items: center;
    border-bottom: 1px solid rgba(0,0,0,.1);
    flex-shrink: 0;
    background: #f8f8f8;
  }
  & .am-workspace-strip {
    flex: 1;
    min-width: 0;
    display: flex;
    overflow-x: auto;
    scrollbar-width: none;
    gap: .25rem;
    padding: .25rem .5rem;
  }
  & .am-workspace-strip::-webkit-scrollbar { display: none; }
  & .am-workspace-btn {
    flex-shrink: 0;
    background: transparent;
    border: none;
    border-bottom: 2px solid transparent;
    border-radius: 3px 3px 0 0;
    padding: .2rem .6rem;
    font-size: .7rem;
    cursor: pointer;
    white-space: nowrap;
    color: inherit;
    opacity: .6;
  }
  & .am-workspace-btn.-active {
    border-bottom-color: var(--root-theme, mediumseagreen);
    opacity: 1;
    font-weight: 600;
  }
  & .am-workspace-btn.-gpad {
    outline: 2px solid var(--root-theme, mediumseagreen);
    outline-offset: 1px;
    opacity: 1;
  }
  & .am-new-workspace-btn {
    flex-shrink: 0;
    background: transparent;
    border: none;
    border-right: 1px solid rgba(0,0,0,.1);
    font-size: .7rem;
    padding: .3rem .7rem;
    cursor: pointer;
    opacity: .6;
    color: inherit;
    white-space: nowrap;
  }
  & .am-new-workspace-btn:hover,
  & .am-new-workspace-btn.-gpad { opacity: 1; outline: 2px solid var(--root-theme, mediumseagreen); outline-offset: 1px; }

  & .am-topbar {
    display: flex;
    align-items: center;
    gap: .35rem;
    padding: .3rem .5rem;
    background: #f0f0f0;
    border-bottom: 1px solid #ddd;
    min-width: 0;
  }

  & .am-model-select {
    font-size: .75rem;
    padding: .2rem .35rem;
    border: 1px solid #bbb;
    border-radius: 3px;
    background: white;
    max-width: 160px;
    flex-shrink: 0;
  }

  & .am-chat-tabs {
    display: flex;
    gap: .2rem;
    flex: 1;
    min-width: 0;
    overflow-x: auto;
    scrollbar-width: thin;
    margin: 0 .25rem;
  }

  & .am-chat-tab {
    font-size: .75rem;
    padding: .2rem .6rem;
    border: 1px solid #bbb;
    border-radius: 3px;
    background: white;
    cursor: pointer;
    color: #555;
    white-space: nowrap;
    flex-shrink: 0;
  }

  & .am-chat-tab.-active {
    background: var(--root-theme, mediumseagreen);
    border-color: var(--root-theme, mediumseagreen);
    color: var(--compose-btn-contrast, #1a1a1a);
    font-weight: bold;
  }

  & .am-sessions-btn {
    font-size: .85rem;
    padding: .2rem .5rem;
    border: 1px solid #bbb;
    border-radius: 3px;
    background: white;
    cursor: pointer;
    color: #555;
    flex-shrink: 0;
  }

  & .am-sessions-btn.-active {
    background: #222;
    border-color: #222;
    color: white;
  }

  & .am-preview-toggle {
    font-size: .8rem;
    padding: .2rem .5rem;
    border: 1px solid #bbb;
    border-radius: 3px;
    background: white;
    cursor: pointer;
    color: #555;
    flex-shrink: 0;
  }

  & .am-preview-toggle.-active {
    background: var(--root-theme, mediumseagreen);
    border-color: var(--root-theme, mediumseagreen);
    color: var(--compose-btn-contrast, #1a1a1a);
  }

  & .am-sessions-view {
    display: flex;
    flex-direction: column;
    grid-row: 2 / -1;
    overflow: hidden;
  }

  & .am-sessions-scroll {
    flex: 1;
    overflow-y: auto;
    display: flex;
    justify-content: center;
    padding: 2rem 1rem;
  }

  & .am-sessions-inner {
    width: 100%;
    max-width: 320px;
  }

  & .am-new-chat-hero {
    display: block;
    width: 100%;
    padding: 1.25rem;
    font-size: 1.1rem;
    font-weight: bold;
    background: var(--root-theme, mediumseagreen);
    color: var(--compose-btn-contrast, #1a1a1a);
    border: none;
    border-radius: 8px;
    cursor: pointer;
    margin-bottom: 1.5rem;
    font-family: inherit;
  }
  & .am-new-chat-hero.-gpad {
    outline: 3px solid currentColor;
    outline-offset: 2px;
  }

  & .am-sessions-list {
    display: flex;
    flex-direction: column;
    gap: .4rem;
  }

  & .am-session-item {
    display: block;
    width: 100%;
    padding: .7rem 1rem;
    text-align: left;
    font-size: .9rem;
    background: white;
    border: 1px solid #ddd;
    border-radius: 6px;
    cursor: pointer;
    font-family: inherit;
  }

  & .am-session-item:hover {
    background: #f5f5f5;
  }
  & .am-session-item.-gpad {
    outline: 2px solid var(--root-theme, mediumseagreen);
    outline-offset: 1px;
    background: color-mix(in srgb, var(--root-theme, mediumseagreen) 8%, white);
  }

  & .am-sessions-empty {
    text-align: center;
    color: #999;
    font-size: .85rem;
    padding: 2rem 0;
  }

  & .am-preview-inframe {
    display: block;
    width: 100%;
    height: 100%;
    border: none;
    grid-row: 2 / -1;
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

  & .thinking-bar {
    display: flex;
    align-items: center;
    gap: .5rem;
    padding: .2rem .75rem;
    background: transparent;
    border: none;
    border-top: 1px solid color-mix(in srgb, var(--root-theme, mediumseagreen) 25%, transparent);
    cursor: pointer;
    width: 100%;
    max-width: min(65ch, 100%);
    margin-inline: auto;
    box-sizing: border-box;
    font-family: 'Recursive', Courier, monospace;
    font-size: .75rem;
    color: color-mix(in srgb, currentColor 55%, transparent);
    text-align: left;
    min-height: 32px;
  }
  & .thinking-bar:hover {
    background: color-mix(in srgb, var(--root-theme, mediumseagreen) 8%, transparent);
    color: currentColor;
  }
  & .thinking-bar .thinking-disk {
    width: 28px;
    height: 28px;
    flex-shrink: 0;
    padding: 0;
  }
  & .thinking-bar .thinking-disk flying-disk {
    width: 28px;
    height: 28px;
    border-radius: 50%;
    overflow: hidden;
    display: flex;
    align-items: center;
  }
  & .thinking-bar-dot {
    font-size: .9rem;
    opacity: .35;
    flex-shrink: 0;
    line-height: 1;
  }
  & .thinking-bar-label {
    font-variant-numeric: tabular-nums;
    flex-shrink: 0;
  }
  & .thinking-bar-stream {
    flex: 1;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    opacity: .65;
    font-size: .7rem;
    direction: rtl;
    text-align: left;
  }

  & .log-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: .3rem .75rem;
    border-bottom: 1px solid #eee;
    position: sticky;
    top: 0;
    background: white;
    z-index: 2;
  }
  & .log-header-title {
    font-family: Courier, monospace;
    font-size: .7rem;
    color: #aaa;
    text-transform: uppercase;
    letter-spacing: .05em;
  }
  & .log-clear-btn {
    background: none;
    border: 1px solid #ddd;
    border-radius: 3px;
    padding: 1px 8px;
    font-family: Courier, monospace;
    font-size: .7rem;
    cursor: pointer;
    color: #aaa;
  }
  & .log-clear-btn:hover { border-color: #aaa; color: #333; }

  & .log-entry {
    display: flex;
    align-items: flex-start;
    gap: .4rem;
    padding: .25rem .75rem;
    font-family: 'Recursive', Courier, monospace;
    font-size: .75rem;
    border-bottom: 1px solid #f5f5f5;
    max-width: min(65ch, 100%);
    margin-inline: auto;
    box-sizing: border-box;
  }
  & .log-ts {
    flex-shrink: 0;
    font-size: .65rem;
    color: #bbb;
    padding-top: .1em;
    min-width: 6ch;
  }
  & .log-entry--session {
    background: #f8f8f8;
    border-left: 3px solid #ccc;
    color: #666;
    font-weight: bold;
    padding-left: .5rem;
  }
  & .log-session-text { font-style: italic; }
  & .log-entry--tool { color: #1a6ef5; }
  & .log-entry .log-code {
    font-family: inherit;
    font-size: inherit;
    word-break: break-all;
    background: none;
  }
  & .log-entry--result { color: #1a7a3c; }
  & .log-entry .log-result { word-break: break-all; }
  & .log-entry--error { color: #c0392b; background: #fff5f5; }
  & .log-entry .log-error { word-break: break-all; font-weight: bold; }
  & .log-entry--rpc { color: #e67e22; }
  & .log-entry--rpc-response { color: #888; font-style: italic; }
  & .log-entry--system { color: #888; }
  & .log-entry--live { display: block; padding: .25rem .75rem; }
  & .log-entry--live .log-stream {
    margin: 0;
    white-space: pre-wrap;
    word-break: break-word;
    font-size: .7rem;
    opacity: .6;
    font-family: inherit;
    max-width: min(65ch, 100%);
    margin-inline: auto;
  }
  & .log-empty {
    padding: 2rem 1rem;
    font-family: Courier, monospace;
    font-size: .8rem;
    color: #aaa;
    text-align: center;
  }

  & form,
  & .human-prompt {
    max-width: min(65ch, 100%);
    margin-inline: auto;
    width: 100%;
    box-sizing: border-box;
  }

  & .human-prompt {
    display: flex;
    flex-direction: column;
    gap: 4px;
    padding: 10px 12px;
    background: color-mix(in srgb, var(--root-theme, mediumseagreen) 12%, transparent);
    border-top: 2px solid var(--root-theme, mediumseagreen);
    font-size: .85rem;
  }
  & .human-prompt-label {
    font-size: .7rem;
    text-transform: uppercase;
    letter-spacing: .05em;
    opacity: .6;
  }
  & .human-prompt-action { font-weight: bold; }
  & .human-prompt-desc { opacity: .75; font-size: .8rem; }
  & .human-prompt-btns {
    display: flex;
    gap: 8px;
    margin-top: 4px;
  }
  & .human-prompt-yes,
  & .human-prompt-no {
    padding: 4px 16px;
    border-radius: 4px;
    border: 1px solid currentColor;
    cursor: pointer;
    font-family: inherit;
    font-size: .85rem;
    background: transparent;
  }
  & .human-prompt-yes { color: var(--root-theme, mediumseagreen); }
  & .human-prompt-no { opacity: .6; }

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
    flex-direction: row;
    background: white;
    border-left: 2px solid var(--root-theme, mediumseagreen);
    pointer-events: none;
  }

  & .sagas-sidebar[data-open="true"] {
    transform: translateX(0);
    pointer-events: all;
  }

  & .sagas-sidebar-resizer {
    width: 6px;
    flex-shrink: 0;
    cursor: col-resize;
    background: transparent;
    transition: background .15s;
  }
  & .sagas-sidebar-resizer:hover { background: var(--root-theme, mediumseagreen); opacity: .4; }

  & .sagas-sidebar-inner {
    flex: 1;
    min-width: 0;
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
  & .sb-action-btn:hover,
  & .sb-action-btn.-active { background: var(--root-theme, mediumseagreen); color: var(--compose-btn-contrast, #1a1a1a); }

  & .sb-export-wrap {
    flex: 1;
    position: relative;
    border-right: 1px solid #eee;
    display: flex;
    flex-direction: column;
  }
  & .sb-export-wrap .sb-action-btn {
    border-right: none;
    flex: 1;
  }
  & .sb-export-menu {
    position: absolute;
    top: 100%;
    left: 0;
    right: 0;
    background: white;
    border: 1px solid #eee;
    border-top: none;
    z-index: 10;
    display: flex;
    flex-direction: column;
  }
  & .sb-export-menu .sb-action-btn {
    border-right: none;
    border-bottom: 1px solid #eee;
    flex: unset;
  }
  & .sb-export-menu .sb-action-btn:last-child { border-bottom: none; }

  & .sagas-open-board {
    float: right;
    font-size: .6rem;
    color: var(--root-theme, mediumseagreen);
    text-decoration: none;
    text-transform: none;
    letter-spacing: 0;
    padding-right: .25rem;
  }
  & .sagas-open-board:hover { text-decoration: underline; }
  & .sagas-list-empty {
    padding: .5rem .75rem;
    font-size: .7rem;
    font-family: Courier, monospace;
    color: #ccc;
    font-style: italic;
  }
  & .sagas-list-label {
    padding: .25rem .75rem;
    font-size: .6rem;
    font-family: Courier, monospace;
    color: #aaa;
    text-transform: uppercase;
    letter-spacing: .05em;
    border-bottom: 1px solid #f0f0f0;
  }

  & .saga-item.-session {
    display: flex;
    align-items: stretch;
    border-bottom: 1px solid #f0f0f0;
  }
  & .saga-item-load {
    flex: 1;
    background: transparent;
    border: none;
    padding: .6rem .5rem .6rem .75rem;
    font-family: Courier, monospace;
    font-size: .75rem;
    text-align: left;
    cursor: pointer;
    color: #333;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  & .saga-item-load:hover { background: var(--root-theme, mediumseagreen); color: var(--compose-btn-contrast, #1a1a1a); }
  & .saga-item-meta {
    background: transparent;
    border: none;
    border-left: 1px solid #f0f0f0;
    padding: .4rem .6rem;
    font-size: .75rem;
    cursor: pointer;
    color: #aaa;
    flex-shrink: 0;
  }
  & .saga-item-meta:hover { color: var(--root-theme, mediumseagreen); }

  & .meta-screen {
    display: grid;
    grid-template-rows: auto 1fr;
    height: 100%;
    overflow: hidden;
    background: white;
    font-family: Courier, monospace;
  }
  & .meta-screen-header {
    display: flex;
    align-items: center;
    gap: .75rem;
    padding: .75rem 1rem;
    border-bottom: 2px solid var(--root-theme, mediumseagreen);
    flex-shrink: 0;
  }
  & .meta-back-btn {
    display: flex;
    align-items: center;
    gap: .35rem;
    background: transparent;
    border: none;
    cursor: pointer;
    color: var(--root-theme, mediumseagreen);
    font-family: Courier, monospace;
    font-size: .9rem;
    padding: .35rem .5rem;
    border-radius: .25rem;
  }
  & .meta-back-btn:hover { background: rgba(0,0,0,.05); }
  & .meta-screen-title {
    font-size: .7rem;
    text-transform: uppercase;
    letter-spacing: .1em;
    color: #aaa;
  }
  & .meta-screen-body {
    overflow-y: auto;
    padding: 1.5rem 1rem;
    max-width: 480px;
  }
  & .meta-screen-actions {
    display: flex;
    gap: .5rem;
    margin-top: 1.5rem;
  }
  & .meta-screen-actions .standard-button { flex: 1; }

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
    max-width: min(65ch, 100%);
    margin-inline: auto;
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
  const { activeTabId } = $.learn()
  if (_tabAborts[activeTabId]) { _tabAborts[activeTabId].abort(); delete _tabAborts[activeTabId] }
  normalMode()
  $.teach({ secureEntry: false, messageHeight: null, messageText: '', messageDraft: '' })
  teachLive({ thinking: false, thinkingFace: null })
  addMessage({ body: fmt('sagas.interrupted'), author: 'assistant' })
}

$.when('keydown', '[name="messageText"]', (event) => {
  if (event.ctrlKey && (event.key === 'c' || event.key === 'C')) {
    interrupt()
  }
})

$.when('change', '[data-model-select]', (e) => {
  $.teach({ selectedModel: e.target.value })
})

$.when('click', '[data-toggle-logs]', () => {
  $.teach({ logsOpen: !$.learn().logsOpen })
})

$.when('click', '[data-clear-logs]', (e) => {
  e.stopPropagation()
  $.teach({ agentLogs: [] })
})

$.when('click', '[data-toggle-preview]', () => {
  $.teach({ previewOpen: !$.learn().previewOpen })
})

$.when('click', '[data-sessions-tab]', async () => {
  $.teach({ tabSnapshots: snapshotCurrentTab() }) // save current tab before leaving
  const sessions = await listSessions()
  $.teach({ sessions, activeTabId: 'sessions' })
  loadBoardCards()
})

function snapshotCurrentTab() {
  const { activeTabId, tabs, tabSnapshots, messages, history, agentLogs, previewUrl } = $.learn()
  if (activeTabId === 'sessions') return tabSnapshots
  if (!tabs.find(t => t.id === activeTabId)) return tabSnapshots // unknown tab — don't corrupt
  return { ...tabSnapshots, [activeTabId]: { messages, history, agentLogs, previewUrl, sessionId: _shellSessionId } }
}

function restoreTab(tabId, snapshots) {
  const snap = snapshots[tabId] || { messages: [], history: [], agentLogs: [], previewUrl: '/app/bulletin-board' }
  if (snap.sessionId) _shellSessionId = snap.sessionId
  // Clear message container before state update so diffHTML renders from a blank
  // slate instead of patching over stale saga DOM from the previous tab.
  const msgEl = document.querySelector('accessibility-mode .messages')
  if (msgEl) msgEl.innerHTML = ''
  $.teach({ activeTabId: tabId, tabSnapshots: snapshots, messages: snap.messages, history: snap.history, agentLogs: snap.agentLogs, previewUrl: snap.previewUrl })
}

function snapshotCurrentWorkspace() {
  const { activeWorkspaceId, workspaces, tabs, tabSnapshots, activeTabId, messages, history, agentLogs, previewUrl } = $.learn()
  const ws = workspaces.find(w => w.id === activeWorkspaceId) || {}
  return { ...ws, tabs, tabSnapshots, activeTabId, messages, history, agentLogs, previewUrl, updatedAt: Date.now() }
}

async function saveWorkspaces() {
  const { workspaces, activeWorkspaceId } = $.learn()
  await ensureSpace().catch(() => null)
  await put(WORKSPACES_PATH, JSON.stringify({ workspaces, activeWorkspaceId }), { type: 'application/json' }).catch(() => null)
}

async function loadWorkspaces() {
  await ensureSpace().catch(() => null)
  try {
    const blob = await wasGet(WORKSPACES_PATH)
    if (!blob) return
    const { workspaces, activeWorkspaceId } = JSON.parse(await blob.text())
    if (!workspaces?.length) return
    const active = workspaces.find(w => w.id === activeWorkspaceId) || workspaces[0]
    // Clear message DOM for fresh render
    const msgEl = document.querySelector('accessibility-mode .messages')
    if (msgEl) msgEl.innerHTML = ''
    $.teach({
      workspaces,
      activeWorkspaceId: active.id,
      tabs: active.tabs || [{ id: 'default', label: 'Chat' }],
      tabSnapshots: active.tabSnapshots || {},
      activeTabId: active.activeTabId || 'default',
      messages: active.messages || [],
      history: active.history || [],
      agentLogs: active.agentLogs || [],
      previewUrl: active.previewUrl || '/app/bulletin-board',
    })
    if (active.sessionId) _shellSessionId = active.sessionId
  } catch {}
}

function switchWorkspace(id) {
  const { workspaces, activeWorkspaceId } = $.learn()
  if (id === activeWorkspaceId) return
  // Snapshot current workspace into array
  const current = snapshotCurrentWorkspace()
  const updated = workspaces.map(w => w.id === activeWorkspaceId ? current : w)
  const target = updated.find(w => w.id === id) || updated[0]
  const targetSnap = { ...target, updatedAt: Date.now() }
  const final = updated.map(w => w.id === id ? targetSnap : w)
  // Clear message DOM before state swap
  const msgEl = document.querySelector('accessibility-mode .messages')
  if (msgEl) msgEl.innerHTML = ''
  $.teach({
    workspaces: final,
    activeWorkspaceId: id,
    tabs: targetSnap.tabs || [{ id: 'default', label: 'Chat' }],
    tabSnapshots: targetSnap.tabSnapshots || {},
    activeTabId: targetSnap.activeTabId || 'default',
    messages: targetSnap.messages || [],
    history: targetSnap.history || [],
    agentLogs: targetSnap.agentLogs || [],
    previewUrl: targetSnap.previewUrl || '/app/bulletin-board',
  })
  if (targetSnap.sessionId) _shellSessionId = targetSnap.sessionId
  // Persist async
  saveWorkspaces()
}

function newWorkspace() {
  const { workspaces, activeWorkspaceId } = $.learn()
  // Snapshot current
  const current = snapshotCurrentWorkspace()
  const updated = workspaces.map(w => w.id === activeWorkspaceId ? current : w)
  const id = crypto.randomUUID()
  const label = 'Workspace ' + (workspaces.length + 1)
  const freshTab = { id: 'default', label: 'Chat' }
  const ws = { id, label, updatedAt: Date.now(), tabs: [freshTab], tabSnapshots: {}, activeTabId: freshTab.id, messages: [], history: [], agentLogs: [], previewUrl: '/app/bulletin-board' }
  const final = [...updated, ws]
  const msgEl = document.querySelector('accessibility-mode .messages')
  if (msgEl) msgEl.innerHTML = ''
  $.teach({
    workspaces: final,
    activeWorkspaceId: id,
    tabs: [freshTab],
    tabSnapshots: {},
    activeTabId: freshTab.id,
    messages: [],
    history: [],
    agentLogs: [],
    previewUrl: '/app/bulletin-board',
  })
  newSession()
  showPreroll()
  saveWorkspaces()
}

// tab drag-to-reorder + tap-to-switch (flip-book pattern)
document.addEventListener('pointerdown', e => {
  const tab = e.target.closest('[data-tab-drag]')
  if (!tab) return
  e.preventDefault()
  tab.setPointerCapture(e.pointerId)

  const tabId = tab.dataset.tabDrag
  const startX = e.clientX
  let moved = false, ghost = null, indicator = null, dropIdx = null
  const strip = tab.closest('.am-chat-tabs')

  const onMove = ev => {
    const dx = Math.abs(ev.clientX - startX)
    if (!moved && dx > 6) {
      moved = true
      const rect = tab.getBoundingClientRect()
      ghost = document.createElement('div')
      ghost.textContent = tab.textContent
      ghost.style.cssText = `position:fixed;pointer-events:none;z-index:9999;left:${rect.left}px;top:${rect.top}px;width:${rect.width}px;height:${rect.height}px;font-size:.75rem;padding:.2rem .6rem;border:2px solid var(--root-theme,mediumseagreen);border-radius:3px;background:white;opacity:.85;`
      document.body.appendChild(ghost)
      indicator = document.createElement('div')
      const sr = strip.getBoundingClientRect()
      indicator.style.cssText = `position:fixed;pointer-events:none;z-index:9998;width:3px;border-radius:2px;background:var(--root-theme,mediumseagreen);top:${sr.top}px;height:${sr.height}px;display:none;`
      document.body.appendChild(indicator)
    }
    if (!moved) return
    ghost.style.left = (ev.clientX - tab.offsetWidth / 2) + 'px'
    const allTabs = [...strip.querySelectorAll('[data-tab-drag]')]
    dropIdx = allTabs.length
    for (let i = 0; i < allTabs.length; i++) {
      const r = allTabs[i].getBoundingClientRect()
      if (ev.clientX < r.left + r.width / 2) {
        dropIdx = i
        indicator.style.display = 'block'
        indicator.style.left = (r.left - 2) + 'px'
        break
      }
      if (i === allTabs.length - 1) {
        indicator.style.display = 'block'
        indicator.style.left = (r.right + 2) + 'px'
      }
    }
  }

  const onUp = () => {
    tab.removeEventListener('pointermove', onMove)
    tab.removeEventListener('pointerup', onUp)
    tab.removeEventListener('pointercancel', onUp)
    if (ghost) ghost.remove()
    if (indicator) indicator.remove()
    if (moved && dropIdx !== null) {
      const { tabs: allTabs } = $.learn()
      const fromIdx = allTabs.findIndex(t => t.id === tabId)
      let toIdx = dropIdx > fromIdx ? dropIdx - 1 : dropIdx
      if (fromIdx !== -1 && fromIdx !== toIdx) {
        const next = [...allTabs]
        const [removed] = next.splice(fromIdx, 1)
        next.splice(toIdx, 0, removed)
        $.teach({ tabs: next })
      }
    } else if (!moved) {
      const snapshots = snapshotCurrentTab()
      restoreTab(tabId, snapshots)
    }
  }

  tab.addEventListener('pointermove', onMove)
  tab.addEventListener('pointerup', onUp)
  tab.addEventListener('pointercancel', onUp)
}, { capture: true })

$.when('click', '[data-new-chat]', () => {
  const { tabs } = $.learn()
  const id = crypto.randomUUID()
  const label = 'Chat ' + (tabs.length + 1)
  const snapshots = snapshotCurrentTab()
  $.teach({ tabs: [...tabs, { id, label }] })
  restoreTab(id, snapshots)
  newSession()
  showPreroll()
})

$.when('click', '[data-open-session]', async (e) => {
  const sessionId = e.target.dataset.openSession
  const { tabs } = $.learn()
  const existing = tabs.find(t => t.id === sessionId)
  if (existing) {
    const snapshots = snapshotCurrentTab()
    restoreTab(sessionId, snapshots)
    return
  }
  const snapshots = snapshotCurrentTab()
  const session = await loadSession(sessionId)
  if (!session) return
  const newTabs = [...tabs, { id: sessionId, label: session.title || sessionId.slice(0, 8) }]
  $.teach({ tabs: newTabs, tabSnapshots: { ...snapshots, [sessionId]: { messages: session.messages || [], history: session.history || [], agentLogs: [], previewUrl: '/app/bulletin-board' } } })
  restoreTab(sessionId, { ...snapshots, [sessionId]: { messages: session.messages || [], history: session.history || [], agentLogs: [], previewUrl: '/app/bulletin-board' } })
})

$.when('input', '[data-saga-filter]', (event) => {
  $.teach({ sagaFilter: event.target.value })
})

$.when('click', '[data-sb-export-toggle]', () => {
  $.teach({ exportOpen: !$.learn().exportOpen })
})

$.when('click', '[data-load-saga]', async (event) => {
  const path = event.target.dataset.loadSaga
  try {
    const text = await fetch(path).then(r => r.text())
    if (!text) throw new Error('empty')
    $.teach({ messages: [{ body: text, author: 'unassigned', saga: true, id: Date.now() }] })
  } catch {
    $.teach({ messages: [{ body: `could not load ${path}`, author: 'unassigned', system: true, id: Date.now() }] })
  }
})

$.when('click', '[data-sb-print]', () => {
  const { messages } = $.learn()
  printSaga(messagesToSaga(messages))
})

$.when('click', '[data-sb-save]', () => {
  const { messages } = $.learn()
  const script = messagesToSaga(messages)
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

$.when('click', '[data-meta-session]', (event) => {
  $.teach({ metaSession: event.target.dataset.metaSession, sidebarOpen: false })
})

$.when('click', '[data-close-meta]', () => {
  $.teach({ metaSession: null })
})

$.when('click', '[data-stop-close]', (event) => {
  event.stopPropagation()
})

$.when('click', '[data-meta-save]', async () => {
  const title = document.querySelector('[name="metaTitle"]')?.value?.trim() || ''
  const { metaSession: id } = $.learn()
  await upsertManifest(id, { title }).catch(() => null)
  const sessions = await listSessions()
  $.teach({ metaSession: null, sessions })
})

$.when('click', '[data-meta-delete]', async (event) => {
  const id = event.target.dataset.metaDelete
  await deleteSession(id).catch(() => null)
  const sessions = await listSessions()
  $.teach({ metaSession: null, sessions })
})

$.when('click', '.human-prompt-yes', (event) => {
  humanRPCRespond(event.target.dataset.rpcId, true)
})

$.when('click', '.human-prompt-no', (event) => {
  humanRPCRespond(event.target.dataset.rpcId, false)
})

loadModels()

$.when('click', '[data-switch-workspace]', (e) => {
  switchWorkspace(e.target.dataset.switchWorkspace)
})

$.when('click', '[data-new-workspace]', () => {
  newWorkspace()
})

$.when('click', '.am-embed-stub', (event) => {
  const a = event.target.closest('.am-embed-stub')
  if (!a) return
  const tag = a.dataset.embedTag
  const props = JSON.parse(a.dataset.embedProps || '{}')
  const attrs = Object.entries(props).map(([k, v]) => `${k}="${escapeHyperText(v)}"`).join(' ')
  showModal(`
    <div style="display:grid;height:100%;width:100%;grid-template-rows:auto 1fr;">
      <div style="background:black;">
        <button data-modal-close class="branded-button">Back</button>
      </div>
      <${tag} ${attrs}></${tag}>
    </div>
  `, { blockExit: true, onHide: () => $.teach({ popped: false }) })
  $.teach({ popped: true })
})
