import { Self, PLAN98_NODE_ID, linkState, broadcastElf } from '@plan98/types'
import { learn } from '@plan98/elf'

const tag = 'board-call'
const $ = Self(tag, { muted: true, cameraOn: false, nearbyCount: 0, activeSpeaker: null, expanded: false, settingsOpen: false, volume: 1 })

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
let _proximityTimer = null
let _speakerTimer = null
let _torndown = false   // true once the DOM node backing this call has been removed

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
let _audioOutputDevices = []
let _selectedAudioId = null
let _selectedVideoId = null
let _selectedAudioOutputId = null

async function enumerateDevices() {
  try {
    const all = await navigator.mediaDevices.enumerateDevices()
    _audioDevices = all.filter(d => d.kind === 'audioinput')
    _videoDevices = all.filter(d => d.kind === 'videoinput')
    _audioOutputDevices = all.filter(d => d.kind === 'audiooutput')
  } catch {}
}

function escHtml(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])) }

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

// every peer's panner routes through one shared gain node instead of
// straight to destination, so the volume slider is one number instead of
// N per-peer knobs.
let _masterGain = null

// _audioCtx also gets lazily created by localAnalyser() (the mic-level
// meter) whenever settings opens before any peer has connected — gating
// _masterGain's creation on "_audioCtx doesn't exist yet" missed that
// case, leaving _masterGain null and panner.connect(_masterGain) throwing
// the moment a real peer's track arrived. gate on _masterGain itself
// instead, and share this between both callers.
function ensureAudioGraph() {
  if (!_audioCtx) _audioCtx = new AudioContext()
  if (!_masterGain) {
    _masterGain = _audioCtx.createGain()
    _masterGain.gain.value = $.learn().volume
    _masterGain.connect(_audioCtx.destination)
  }
  return _audioCtx
}

function setVolume(v) {
  $.teach({ volume: v })
  if (_masterGain) _masterGain.gain.value = v
}

// AudioContext.setSinkId is a newer (Chromium-only, as of this writing)
// spec addition — everything here already routes audio through Web Audio
// nodes rather than a <video>/<audio> element, so a per-element setSinkId
// wouldn't reach it anyway. Feature-detected; silently a no-op elsewhere.
async function setAudioOutput(deviceId) {
  _selectedAudioOutputId = deviceId
  if (_audioCtx?.setSinkId) {
    try { await _audioCtx.setSinkId(deviceId) } catch {}
  }
}

// ── mic level meter — a settings-panel-only readout, not the call's own
// speaker-detection analyser (that one's per-peer, this one's local) ──────────

const METER_SEGMENTS = 10
const METER_GREEN_SEGS = 6    // 0-5 green, 6-7 yellow, 8-9 red (clipping zone)
const METER_YELLOW_SEGS = 8

function meterSegClass(i) {
  if (i < METER_GREEN_SEGS) return 'seg-green'
  if (i < METER_YELLOW_SEGS) return 'seg-yellow'
  return 'seg-red'
}

let _localAnalyser = null   // { analyser, track } — rebuilt if the mic track changes
let _micMeterTimer = null

function localAnalyser() {
  const track = _localStream?.getAudioTracks()[0]
  if (!track) return null
  if (_localAnalyser?.track === track) return _localAnalyser.analyser
  ensureAudioGraph()
  const source = _audioCtx.createMediaStreamSource(_localStream)
  const analyser = _audioCtx.createAnalyser()
  analyser.fftSize = 256
  source.connect(analyser)  // analyser as a terminal node is enough to read data — no need to reach destination
  _localAnalyser = { analyser, track }
  return analyser
}

function startMicMeter(target) {
  stopMicMeter()
  const buf = new Uint8Array(128)
  _micMeterTimer = setInterval(() => {
    const el = target.querySelector('[data-mic-level]')
    if (!el) return
    const analyser = localAnalyser()
    const segs = el.querySelectorAll('.seg')
    if (!analyser) { segs.forEach(s => s.classList.remove('lit')); return }
    analyser.getByteFrequencyData(buf)
    const vol = buf.reduce((s, v) => s + v, 0) / buf.length / 255
    const lit = Math.round(Math.min(1, vol * 1.6) * METER_SEGMENTS)
    segs.forEach((s, i) => s.classList.toggle('lit', i < lit))
  }, 80)
}

