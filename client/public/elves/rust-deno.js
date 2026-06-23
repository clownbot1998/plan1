import { Self } from '@plan98/types'

const tag = 'rust-deno'
const $ = Self(tag, { lines: [], done: false, error: false })

let _es = null

function colorize(line) {
  if (/error(\[|\:)/.test(line)) return `<span class="ln-error">${esc(line)}</span>`
  if (/^warning/.test(line)) return `<span class="ln-warn">${esc(line)}</span>`
  if (/^\s*Compiling/.test(line)) return `<span class="ln-compile">${esc(line)}</span>`
  if (/^\s*Finished/.test(line)) return `<span class="ln-done">${esc(line)}</span>`
  if (/^\s*Running/.test(line)) return `<span class="ln-run">${esc(line)}</span>`
  return `<span class="ln-plain">${esc(line)}</span>`
}

function esc(s) {
  return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
}

$.draw(target => {
  const { lines, done, error } = $.learn()
  const html = lines.map(colorize).join('\n')
  const status = done
    ? `<div class="status done">✓ build complete</div>`
    : error
    ? `<div class="status error">✗ build error</div>`
    : `<div class="status running"><span class="pulse">⬤</span> compiling deno… (${lines.length} lines)</div>`

  if (!_es) connect()

  return `
    <div class="header">
      <h1>deno desktop patch — rust build</h1>
      ${status}
    </div>
    <pre class="log">${html || '<span class="ln-plain">connecting…</span>'}</pre>
  `
}, {
  afterUpdate(target) {
    const log = target.querySelector('.log')
    if (log) log.scrollTop = log.scrollHeight
  }
})

function connect() {
  if (_es) _es.close()
  _es = new EventSource('/build-log')
  _es.onmessage = e => {
    if (!e.data || e.data.trim() === '') return
    const newLines = e.data.split('\n').filter(l => l.trim())
    const { lines, done } = $.learn()
    if (done) return
    const nowDone = newLines.some(l => /Finished/.test(l))
    const nowError = newLines.some(l => /^error/.test(l))
    $.teach({ lines: [...lines, ...newLines], done: nowDone, error: nowError }, (s, p) => ({ ...s, ...p }))
  }
  _es.onerror = () => { _es = null }
}

$.style(`
  & {
    display: grid;
    grid-template-rows: auto 1fr;
    height: 100%;
    overflow: hidden;
    background: #0d0d0d;
    color: lemonchiffon;
    font-family: 'Recursive', monospace;
  }

  & .header {
    padding: 1rem 1.5rem 0.5rem;
    border-bottom: 1px solid #333;
    display: flex;
    align-items: baseline;
    gap: 1.5rem;
  }

  & h1 {
    margin: 0;
    font-size: 1rem;
    font-weight: 700;
    color: lemonchiffon;
  }

  & .status {
    font-size: 0.85rem;
    font-variant-settings: 'MONO' 1;
  }

  & .status.running { color: dodgerblue; }
  & .status.done { color: mediumseagreen; }
  & .status.error { color: tomato; }

  & .pulse {
    animation: rust-deno-pulse 1s ease-in-out infinite alternate;
    display: inline-block;
  }

  @keyframes rust-deno-pulse {
    from { opacity: 1; }
    to { opacity: 0.2; }
  }

  & .log {
    margin: 0;
    padding: 1rem 1.5rem;
    overflow-y: auto;
    font-size: 0.75rem;
    line-height: 1.5;
    white-space: pre-wrap;
    word-break: break-all;
  }

  & .ln-compile { color: dodgerblue; }
  & .ln-done { color: mediumseagreen; font-weight: bold; }
  & .ln-run { color: mediumpurple; }
  & .ln-warn { color: goldenrod; }
  & .ln-error { color: tomato; font-weight: bold; }
  & .ln-plain { color: #ccc; }
`)
