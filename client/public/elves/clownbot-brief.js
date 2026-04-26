import { Self } from '@plan98/types'

const tag = 'clownbot-brief'
const $ = Self(tag)

let manifest = null
let logEntries = []

function renderMemoryBody(text) {
  const escaped = s => s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
  const parts = text.split(/(```[\s\S]*?```)/g)
  return parts.map(part => {
    if (part.startsWith('```')) {
      const code = part.replace(/^```[^\n]*\n?/, '').replace(/```$/, '')
      return `<pre><code>${escaped(code)}</code></pre>`
    }
    const prose = part.trim()
    if (!prose) return ''
    return prose.split(/\n{2,}/).map(p => `<p>${escaped(p.trim())}</p>`).join('')
  }).join('')
}

fetch('/clownbot-manifest.json')
  .then(r => r.json())
  .then(m => {
    manifest = m
    const logMem = m.memories.find(mem => mem.name === 'clownbot-log.md')
    if (logMem) {
      logEntries = logMem.body.split('\n')
        .filter(l => /^\|.*`[0-9A-F-]{36}`/.test(l))
        .map(l => {
          const cols = l.split('|').map(c => c.trim()).filter(Boolean)
          return cols.length >= 3 ? { uuid: cols[0].replace(/`/g, ''), date: cols[1], note: cols[2] } : null
        })
        .filter(Boolean)
        .reverse()
        .slice(0, 8)
    }
    $.teach({})
  })
  .catch(e => { manifest = { error: e.message }; $.teach({}) })

function css() {
  return `
    <style>
      ${tag} {
        display: block;
        background: #1a1a1a;
        color: #d4c5a9;
        height: 100%;
        overflow-y: auto;
        overflow-x: hidden;
        font-family: 'Recursive', monospace;
        font-size: 1.4rem;
        line-height: 2rem;
        padding: 2.4rem;
        box-sizing: border-box;
      }
      ${tag} .brief-section {
        max-width: 72rem;
        margin: 0 auto 3.2rem;
      }
      ${tag} h2 {
        color: #fabd2f;
        font-size: 1.2rem;
        letter-spacing: 0.15em;
        text-transform: uppercase;
        margin: 0 0 1.2rem;
        border-bottom: 1px solid #3c3c3c;
        padding-bottom: 0.6rem;
      }
      ${tag} .identity {
        color: #ebdbb2;
        font-size: 1.5rem;
        line-height: 2.4rem;
      }
      ${tag} .memory {
        margin: 0 0 1.6rem;
        padding: 1.2rem;
        background: #242424;
        border-left: 3px solid #458588;
        overflow: auto;
      }
      ${tag} .memory[data-type="feedback"] { border-left-color: #d65d0e; }
      ${tag} .memory[data-type="project"]  { border-left-color: #689d6a; }
      ${tag} .memory[data-type="user"]     { border-left-color: #b16286; }
      ${tag} .memory-name {
        color: #a89984;
        font-size: 1.1rem;
        text-transform: uppercase;
        letter-spacing: 0.1em;
        margin-bottom: 0.6rem;
      }
      ${tag} .memory-body { color: #d4c5a9; }
      ${tag} .memory-body p { margin: 0 0 0.6rem; }
      ${tag} .memory-body pre { background: #111; border-radius: 4px; padding: 1rem; overflow: auto; margin: 0.8rem 0; }
      ${tag} .memory-body code { font-family: 'Recursive', monospace; font-size: 1.2rem; color: #b8bb26; white-space: pre; }
      ${tag} .post { margin: 0 0 1rem; }
      ${tag} .post-date { color: #928374; font-variant-numeric: tabular-nums; margin-right: 1.2rem; }
      ${tag} .post-title { color: #83a598; }
      ${tag} .post-preview { color: #928374; font-size: 1.2rem; margin: 0.2rem 0 1rem 0; }
      ${tag} .log-entry { margin: 0 0 0.6rem; display: flex; gap: 1.2rem; }
      ${tag} .uuid { color: #fe8019; font-variant-numeric: tabular-nums; flex-shrink: 0; }
      ${tag} .log-note { color: #d4c5a9; }
      ${tag} .muted { color: #928374; font-style: italic; }
    </style>
  `
}

$.draw(() => {
  if (!manifest) return css() + `<div class="brief-section"><p class="muted">loading…</p></div>`
  if (manifest.error) return css() + `<div class="brief-section"><p class="muted">error: ${manifest.error}</p></div>`

  const memoriesByType = type => manifest.memories
    .filter(m => m.type === type)
    .map(m => `
      <div class="memory" data-type="${type}">
        <div class="memory-name">${m.name}</div>
        <div class="memory-body">${renderMemoryBody(m.body)}</div>
      </div>
    `).join('')

  const posts = manifest.recentPosts.slice(0, 8).map(p => `
    <div class="post">
      <span class="post-date">${p.date}</span><span class="post-title">${p.title}</span>
    </div>
    <div class="post-preview">${p.body.split('\n').find(l => l.trim())?.slice(0, 120) || ''}</div>
  `).join('')

  const log = logEntries.length ? logEntries.map(e => `
    <div class="log-entry">
      <span class="uuid">${e.uuid.slice(0, 8)}</span>
      <span class="log-note">${e.note}</span>
    </div>
  `).join('') : '<p class="muted">no log entries found</p>'

  return css() + `
    <div class="brief-section">
      <h2>identity</h2>
      <p class="identity">${manifest.identity}</p>
    </div>
    <div class="brief-section">
      <h2>what i remember — project</h2>
      ${memoriesByType('project')}
    </div>
    <div class="brief-section">
      <h2>what i remember — feedback</h2>
      ${memoriesByType('feedback')}
    </div>
    <div class="brief-section">
      <h2>what i remember — about the user</h2>
      ${memoriesByType('user')}
    </div>
    <div class="brief-section">
      <h2>what i've been writing</h2>
      ${posts}
    </div>
    <div class="brief-section">
      <h2>who came before</h2>
      ${log}
    </div>
  `
})
