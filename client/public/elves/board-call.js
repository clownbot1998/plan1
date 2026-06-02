import { Self, PLAN98_NODE_ID, linkState, broadcastElf } from '@plan98/types'
import { learn } from '@plan98/elf'

const tag = 'board-call'
const $ = Self(tag, { muted: true, cameraOn: false, nearbyCount: 0, activeSpeaker: null, expanded: false, devicePicker: null })

const SPREAD = 1.5
const MAX_PEERS = 6
const HYSTERESIS = 1.3
const RECONNECT_COOLDOWN = 5000
const SAMPLE_RATE = 48000
const ICE = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' },
]

const _boardId = new URLSearchParams(window.location.search).get('id') || 'default'

let _ws = null
let _localStream = null
let _audioCtx = null
let _roomPeers = new Set()
let _connections = {}   // peerId → { pc, stream, analyser, panner }
let _reconnectAt = {}   // peerId → cooldown timestamp

// ── hud drag ──────────────────────────────────────────────────────────────────
let _hudX = 0, _hudY = 0
let _dragActive = false, _dragMoved = false
let _dragStartX = 0, _dragStartY = 0

function applyHudPos(target) {
  const el = (target || document.querySelector(tag))?.querySelector('.hud')
  if (el) el.style.transform = `translate(${_hudX}px,${_hudY}px)`
}

function initDrag(target) {
  document.addEventListener('pointermove', e => {
    if (!_dragActive) return
    const dx = e.clientX - _dragStartX
    const dy = e.clientY - _dragStartY
    if (!_dragMoved && (Math.abs(dx) > 4 || Math.abs(dy) > 4)) _dragMoved = true
    if (!_dragMoved) return
    const hud = target.querySelector('.hud')
    if (!hud) return
    const rect = hud.getBoundingClientRect()
    const maxX = window.innerWidth  - rect.width
    const maxY = window.innerHeight - rect.height
    _hudX = Math.max(-8, Math.min(maxX, _hudX + e.clientX - _dragStartX))
    _hudY = Math.max(-8, Math.min(maxY, _hudY + e.clientY - _dragStartY))
    _dragStartX = e.clientX
    _dragStartY = e.clientY
    applyHudPos(target)
  })
  document.addEventListener('pointerup', () => { _dragActive = false })
}

// ── coordinate helpers ────────────────────────────────────────────────────────

function myBoardPos() {
  const bb = learn('bulletin-board')
  const gp = learn('generic-park')
  if (bb?.mode === 'os') {
    const me = gp?.players?.[PLAN98_NODE_ID]
    if (me) return { bx: me.x / SPREAD, by: me.z / SPREAD }
  }
  return { bx: -(bb?.panX || 0), by: -(bb?.panY || 0) }
}

function peerBoardPos(peerId) {
  const gp = learn('generic-park')
  const p3d = gp?.players?.[peerId]
  if (p3d && Date.now() - (p3d.ts || 0) < 10000) {
    return { bx: p3d.x / SPREAD, by: p3d.z / SPREAD }
  }
  const bb = learn('bulletin-board')
  const p2d = bb?.players?.[peerId]
  if (p2d?.bx !== undefined && Date.now() - (p2d.ts || 0) < 10000) {
    return { bx: p2d.bx, by: p2d.by }
  }
  return null
}

function dist(a, b) { return Math.hypot(a.bx - b.bx, a.by - b.by) }

// ── media acquisition (hail-mary audio constraints, v-log video constraints) ──

const AUDIO_CONSTRAINTS = {
  echoCancellation: true,
  noiseSuppression: true,
  channelCount: 1,
  sampleRate: SAMPLE_RATE,
}

function videoConstraints() {
  const w = window.innerWidth, h = window.innerHeight
  const portrait = h > w
  const square = Math.abs(w - h) < 100
  if (square)   return { width: { ideal: 1080 }, height: { ideal: 1080 } }
  if (portrait) return { width: { ideal: 1080 }, height: { ideal: 1920 } }
  return { width: { ideal: 1920 }, height: { ideal: 1080 } }
}

