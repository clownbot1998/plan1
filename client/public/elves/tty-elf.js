import { Self } from '@plan98/types'

const tag = 'tty-elf'
const $ = Self(tag)

const ANSI = {
  'ArrowUp':   '\x1b[A',
  'ArrowDown': '\x1b[B',
  'Tab':       '\t',
  'ctrl-c':    '\x03',
}

function sendToTty(iframe, seq) {
  const win = iframe.contentWindow
  if (!win) return

  // xterm.js Terminal instance (ttyd exposes as `term`)
  const term = win.term || win.terminal
  if (term) {
    const core = term._core || term.core
    const svc = core && (core.coreService || core._coreService)
    if (svc && svc.triggerDataEvent) {
      svc.triggerDataEvent(seq, true)
      return
    }
    if (term.handler) { term.handler(seq); return }
    if (term.paste)   { term.paste(seq);   return }
  }

  // WebSocket fallback — ttyd input protocol: 0x01 prefix + data
  const socket = win.socket || win._socket || win.ws
  if (socket && socket.readyState === 1) {
    const buf = new Uint8Array([0x01, ...new TextEncoder().encode(seq)])
    socket.send(buf)
  }
}

$.draw(target => {
  const { src = '/shell/' } = $.learn()
  return `
    <style>
      ${tag} {
        display: grid;
        grid-template-rows: 1fr auto;
        width: 100%;
        height: 100%;
      }
      ${tag} iframe {
        width: 100%;
        height: 100%;
        border: none;
        background: #000;
      }
      ${tag} .tty-controls {
        display: flex;
        gap: 4px;
        padding: 4px 8px;
        background: rgba(0,0,0,.9);
      }
      ${tag} .tty-key {
        flex: 1;
        padding: 6px 4px;
        background: rgba(255,255,255,.08);
        border: 1px solid rgba(255,255,255,.15);
        border-radius: 4px;
        color: rgba(255,255,255,.7);
        font-size: .75rem;
        cursor: pointer;
        touch-action: manipulation;
      }
      ${tag} .tty-key:active {
        background: rgba(255,255,255,.2);
      }
    </style>
    <iframe src="${src}" allow="clipboard-read; clipboard-write" credentialless></iframe>
    <div class="tty-controls">
      <button type="button" class="tty-key" data-key="ArrowUp" title="history up">&#x25B2;</button>
      <button type="button" class="tty-key" data-key="ArrowDown" title="history down">&#x25BC;</button>
      <button type="button" class="tty-key" data-key="Tab" title="autocomplete">tab</button>
      <button type="button" class="tty-key" data-key="ctrl-c" title="interrupt">ctrl+c</button>
    </div>
  `
})

$.when('click', '.tty-key', (event) => {
  const key = event.target.dataset.key
  const iframe = event.target.closest(tag).querySelector('iframe')
  if (!iframe) return
  const seq = ANSI[key]
  if (seq) sendToTty(iframe, seq)
})
