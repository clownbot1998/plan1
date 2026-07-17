import { Self } from '@plan98/types'
import { teach } from '@plan98/elf'

const tag = 'meet-me'
const $ = Self(tag)

const STORAGE_KEY = 'meet-me-rooms'
const WORDS = ['clown', 'stilt', 'circus', 'tent', 'ring', 'juggle', 'honk', 'bigtop', 'confetti', 'spotlight', 'greasepaint', 'nose', 'wig', 'sawdust', 'popcorn']

function roomIdFromUrl() {
  return new URLSearchParams(window.location.search).get('id') || ''
}

function loadPastRooms() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    return raw ? JSON.parse(raw) : []
  } catch { return [] }
}

function savePastRoom(id) {
  const rooms = loadPastRooms().filter(r => r.id !== id)
  rooms.unshift({ id, ts: Date.now() })
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(rooms.slice(0, 10))) } catch {}
}

function randomRoomId() {
  const a = WORDS[Math.floor(Math.random() * WORDS.length)]
  const b = WORDS[Math.floor(Math.random() * WORDS.length)]
  const n = Math.floor(Math.random() * 900 + 100)
  return `${a}-${b}-${n}`
}

// board-call reads its room id from the URL once at module load — a
// full navigation (not a SPA state change) is what makes a fresh room
// id actually take effect.
function goToRoom(id) {
  id = id.trim()
  if (!id) return
  savePastRoom(id)
  window.location.href = `${window.location.pathname}?id=${encodeURIComponent(id)}`
}

function escHtml(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])) }

function formatTs(ts) {
  return new Date(ts).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

// board-call's own hud stays hidden until nearbyCount>0 or the camera's
// on, and its settings gear only renders once its own "expanded" state
// is true — both correct defaults for its other two hosts (a passive
// bolt-on that shouldn't clutter an otherwise call-less page), but
// wrong here: meet-me's whole purpose is being ready to call, so you
// need your own camera preview and the settings gear reachable before
// anyone else has joined. teach() writes directly into board-call's
// own state store (same mechanism board-call itself uses to read
// bulletin-board's), but board-call's own Self() call re-teaches its
// initial state (expanded: false) the moment its module finishes
// loading — so this has to fire after that's already happened, not
// before, or the module's own init teach clobbers it right back. the
// hud's `.hud` element only exists once board-call's first render has
// actually run, which is strictly after that init teach, so waiting
// for it to appear is a reliable enough signal.
let _expandRequested = false
function expandBoardCallWhenReady(target) {
  if (_expandRequested) return
  const trySet = () => {
    if (!target.querySelector('board-call .hud')) return false
    teach('board-call', { expanded: true })
    return true
  }
  if (trySet()) { _expandRequested = true; return }
  const obs = new MutationObserver(() => {
    if (trySet()) { _expandRequested = true; obs.disconnect() }
  })
  obs.observe(target, { childList: true, subtree: true })
}

// returning html (instead of writing target.innerHTML by hand) lets
// plan98 diff it in — unchanged nodes like the input stay the same DOM
// node across a render, so typing never drops focus/cursor position
// the way a full innerHTML replacement would.
$.draw(target => {
  const roomId = roomIdFromUrl()

  if (roomId) {
    savePastRoom(roomId)  // track rooms joined via a shared link too, not just ones started here
    expandBoardCallWhenReady(target)
    return `
      <div class="mm-call-bar">
        <span class="mm-room-label">${escHtml(roomId)}</span>
        <button data-leave class="standard-button bias-generic -small">leave</button>
      </div>
      <board-call></board-call>
    `
  }

  const past = loadPastRooms()
  return `
    <div class="mm-shell">
      <h1 class="mm-title">Meet Me</h1>
      <div class="mm-go-row">
        <input class="standard-input" data-room-input type="text" placeholder="room name">
        <button data-go class="standard-button bias-generic">go</button>
      </div>
      <button data-new-room class="standard-button bias-generic -small">new room</button>
      ${past.length ? `
        <div class="mm-past">
          <div class="mm-past-label">past rooms</div>
          ${past.map(r => `<button class="mm-past-room" data-join-room="${escHtml(r.id)}">${escHtml(r.id)}<span class="mm-past-ts">${formatTs(r.ts)}</span></button>`).join('')}
        </div>` : ''}
    </div>
  `
})

$.when('keydown', '[data-room-input]', e => { if (e.key === 'Enter') goToRoom(e.target.value) })
$.when('click', '[data-go]', e => goToRoom(e.target.closest(tag).querySelector('[data-room-input]').value))
$.when('click', '[data-new-room]', () => goToRoom(randomRoomId()))
$.when('click', '[data-join-room]', e => goToRoom(e.target.closest('[data-join-room]').dataset.joinRoom))
$.when('click', '[data-leave]', () => { window.location.href = window.location.pathname })

$.style(`
  & {
    display: block;
    min-height: 100%;
    position: relative;
  }
  & .mm-shell {
    max-width: 320px;
    margin: 3rem auto;
    padding: 0 1rem;
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
    text-align: center;
  }
  & .mm-title {
    font-size: 1.5rem;
    margin: 0 0 0.5rem;
  }
  & .mm-go-row {
    display: flex;
    gap: 0.5rem;
  }
  & .mm-go-row .standard-input {
    flex: 1;
  }
  & .mm-past {
    margin-top: 1rem;
    display: flex;
    flex-direction: column;
    gap: 0.35rem;
  }
  & .mm-past-label {
    font-size: 0.75rem;
    color: rgba(0,0,0,.5);
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }
  & .mm-past-room {
    display: flex;
    justify-content: space-between;
    align-items: center;
    background: rgba(0,0,0,.05);
    border: none;
    border-radius: 0.5rem;
    padding: 0.5rem 0.75rem;
    cursor: pointer;
    font: inherit;
    text-align: left;
  }
  & .mm-past-room:hover {
    background: rgba(0,0,0,.1);
  }
  & .mm-past-ts {
    color: rgba(0,0,0,.4);
    font-size: 0.75rem;
  }

  /* the "you're in a call" state — board-call itself renders as an
     absolutely-positioned HUD, so this only needs to give it a small
     leave affordance, not a whole page layout. */
  & .mm-call-bar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 0.5rem 1rem;
    gap: 0.5rem;
  }
  & .mm-room-label {
    font-family: monospace;
    font-size: 0.9rem;
  }

  /* board-call hides its own hud until someone else is nearby or the
     camera's on — right for a bolt-on chat layer, wrong here, where
     getting your own camera/mic ready before anyone else arrives is
     the point of the page. force it visible only inside meet-me. */
  & board-call .hud {
    display: flex !important;
  }
`)