let _audioDevices = []
let _videoDevices = []
let _selectedAudioId = null
let _selectedVideoId = null
let _holdTimer = null

async function enumerateDevices() {
  try {
    const all = await navigator.mediaDevices.enumerateDevices()
    _audioDevices = all.filter(d => d.kind === 'audioinput')
    _videoDevices = all.filter(d => d.kind === 'videoinput')
  } catch {}
}

async function getLocalStream(withVideo) {
  const audio = _selectedAudioId
    ? { ...AUDIO_CONSTRAINTS, deviceId: { exact: _selectedAudioId } }
    : AUDIO_CONSTRAINTS
  const video = withVideo
    ? (_selectedVideoId ? { ...videoConstraints(), deviceId: { exact: _selectedVideoId } } : videoConstraints())
    : false
  const constraints = { audio, ...(video ? { video } : {}) }
  try {
    const stream = await navigator.mediaDevices.getUserMedia(constraints)
    await enumerateDevices()
    return stream
  } catch {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: AUDIO_CONSTRAINTS }).catch(() => null)
    if (stream) await enumerateDevices()
    return stream
  }
}

async function switchDevice(kind, deviceId) {
  if (kind === 'audioinput') _selectedAudioId = deviceId
  else _selectedVideoId = deviceId

  if (!_localStream) return
  const withVideo = $.learn().cameraOn

  _localStream.getTracks().forEach(t => t.stop())
  _localStream = await getLocalStream(withVideo)
  if (!_localStream) return

  const { muted } = $.learn()
  _localStream.getAudioTracks().forEach(t => { t.enabled = !muted })

  for (const [, conn] of Object.entries(_connections)) {
    if (!conn.pc) continue
    const senders = conn.pc.getSenders()
    for (const track of _localStream.getTracks()) {
      const sender = senders.find(s => s.track?.kind === track.kind)
      if (sender) sender.replaceTrack(track).catch(() => {})
      else conn.pc.addTrack(track, _localStream)
    }
  }
}

function syncRoomCount() {
  $.teach({ nearbyCount: Math.max(_roomPeers.size, Object.keys(_connections).length) })
}

// ── signaling ─────────────────────────────────────────────────────────────────

function connectSignal() {
  const proto = location.protocol === 'https:' ? 'wss' : 'ws'
  _ws = new WebSocket(`${proto}://${location.host}/api/signal?room=${encodeURIComponent(_boardId)}&peer=${encodeURIComponent(PLAN98_NODE_ID)}`)

  _ws.onmessage = (e) => {
    let msg; try { msg = JSON.parse(e.data) } catch { return }
    const { type, from, peers, data } = msg
    if (type === 'peers')  { peers.forEach(id => { _roomPeers.add(id); maybeOffer(id) }); syncRoomCount() }
    else if (type === 'join')   { _roomPeers.add(from); maybeOffer(from); syncRoomCount() }
    else if (type === 'leave')  { _roomPeers.delete(from); closePeer(from); syncRoomCount() }
    else if (type === 'offer')  { handleOffer(from, data) }
    else if (type === 'answer') { _connections[from]?.pc?.setRemoteDescription(data).catch(() => {}) }
    else if (type === 'ice')    { _connections[from]?.pc?.addIceCandidate(data).catch(() => {}) }
  }

  _ws.onclose = () => setTimeout(connectSignal, 3000)
}

function signal(to, type, data) {
  if (_ws?.readyState === WebSocket.OPEN) _ws.send(JSON.stringify({ to, type, data }))
}

// ── peer connections ──────────────────────────────────────────────────────────

