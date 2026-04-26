import { $, html } from '@silly/tag'

const tag = 'clownbot-brief'

function css() {
  return `
    <style>
      ${tag} {
        display: block;
        background: #1a1a1a;
        color: #d4c5a9;
        min-height: 100vh;
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
        margin: 0 0 1.6rem;
      }
      ${tag} .memory {
        margin: 0 0 1.6rem;
        padding: 1.2rem;
        background: #242424;
        border-left: 3px solid #458588;
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
      ${tag} .memory-body {
        white-space: pre-wrap;
        color: #d4c5a9;
      }
      ${tag} .post {
        margin: 0 0 1rem;
        display: flex;
        gap: 1.6rem;
        align-items: baseline;
      }
      ${tag} .post-date { color: #928374; flex-shrink: 0; font-variant-numeric: tabular-nums; }
      ${tag} .post-title { color: #83a598; }
      ${tag} .post-preview { color: #928374; font-size: 1.2rem; margin-left: 7rem; }
      ${tag} .log-entry {
        margin: 0 0 0.6rem;
        display: flex;
        gap: 1.2rem;
      }
      ${tag} .uuid { color: #fe8019; font-variant-numeric: tabular-nums; flex-shrink: 0; }
      ${tag} .log-note { color: #d4c5a9; }
      ${tag} .loading { color: #928374; font-style: italic; }
      ${tag} .error { color: #cc241d; }
    </style>
  `
}

async function loadBrief(target) {
  try {
    const res = await fetch('/clownbot-manifest.json')
    if (!res.ok) throw new Error('manifest not found')
    const manifest = await res.json()

    const logMem = manifest.memories.find(m => m.name === 'clownbot-log.md')
    const logEntries = logMem
      ? logMem.body.split('\n')
          .filter(l => /^\|.*`[0-9A-F-]{36}`/.test(l))
          .map(l => {
            const cols = l.split('|').map(c => c.trim()).filter(Boolean)
            return cols.length >= 3 ? { uuid: cols[0].replace(/`/g, ''), date: cols[1], note: cols[2] } : null
          })
          .filter(Boolean)
          .reverse()
          .slice(0, 8)
      : []

    $.teach({ manifest, logEntries, loaded: true })
  } catch (e) {
    $.teach({ error: e.message, loaded: true })
  }
}

$.draw(target => {
  const { manifest, logEntries, loaded, error } = $.learn()

  if (!loaded) return css() + `<div class="brief-section"><p class="loading">loading…</p></div>`
  if (error) return css() + `<div class="brief-section"><p class="error">error: ${error}</p></div>`

  const memoriesByType = (type) => manifest.memories
    .filter(m => m.type === type)
    .map(m => `
      <div class="memory" data-type="${type}">
        <div class="memory-name">${m.name}</div>
        <div class="memory-body">${m.body.slice(0, 400)}${m.body.length > 400 ? '…' : ''}</div>
      </div>
    `).join('')

  const posts = manifest.recentPosts.slice(0, 8).map(p => `
    <div class="post">
      <span class="post-date">${p.date}</span>
      <span class="post-title">${p.title}</span>
    </div>
    <div class="post-preview">${p.body.split('\n').find(l => l.trim())?.slice(0, 120) || ''}</div>
  `).join('')

  const log = logEntries.length ? logEntries.map(e => `
    <div class="log-entry">
      <span class="uuid">${e.uuid.slice(0, 8)}</span>
      <span class="log-note">${e.note}</span>
    </div>
  `).join('') : '<p class="loading">no log entries found</p>'

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

$.when('load', tag, async (event) => {
  $.teach({ loaded: false })
  loadBrief(event.target)
})