function stopMicMeter() {
  clearInterval(_micMeterTimer)
  _micMeterTimer = null
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

  // reconnect after an unexpected drop — but not after teardownCall()'s own
  // intentional close, which nulls this handler out first so it never fires.
  _ws.onclose = () => { if (!_torndown) setTimeout(connectSignal, 3000) }
}

// real teardown, not just "stop rendering" — nothing here calls this
// automatically (plan98's elf framework has no unmount hook of its own),
// so it's wired to a real disconnectedCallback below. Without it, toggling
// a mounting elf (e.g. box-scores' chat button) off just removes the DOM
// node while the signaling socket, every peer connection, the mic/camera
// tracks, and both polling intervals kept running invisibly.
function teardownCall() {
  _torndown = true
  clearInterval(_proximityTimer); _proximityTimer = null
  clearInterval(_speakerTimer); _speakerTimer = null
  stopMicMeter()
  _localAnalyser = null
  if (_ws) { _ws.onclose = null; _ws.close(); _ws = null }
  for (const id of Object.keys(_connections)) closePeer(id)
  if (_localStream) { _localStream.getTracks().forEach(t => t.stop()); _localStream = null }
  if (_audioCtx) { _audioCtx.close().catch(() => {}); _audioCtx = null }
  _masterGain = null
  _roomPeers.clear()
  $.teach({ muted: true, cameraOn: false, nearbyCount: 0, activeSpeaker: null, expanded: false, settingsOpen: false })
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
    ensureAudioGraph()
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
      panner.connect(_masterGain)
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
  _torndown = false
  connectSignal()
  linkState(tag, _boardId)
  _proximityTimer = setInterval(updateProximity, 2000)
  _speakerTimer = setInterval(updateSpeaker, 100)
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
  const { muted, cameraOn, nearbyCount, activeSpeaker, expanded, settingsOpen } = $.learn()
  const hud = target.querySelector('.hud')
  const bar = target.querySelector('.bar')
  if (!hud || !bar) return

  // hud visibility
  hud.classList.toggle('visible', nearbyCount > 0 || cameraOn)

  // local tile always prefers the active speaker's video over your own —
  // previously that only held while minimized, so expanding/collapsing
  // swapped the tile from a peer's video straight to the camera-off icon
  // mid-toggle even though nothing about the call itself changed.
  const localVideo = target.querySelector('.local-video')
  const localIcon = target.querySelector('.cam-placeholder')
  const spotlightStream = activeSpeaker ? (_connections[activeSpeaker]?.stream ?? null) : null
  const showFeed = cameraOn && !!_localStream
  const tileStream = spotlightStream ?? (showFeed ? _localStream : null)
  if (localVideo) {
    localVideo.style.display = tileStream ? 'block' : 'none'
    if (localVideo.srcObject !== tileStream) localVideo.srcObject = tileStream
  }
  if (localIcon) localIcon.style.display = tileStream ? 'none' : 'block'

  applyHudPos(target)

  // expanded controls + peer tiles
  let settingsBtn = bar.querySelector('[data-settings]')
  let countEl = bar.querySelector('.count')
  let dotEl = bar.querySelector('.dot')

  if (expanded) {
    if (!settingsBtn) {
      settingsBtn = document.createElement('button')
      settingsBtn.dataset.settings = ''
      const gearIcon = document.createElement('sl-icon')
      gearIcon.setAttribute('name', 'gear')
      gearIcon.style.pointerEvents = 'none'
      settingsBtn.appendChild(gearIcon)
      bar.appendChild(settingsBtn)
    }
    // dimmed when muted — the one at-a-glance signal left now that mute
    // lives inside the settings panel instead of its own always-visible
    // button.
    settingsBtn.className = muted ? 'off' : 'on'
    settingsBtn.title = 'call settings'

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
    settingsBtn?.remove(); countEl?.remove(); dotEl?.remove()
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

  // settings modal — a real full-screen overlay, mounted on target (not
  // inside hud) so it isn't at the mercy of the hud's own visible/hidden
  // gate once it's open.
  let overlay = target.querySelector('.settings-overlay')
  if (settingsOpen) {
    if (!overlay) {
      overlay = document.createElement('div')
      overlay.className = 'settings-overlay'
      overlay.dataset.pickerClose = ''
      target.appendChild(overlay)
    }
    overlay.innerHTML = settingsPanelHtml()

    // camera preview — live local feed so picking a device is a "yes,
    // that one" rather than a guess from a label string.
    const preview = overlay.querySelector('[data-camera-preview]')
    if (preview) {
      const stream = cameraOn ? _localStream : null
      if (preview.srcObject !== stream) preview.srcObject = stream
    }

    // mic level meter only runs while the panel is actually open — no
    // point polling an analyser nobody can see. afterUpdate fires on
    // every $.teach in the whole elf (e.g. updateSpeaker's 100ms poll),
    // not just settings changes, so only (re)start it once per open.
    if (!_micMeterTimer) startMicMeter(overlay)
  } else if (overlay) {
    stopMicMeter()
    overlay.remove()
  }
}

// AudioContext.prototype.setSinkId is a recent, Chromium-only addition —
// feature-detected so the speaker row only appears where it could
// actually do anything.
const CAN_SET_SINK = typeof AudioContext !== 'undefined' && typeof AudioContext.prototype.setSinkId === 'function'

function settingsPanelHtml() {
  const { muted, cameraOn, volume } = $.learn()
  const deviceOptions = (devices, selectedId, emptyLabel, fallbackLabel) => devices.length
    ? devices.map(d => `<option value="${escHtml(d.deviceId)}" ${d.deviceId === selectedId ? 'selected' : ''}>${escHtml(d.label || fallbackLabel)}</option>`).join('')
    : `<option value="">${emptyLabel}</option>`

  return `
    <div class="settings-modal">
      <div class="action-wrapper">
        <button data-picker-close class="standard-button bias-generic -small -round" type="button"><sl-icon name="x-lg"></sl-icon></button>
      </div>
      <div class="settings-row">
        <span class="settings-label">Microphone</span>
        <button data-mute class="standard-toggle -small ${muted ? '' : 'active'}">${muted ? 'Off' : 'On'}</button>
      </div>
      <div class="settings-row">
        <span class="settings-label">Level</span>
        <div class="mic-level" data-mic-level>
          ${Array.from({ length: METER_SEGMENTS }, (_, i) => `<span class="seg ${meterSegClass(i)}"></span>`).join('')}
        </div>
      </div>
      <div class="settings-row">
        <span class="settings-label">Mic device</span>
        <select class="standard-input -small" data-audioinput>${deviceOptions(_audioDevices, _selectedAudioId, 'no mics found', 'Microphone')}</select>
      </div>
      <div class="settings-row">
        <span class="settings-label">Camera</span>
        <button data-cam class="standard-toggle -small ${cameraOn ? 'active' : ''}">${cameraOn ? 'On' : 'Off'}</button>
      </div>
      <div class="settings-row">
        <span class="settings-label">Camera device</span>
        <select class="standard-input -small" data-videoinput>${deviceOptions(_videoDevices, _selectedVideoId, 'no cameras found', 'Camera')}</select>
      </div>
      <div class="camera-preview-row">
        <video class="camera-preview" data-camera-preview autoplay playsinline muted></video>
        ${cameraOn ? '' : '<div class="camera-preview-empty">camera off</div>'}
      </div>
      <div class="settings-row">
        <span class="settings-label">Volume</span>
        <input class="standard-input -small" type="range" data-volume min="0" max="1" step="0.05" value="${volume}">
      </div>
      ${CAN_SET_SINK ? `
      <div class="settings-row">
        <span class="settings-label">Speaker</span>
        <select class="standard-input -small" data-audiooutput>${deviceOptions(_audioOutputDevices, _selectedAudioOutputId, 'no speakers found', 'Speaker')}</select>
      </div>` : ''}
    </div>
  `
}

// ── controls ──────────────────────────────────────────────────────────────────

$.when('pointerdown', '[data-toggle]', e => {
  // no preventDefault meant a drag over any host page's text (box-scores'
  // game grid, say) fired the browser's own text-selection instead of
  // just moving the tile — invisible on bulletin-board's own canvas
  // (nothing to select there) but obvious the moment this mounts
  // somewhere with real text underneath.
  e.preventDefault()
  _dragActive = true
  _dragMoved = false
  _dragStartX = e.clientX
  _dragStartY = e.clientY
})

$.when('click', '[data-toggle]', () => {
  if (_dragMoved) { _dragMoved = false; return }
  $.teach({ expanded: !$.learn().expanded })
})

$.when('click', '[data-settings]', async () => {
  const next = !$.learn().settingsOpen
  if (next) await enumerateDevices()  // labels only populate post-permission — refresh on open
  $.teach({ settingsOpen: next })
})
$.when('click', '[data-picker-close]', () => $.teach({ settingsOpen: false }))

$.when('click', '[data-mute]', async () => {
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

$.when('click', '[data-cam]', (e) => {
  toggleCamera(e.target.closest(tag))
})

$.when('change', '[data-audioinput]', async e => {
  if (e.target.value) await switchDevice('audioinput', e.target.value)
})
$.when('change', '[data-videoinput]', async e => {
  if (e.target.value) await switchDevice('videoinput', e.target.value)
})
$.when('change', '[data-audiooutput]', async e => {
  if (e.target.value) await setAudioOutput(e.target.value)
})
$.when('input', '[data-volume]', e => setVolume(parseFloat(e.target.value)))

// ── styles ────────────────────────────────────────────────────────────────────

$.style(`
  & {
    /* absolute, not fixed: fixed is relative to the viewport, so once
       bulletin-board is nested (e.g. inside dream-team inside
       my-dashboard) this HUD floated to the top-left of the whole page
       instead of the board. absolute is contained by bulletin-board's own
       position:relative root, same as the compass. */
    position: absolute;
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
    position: relative;
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
    user-select: none;
    touch-action: none;
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

  /* full-screen modal, not an anchored popover — pointer-events: auto
     since the & host is pointer-events: none by default (same reason
     .hud.visible needs it). position: fixed escapes the host's own
     position: absolute so this covers the real viewport regardless of
     where board-call itself is mounted. */
  & .settings-overlay {
    position: fixed;
    inset: 0;
    background: rgba(0,0,0,.85);
    display: flex;
    align-items: center;
    justify-content: center;
    pointer-events: auto;
    z-index: 9500;
  }
  & .settings-modal {
    position: relative;
    background: rgba(255,255,255,1);
    border-radius: 1rem;
    padding: 2.25rem 1rem 1rem;
    min-width: 240px;
    max-width: 320px;
    width: 90vw;
  }
  /* same wrapper plan98-modal's own close button uses (@plan98/modal —
     top:0/right:0, button itself unstyled beyond the shared
     standard-button look) rather than a bespoke close-button class. */
  & .action-wrapper {
    position: absolute;
    top: 0;
    right: 0;
    padding: 0.5rem;
    z-index: 2;
  }

  /* left label, right control — one row per setting */
  & .settings-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.75rem;
    margin-top: 0.75rem;
  }
  & .settings-row:first-of-type { margin-top: 0; }
  & .settings-label {
    color: rgba(0,0,0,.7);
    font-size: 0.85rem;
  }
  & .settings-row select,
  & .settings-row input,
  & .settings-row .standard-toggle {
    max-width: 150px;
  }

  & .mic-level {
    display: flex;
    gap: 2px;
    width: 150px;
  }
  & .mic-level .seg {
    flex: 1;
    height: 10px;
    border-radius: 1px;
    background: rgba(0,0,0,.12);
  }
  & .mic-level .seg.lit.seg-green  { background: mediumseagreen; }
  & .mic-level .seg.lit.seg-yellow { background: goldenrod; }
  & .mic-level .seg.lit.seg-red    { background: firebrick; }

  & .camera-preview-row {
    position: relative;
    margin-top: 0.75rem;
    width: 100%;
    aspect-ratio: 16 / 9;
    background: rgba(0,0,0,.08);
    border-radius: 0.5rem;
    overflow: hidden;
  }
  & .camera-preview {
    width: 100%;
    height: 100%;
    object-fit: cover;
    display: block;
  }
  & .camera-preview-empty {
    position: absolute;
    inset: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    color: rgba(0,0,0,.4);
    font-size: 0.8rem;
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

// plan98's own elf framework has no unmount/disconnect hook (confirmed by
// reading plan98.js — it only watches for nodes being ADDED via
// MutationObserver, never removed). The rest of this codebase's answer to
// that gap (was-video.js, v-log.js, plan98-camera.js) is a plain
// customElements.define alongside the elf, purely for a real
// disconnectedCallback — plan98's own draw()/afterUpdate machinery is
// untouched, this only adds real teardown when the tag leaves the DOM.
customElements.define(tag, class extends HTMLElement {
  disconnectedCallback() { teardownCall() }
})