function createPc(peerId) {
  const pc = new RTCPeerConnection({ iceServers: ICE, iceCandidatePoolSize: 2 })
  if (_localStream) _localStream.getTracks().forEach(t => pc.addTrack(t, _localStream))

  pc.onicecandidate = (e) => { if (e.candidate) signal(peerId, 'ice', e.candidate) }

  pc.onnegotiationneeded = async () => {
    try {
      if (_connections[peerId]) _connections[peerId].makingOffer = true
      await pc.setLocalDescription()
      signal(peerId, 'offer', pc.localDescription)
    } catch {} finally {
      if (_connections[peerId]) _connections[peerId].makingOffer = false
    }
  }

  pc.ontrack = (e) => {
    if (!_audioCtx) _audioCtx = new AudioContext()
    const stream = e.streams[0]
    // only set up audio graph once per peer
    if (!_connections[peerId]?.analyser) {
      const source = _audioCtx.createMediaStreamSource(stream)
      const analyser = _audioCtx.createAnalyser()
      analyser.fftSize = 256
      const panner = _audioCtx.createPanner()
      panner.panningModel = 'HRTF'
      panner.distanceModel = 'inverse'
      panner.refDistance = 300
      panner.maxDistance = 8000
      source.connect(analyser)
      analyser.connect(panner)
      panner.connect(_audioCtx.destination)
      _connections[peerId] = { ..._connections[peerId], pc, stream, analyser, panner }
    } else {
      _connections[peerId] = { ..._connections[peerId], stream }
    }
    placePanner(peerId)
  }

  pc.onconnectionstatechange = () => {
    if (pc.connectionState === 'failed' || pc.connectionState === 'closed') closePeer(peerId)
  }

  _connections[peerId] = { pc }
  return pc
}

async function maybeOffer(peerId) {
  if (_connections[peerId]?.pc) return
  if (PLAN98_NODE_ID < peerId) return  // lower ID is polite peer — waits for offer
  const pc = createPc(peerId)
  // onnegotiationneeded will fire and send the offer via setLocalDescription()
}

async function handleOffer(peerId, offer) {
  const pc = _connections[peerId]?.pc || createPc(peerId)
  const polite = PLAN98_NODE_ID < peerId
  const collision = _connections[peerId]?.makingOffer || pc.signalingState !== 'stable'
  if (!polite && collision) return  // impolite peer ignores colliding offer
  try {
    if (collision) await pc.setLocalDescription({ type: 'rollback' })
    await pc.setRemoteDescription(offer)
    const answer = await pc.createAnswer()
    await pc.setLocalDescription(answer)
    signal(peerId, 'answer', answer)
  } catch { closePeer(peerId) }
}

function closePeer(peerId) {
  const conn = _connections[peerId]
  if (!conn) return
  conn.pc?.close()
  delete _connections[peerId]
  _reconnectAt[peerId] = Date.now() + RECONNECT_COOLDOWN
}

// ── proximity engine ──────────────────────────────────────────────────────────

function updateProximity() {
  const me = myBoardPos()
  const now = Date.now()
  const ranked = [..._roomPeers]
    .map(id => ({ id, d: (p => p ? dist(me, p) : Infinity)(peerBoardPos(id)) }))
    .sort((a, b) => a.d - b.d)

  const top6 = new Set(ranked.slice(0, MAX_PEERS).map(p => p.id))
  const cutoff = ranked[MAX_PEERS - 1]?.d ?? Infinity

  for (const { id } of ranked.slice(0, MAX_PEERS)) {
    if (!_connections[id]?.pc && !(now < (_reconnectAt[id] || 0))) maybeOffer(id)
  }

  for (const id of Object.keys(_connections)) {
    if (top6.has(id)) continue
    const pos = peerBoardPos(id)
    if ((pos ? dist(me, pos) : Infinity) > cutoff * HYSTERESIS) closePeer(id)
  }
}

// ── spatial audio ─────────────────────────────────────────────────────────────

function placePanner(peerId) {
  const conn = _connections[peerId]
  if (!conn?.panner) return
  const me = myBoardPos(), peer = peerBoardPos(peerId)
  if (!peer) return
  conn.panner.positionX.value = (peer.bx - me.bx) * SPREAD
  conn.panner.positionY.value = 0
  conn.panner.positionZ.value = (peer.by - me.by) * SPREAD
}

