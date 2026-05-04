import { Self } from '@plan98/types'

const tag = 'tty-elf'
const $ = Self(tag, { ctrl: false, alt: false })

const BASE = {
  'ArrowLeft':  '\x1b[D',
  'ArrowDown':  '\x1b[B',
  'ArrowUp':    '\x1b[A',
  'ArrowRight': '\x1b[C',
  'Return':     '\r',
  'Escape':     '\x1b',
  'Tab':        '\t',
  'ShiftTab':   '\x1b[Z',
  '^C':         '\x03',
  '^I':         '\x09',
  '^S':         '\x13',
  '^Z':         '\x1a',
}

const CTRL_MOD = {
  'ArrowLeft':  '\x1b[1;5D',
  'ArrowDown':  '\x1b[1;5B',
  'ArrowUp':    '\x1b[1;5A',
  'ArrowRight': '\x1b[1;5C',
}

const ALT_MOD = {
  'ArrowLeft':  '\x1b[1;3D',
  'ArrowDown':  '\x1b[1;3B',
  'ArrowUp':    '\x1b[1;3A',
  'ArrowRight': '\x1b[1;3C',
}

function resolve(key, ctrl, alt) {
  if (ctrl && CTRL_MOD[key]) return CTRL_MOD[key]
  if (alt  && ALT_MOD[key])  return ALT_MOD[key]
  return BASE[key]
}

function sendToTty(iframe, seq) {
  const win = iframe.contentWindow
  if (!win) return

  const term = win.term || win.terminal
  if (term) {
    const core = term._core || term.core
    const svc = core && (core.coreService || core._coreService)
    if (svc && svc.triggerDataEvent) { svc.triggerDataEvent(seq, true); return }
    if (term.handler) { term.handler(seq); return }
    if (term.paste)   { term.paste(seq);   return }
  }

  const socket = win.socket || win._socket || win.ws
  if (socket && socket.readyState === 1) {
    socket.send(new Uint8Array([0x01, ...new TextEncoder().encode(seq)]))
  }
}

function afterUpdate(target) {
  if (target.parentElement?.tagName !== 'MAIN') return
  if (target._vvReady) return
  target._vvReady = true

  function fit() {
    const h = window.visualViewport ? window.visualViewport.height : window.innerHeight
    target.style.height = h + 'px'
  }

  function blockScroll(e) { e.preventDefault() }

  window.visualViewport?.addEventListener('resize', fit)
  window.visualViewport?.addEventListener('scroll', fit)
  document.addEventListener('touchmove', blockScroll, { passive: false })
  setInterval(fit, 250)
  fit()

  // inject into the iframe so scroll doesn't escape at xterm's boundaries
  const iframe = target.querySelector('iframe')
  if (iframe) {
    iframe.addEventListener('load', () => {
      const doc = iframe.contentDocument
      if (!doc) return
      const style = doc.createElement('style')
      style.textContent = `
        html, body { overscroll-behavior: none; touch-action: none; }
        .xterm-viewport { overscroll-behavior: contain; touch-action: pan-y; }
      `
      doc.head?.appendChild(style)
    })
  }
}

$.draw(target => {
  const { src = '/shell/', ctrl, alt } = $.learn()

  const sidebar = [
    { key: 'Escape',   label: 'esc' },
    { key: 'Tab',      label: 'tab' },
    { key: 'ctrl',     label: 'ctrl',  toggle: true, active: ctrl },
    { key: 'alt',      label: 'alt',   toggle: true, active: alt },
    { key: 'ShiftTab', label: '⇧tab' },
    { key: '^C',       label: '^c' },
    { key: '^I',       label: '^i' },
    { key: '^S',       label: '^s' },
    { key: '^Z',       label: '^z' },
  ]

  const arrows = [
    { key: 'ArrowLeft',  label: '&#x25C4;' },
    { key: 'ArrowDown',  label: '&#x25BC;' },
    { key: 'ArrowUp',    label: '&#x25B2;' },
    { key: 'ArrowRight', label: '&#x25BA;' },
    { key: 'Return',     label: '&#x23CE;' },
  ]

  return `
    <div class="tty-sidebar">
      ${sidebar.map(b => `
        <button type="button" class="tty-key${b.active ? ' -active' : ''}" data-key="${b.key}">${b.label}</button>
      `).join('')}
    </div>
    <iframe src="${src}" allow="clipboard-read; clipboard-write" credentialless></iframe>
    <div class="tty-bottom">
      ${arrows.map(b => `
        <button type="button" class="tty-key" data-key="${b.key}">${b.label}</button>
      `).join('')}
    </div>
  `
}, { afterUpdate })

$.when('click', '.tty-key', (event) => {
  const { key } = event.target.dataset
  const { ctrl, alt } = $.learn()

  if (key === 'ctrl') { $.teach({ ctrl: !ctrl }); return }
  if (key === 'alt')  { $.teach({ alt: !alt });   return }

  const iframe = event.target.closest(tag).querySelector('iframe')
  if (!iframe) return

  const seq = resolve(key, ctrl, alt)
  if (!seq) return

  sendToTty(iframe, seq)

  if (ctrl || alt) $.teach({ ctrl: false, alt: false })
})

$.style(`
  /* position: fixed on body kills iOS rubber-band scroll entirely */
  html:has(&),
  body:has(&) {
    position: fixed;
    inset: 0;
    width: 100%;
    height: 100%;
    overflow: hidden;
    overscroll-behavior: none;
    background: #000;
  }

  & {
    display: grid;
    grid-template-columns: auto 1fr;
    grid-template-rows: 1fr auto;
    grid-template-areas: "sidebar iframe" "sidebar bottom";
    width: 100%;
    height: 100%;
    overflow: hidden;
    overscroll-behavior: none;
    touch-action: none;
    background: #000;
  }

  /* standalone: fixed + top/left/right only — height owned by JS */
  main > & {
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
  }

  & iframe {
    grid-area: iframe;
    width: 100%;
    height: 100%;
    border: none;
    display: block;
  }

  & .tty-sidebar {
    grid-area: sidebar;
    display: flex;
    flex-direction: column;
    gap: 3px;
    padding: 4px 3px;
    padding-bottom: max(4px, env(safe-area-inset-bottom, 0px));
    background: rgba(0,0,0,.9);
    border-right: 1px solid rgba(255,255,255,.08);
  }

  & .tty-bottom {
    grid-area: bottom;
    display: flex;
    gap: 3px;
    padding: 3px 4px;
    padding-bottom: max(3px, env(safe-area-inset-bottom, 0px));
    background: rgba(0,0,0,.9);
    border-top: 1px solid rgba(255,255,255,.08);
  }

  & .tty-key {
    min-width: 44px;
    min-height: 36px;
    padding: 6px 8px;
    background: rgba(255,255,255,.08);
    border: 1px solid rgba(255,255,255,.12);
    border-radius: 4px;
    color: rgba(255,255,255,.65);
    font-size: .7rem;
    line-height: 1;
    cursor: pointer;
    touch-action: manipulation;
    white-space: nowrap;
    user-select: none;
    -webkit-user-select: none;
    display: flex;
    align-items: center;
    justify-content: center;
  }

  & .tty-bottom .tty-key {
    flex: 1;
  }

  & .tty-key.-active {
    background: rgba(255,255,255,.25);
    border-color: rgba(255,255,255,.5);
    color: #fff;
  }

  & .tty-key:active {
    background: rgba(255,255,255,.3);
  }
`)