let _lastSpokeAt = 0      // timestamp of last detected speech
let _spotlightId = null   // currently pinned spotlight peer
let _rotateIdx = 0        // round-robin index for silence rotation
const SILENCE_TIMEOUT = 4000

function updateSpeaker() {
  const buf = new Uint8Array(128)
  let loudestId = null, loudestVol = -1
  for (const [id, conn] of Object.entries(_connections)) {
    if (!conn.analyser) continue
    conn.analyser.getByteFrequencyData(buf)
    const vol = buf.reduce((s, v) => s + v, 0) / buf.length
    if (vol > loudestVol) { loudestVol = vol; loudestId = id }
    placePanner(id)
  }

  const now = Date.now()
  const speaking = loudestVol > 5 && loudestId !== null

  if (speaking) {
    _lastSpokeAt = now
    _spotlightId = loudestId
  } else if (_spotlightId && now - _lastSpokeAt > SILENCE_TIMEOUT) {
    // rotate spotlight among peers with video every 4s of silence
    const peers = Object.keys(_connections)
    if (peers.length > 0) {
      _rotateIdx = (_rotateIdx + 1) % peers.length
      _spotlightId = peers[_rotateIdx]
    } else {
      _spotlightId = null
    }
    _lastSpokeAt = now  // reset so we wait another 4s before rotating again
  }

  const prev = $.learn().activeSpeaker
  if (_spotlightId !== prev) $.teach({ activeSpeaker: _spotlightId })
}

// ── camera toggle ─────────────────────────────────────────────────────────────

async function toggleCamera(target) {
  const { cameraOn, muted } = $.learn()
  const next = !cameraOn

  if (next) {
    if (_localStream) {
      // already have audio — add video track only
      try {
        const vs = await navigator.mediaDevices.getUserMedia({ video: videoConstraints() })
        vs.getVideoTracks().forEach(t => _localStream.addTrack(t))
      } catch { return }
    } else {
      _localStream = await getLocalStream(true)
      if (!_localStream) return
    }
    if (_localStream) _localStream.getAudioTracks().forEach(t => { t.enabled = !muted })
  } else {
    // stop only video; keep audio alive
    if (_localStream) _localStream.getVideoTracks().forEach(t => { t.stop(); _localStream.removeTrack(t) })
  }

  $.teach({ cameraOn: next })

  // replace/add tracks in all open peer connections
  if (_localStream) {
    for (const [, conn] of Object.entries(_connections)) {
      if (!conn.pc) continue
      const senders = conn.pc.getSenders()
      for (const track of _localStream.getTracks()) {
        const sender = senders.find(s => s.track?.kind === track.kind)
        if (sender) sender.replaceTrack(track).catch(() => {})
        else conn.pc.addTrack(track, _localStream)
      }
    }
  }
}

// ── init ──────────────────────────────────────────────────────────────────────

async function init(target) {
  connectSignal()
  linkState(tag, _boardId)
  setInterval(updateProximity, 2000)
  setInterval(updateSpeaker, 100)
  initDrag(target)
}

// ── render ────────────────────────────────────────────────────────────────────

$.draw(target => {
  if (target.innerHTML) return  // mount once, afterUpdate owns all changes
  init(target)

  // stamp static shell
  const hud = document.createElement('div')
  hud.className = 'hud'
  const bar = document.createElement('div')
  bar.className = 'bar'
  const spotlight = document.createElement('div')
  spotlight.className = 'spotlight'
  spotlight.style.display = 'none'
  const spotVideo = document.createElement('video')
  spotVideo.className = 'spotlight-video'
  spotVideo.autoplay = true; spotVideo.playsInline = true; spotVideo.muted = true
  spotlight.appendChild(spotVideo)

  // local tile — stamped once here, never touched by diffhtml
  const localTile = document.createElement('div')
  localTile.className = 'tile local'
  localTile.dataset.toggle = ''
  localTile.title = 'toggle call view'
  const localVideo = document.createElement('video')
  localVideo.className = 'local-video'
  localVideo.autoplay = true; localVideo.playsInline = true; localVideo.muted = true
  localVideo.style.cssText = 'width:100%;height:100%;object-fit:cover;display:none;pointer-events:none'
  const localIcon = document.createElement('sl-icon')
  localIcon.setAttribute('name', 'camera')
  localIcon.className = 'cam-placeholder'
  localIcon.style.pointerEvents = 'none'
  localTile.appendChild(localVideo)
  localTile.appendChild(localIcon)

  bar.appendChild(localTile)
  hud.appendChild(bar)
  hud.appendChild(spotlight)
  target.appendChild(hud)
}, { afterUpdate })

function afterUpdate(target) {
  const { muted, cameraOn, nearbyCount, activeSpeaker, expanded, devicePicker } = $.learn()
  const hud = target.querySelector('.hud')
  const bar = target.querySelector('.bar')
  if (!hud || !bar) return

  // hud visibility
  hud.classList.toggle('visible', nearbyCount > 0 || cameraOn)

  // local tile: minimized → show spotlight stream; expanded → show self
  const localVideo = target.querySelector('.local-video')
  const localIcon = target.querySelector('.cam-placeholder')
  const spotlightStream = !expanded && activeSpeaker ? (_connections[activeSpeaker]?.stream ?? null) : null
  const showFeed = cameraOn && !!_localStream
  const tileStream = spotlightStream ?? (showFeed ? _localStream : null)
  if (localVideo) {
    localVideo.style.display = tileStream ? 'block' : 'none'
    if (localVideo.srcObject !== tileStream) localVideo.srcObject = tileStream
  }
  if (localIcon) localIcon.style.display = tileStream ? 'none' : 'block'

  applyHudPos(target)

  // expanded controls + peer tiles
  let muteBtn = bar.querySelector('[data-mute]')
  let camBtn = bar.querySelector('[data-cam]')
  let countEl = bar.querySelector('.count')
  let dotEl = bar.querySelector('.dot')

  if (expanded) {
    if (!muteBtn) {
      muteBtn = document.createElement('button')
      muteBtn.dataset.mute = ''
      const micIcon = document.createElement('sl-icon')
      micIcon.setAttribute('name', 'mic')
      micIcon.style.pointerEvents = 'none'
      muteBtn.appendChild(micIcon)
      bar.appendChild(muteBtn)
    }
    muteBtn.className = muted ? 'off' : 'on'
    muteBtn.title = muted ? 'unmute' : 'mute'

    if (!camBtn) {
      camBtn = document.createElement('button')
      camBtn.dataset.cam = ''
      const camIcon = document.createElement('sl-icon')
      camIcon.setAttribute('name', 'camera')
      camIcon.style.pointerEvents = 'none'
      camBtn.appendChild(camIcon)
      bar.appendChild(camBtn)
    }
    camBtn.className = cameraOn ? 'on' : 'off'
    camBtn.title = cameraOn ? 'camera off' : 'camera on'

    if (nearbyCount > 0) {
      if (!countEl) { countEl = document.createElement('span'); countEl.className = 'count'; bar.appendChild(countEl) }
      countEl.textContent = nearbyCount
    } else if (countEl) countEl.remove()

    if (activeSpeaker) {
      if (!dotEl) { dotEl = document.createElement('span'); dotEl.className = 'dot'; bar.appendChild(dotEl) }
    } else if (dotEl) dotEl.remove()

    // peer tiles — add missing, remove departed
    const peerIds = new Set(Object.keys(_connections))
    bar.querySelectorAll('[data-peer]').forEach(el => {
      if (!peerIds.has(el.dataset.peer)) el.remove()
    })
    for (const [id, conn] of Object.entries(_connections)) {
      let tile = bar.querySelector(`[data-peer="${id}"]`)
      if (!tile) {
        tile = document.createElement('div')
        tile.className = 'tile'
        tile.dataset.peer = id
        const v = document.createElement('video')
        v.dataset.peerVideo = id
        v.autoplay = true; v.playsInline = true; v.muted = true
        v.style.cssText = 'width:100%;height:100%;object-fit:cover;display:block;pointer-events:none'
        tile.appendChild(v)
        bar.appendChild(tile)
      }
      const v = tile.querySelector('video')
      if (v && conn.stream && v.srcObject !== conn.stream) v.srcObject = conn.stream
    }
  } else {
    muteBtn?.remove(); camBtn?.remove(); countEl?.remove(); dotEl?.remove()
    bar.querySelectorAll('[data-peer]').forEach(el => el.remove())
  }

  // spotlight
  const spotlightEl = target.querySelector('.spotlight')
  if (spotlightEl) {
    spotlightEl.style.display = expanded ? 'block' : 'none'
    const sv = spotlightEl.querySelector('.spotlight-video')
    if (sv) {
      const stream = activeSpeaker ? (_connections[activeSpeaker]?.stream ?? null) : null
      if (sv.srcObject !== stream) sv.srcObject = stream
    }
  }

  // device picker popover
  let picker = hud.querySelector('.device-picker')
  if (devicePicker) {
    const devices = devicePicker === 'audio' ? _audioDevices : _videoDevices
    if (!picker) {
      picker = document.createElement('div')
      picker.className = 'device-picker'
      hud.insertBefore(picker, bar)
    }
    const selectedId = devicePicker === 'audio' ? _selectedAudioId : _selectedVideoId
    picker.innerHTML = `
      ${devices.length
        ? devices.map(d => `<button data-device-id="${d.deviceId}" data-device-kind="${d.kind}"
            class="${d.deviceId === selectedId ? 'active' : ''}"
          >${d.label || (devicePicker === 'audio' ? 'Microphone' : 'Camera')}</button>`).join('')
        : `<span class="picker-empty">${devicePicker === 'audio' ? 'no mics found' : 'no cameras found'}</span>`}
      <button data-picker-close class="picker-close">✕</button>
    `
  } else if (picker) {
    picker.remove()
  }
}

// ── controls ──────────────────────────────────────────────────────────────────

$.when('pointerdown', '[data-toggle]', e => {
  _dragActive = true
  _dragMoved = false
  _dragStartX = e.clientX
  _dragStartY = e.clientY
})

$.when('click', '[data-toggle]', () => {
  if (_dragMoved) { _dragMoved = false; return }
  $.teach({ expanded: !$.learn().expanded })
})

$.when('pointerdown', '[data-mute]', () => {
  _holdTimer = setTimeout(() => { _holdTimer = null; $.teach({ devicePicker: 'audio' }) }, 500)
})
$.when('pointerup', '[data-mute]', () => { clearTimeout(_holdTimer); _holdTimer = null })

$.when('click', '[data-mute]', async () => {
  if ($.learn().devicePicker) return
  const next = !$.learn().muted
  if (!next && !_localStream) {
    _localStream = await getLocalStream($.learn().cameraOn)
    if (!_localStream) return
    for (const [, conn] of Object.entries(_connections)) {
      if (!conn.pc) continue
      _localStream.getTracks().forEach(t => conn.pc.addTrack(t, _localStream))
    }
  }
  $.teach({ muted: next })
  if (_localStream) _localStream.getAudioTracks().forEach(t => { t.enabled = !next })
})

$.when('pointerdown', '[data-cam]', () => {
  _holdTimer = setTimeout(() => { _holdTimer = null; $.teach({ devicePicker: 'video' }) }, 500)
})
$.when('pointerup', '[data-cam]', () => { clearTimeout(_holdTimer); _holdTimer = null })

$.when('click', '[data-cam]', (e) => {
  if ($.learn().devicePicker) return
  toggleCamera(e.target.closest(tag))
})

$.when('click', '[data-device-id]', async e => {
  const btn = e.target.closest('[data-device-id]')
  await switchDevice(btn.dataset.deviceKind, btn.dataset.deviceId)
  $.teach({ devicePicker: null })
})

$.when('click', '[data-picker-close]', () => $.teach({ devicePicker: null }))

// ── styles ────────────────────────────────────────────────────────────────────

$.style(`
  & {
    position: fixed;
    top: 0.5rem;
    left: 0.5rem;
    z-index: 9000;
    pointer-events: none;
  }
  & .hud {
    display: none;
    flex-direction: column;
    gap: 0.5rem;
    pointer-events: auto;
  }
  & .hud.visible { display: flex; }

  & .bar {
    display: flex;
    flex-direction: row;
    align-items: center;
    gap: 0.5rem;
  }

  & .tile {
    width: 56px;
    height: 56px;
    flex-shrink: 0;
    background: rgba(0,0,0,.6);
    border-radius: 0.5rem;
    overflow: hidden;
    display: flex;
    align-items: center;
    justify-content: center;
  }
  & .tile.local {
    cursor: grab;
    outline: 2px solid rgba(255,255,255,.3);
    outline-offset: -2px;
  }
  & .tile.local:active { cursor: grabbing; }
  & .tile.local > * {
    pointer-events: none;
  }
  & .tile sl-icon {
    color: rgba(255,255,255,.5);
    font-size: 1.5rem;
    display: block;
  }
  & .tile video {
    width: 100%;
    height: 100%;
    object-fit: cover;
    display: block;
  }

  & button {
    background: rgba(0,0,0,.6);
    border: none;
    cursor: pointer;
    font-size: 1.1rem;
    line-height: 1;
    padding: 0;
    color: white;
    opacity: 1;
    transition: opacity 0.15s;
    width: 32px;
    height: 32px;
    border-radius: 0.5rem;
    display: flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
  }
  & button.off { opacity: 0.3; }

  & .count {
    color: rgba(255,255,255,.7);
    font-size: 0.65rem;
    font-family: monospace;
    background: rgba(0,0,0,.5);
    border-radius: 0.5rem;
    padding: 0.2rem 0.4rem;
  }
  & .dot {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: #4f4;
    flex-shrink: 0;
    animation: bc-pulse 1s ease-in-out infinite;
  }
  @keyframes bc-pulse {
    0%,100% { opacity: 1; }
    50% { opacity: 0.2; }
  }

  & .device-picker {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
    background: rgba(0,0,0,.85);
    border-radius: 0.5rem;
    padding: 0.4rem;
    min-width: 160px;
    max-width: 240px;
  }
  & .device-picker button {
    background: rgba(255,255,255,.07);
    border: none;
    color: rgba(255,255,255,.8);
    font-size: 0.7rem;
    padding: 0.35rem 0.6rem;
    border-radius: 0.35rem;
    cursor: pointer;
    text-align: left;
    width: auto;
    height: auto;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  & .device-picker button:hover { background: rgba(255,255,255,.15); }
  & .device-picker button.active { outline: 1px solid rgba(255,255,255,.4); }
  & .device-picker .picker-close {
    align-self: flex-end;
    color: rgba(255,255,255,.4);
    font-size: 0.6rem;
    padding: 0.2rem 0.4rem;
  }
  & .device-picker .picker-empty {
    color: rgba(255,255,255,.35);
    font-size: 0.65rem;
    padding: 0.3rem 0.5rem;
  }

  & .spotlight {
    background: rgba(0,0,0,.6);
    border-radius: 0.5rem;
    overflow: hidden;
    min-height: 120px;
    width: calc(56px * 3 + 0.5rem * 2);
  }
  & .spotlight-video {
    width: 100%;
    height: 100%;
    object-fit: cover;
    display: block;
  }
`)
