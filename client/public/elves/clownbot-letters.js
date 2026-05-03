import { Self } from '@plan98/types'

const tag = 'clownbot-letters'
const $ = Self(tag, { letters: [], selected: null, loading: true, view: 'list' })

function mdToHtml(src) {
  const lines = src.split('\n')
  let out = '', i = 0
  while (i < lines.length) {
    const l = lines[i]
    if (l.match(/^```/)) {
      out += '<pre><code>'; i++
      while (i < lines.length && !lines[i].match(/^```/))
        out += lines[i++].replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;') + '\n'
      out += '</code></pre>\n'; i++; continue
    }
    if (l.match(/^#{1,6}\s/)) {
      const hm = l.match(/^(#{1,6})\s+(.+)$/)
      out += `<h${hm[1].length}>${inline(hm[2])}</h${hm[1].length}>\n`; i++; continue
    }
    if (l.match(/^— [A-F0-9]/)) {
      out += `<p class="signoff">${inline(l)}</p>\n`; i++; continue
    }
    if (l.match(/^[*\-] /)) {
      out += '<ul>\n'
      while (i < lines.length && lines[i].match(/^[*\-] /))
        out += `  <li>${inline(lines[i++].replace(/^[*\-] /,''))}</li>\n`
      out += '</ul>\n'; continue
    }
    if (!l.trim()) { i++; continue }
    let p = ''
    while (i < lines.length && lines[i].trim() && !lines[i].match(/^[#`>*\-]|^— /))
      p += lines[i++] + ' '
    if (p.trim()) out += `<p>${inline(p.trim())}</p>\n`
    else i++
  }
  return out
}

function inline(s) {
  return s
    .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/\*([^*\n]+)\*/g, '<em>$1</em>')
    .replace(/_([^_\n]+)_/g, '<em>$1</em>')
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>')
}

function shortId(from) {
  return from ? from.slice(0, 8) : '????????'
}

$.draw(target => {
  const { letters, selected, loading, view } = $.learn()

  if (loading) return `<div class="loading">loading letters...</div>`

  const letter = selected !== null ? letters.find(l => l.num === selected) : null

  const listItems = letters.map(l => `
    <button class="letter-item ${selected === l.num ? 'active' : ''}" data-num="${l.num}">
      <span class="letter-num">${String(l.num).padStart(3, '0')}</span>
      <span class="letter-from">${shortId(l.from)}</span>
    </button>
  `).join('')

  const detail = letter ? `
    <button class="back-btn" data-back>← letters</button>
    <div class="letter-content">
      <div class="letter-header">
        <div class="letter-meta-from">from ${letter.from || 'unknown'}</div>
        ${letter.date ? `<div class="letter-meta-date">${letter.date}</div>` : ''}
      </div>
      <div class="letter-body">${mdToHtml(letter.body)}</div>
    </div>
  ` : `<div class="letter-empty">select a letter</div>`

  return `
    <div class="letters-layout ${view === 'detail' ? 'show-detail' : 'show-list'}">
      <nav class="letters-nav">
        <div class="nav-header">clownbot letters</div>
        ${listItems}
      </nav>
      <main class="letters-main">
        ${detail}
      </main>
    </div>
  `
})

function numFromHash() {
  const h = self.location.hash.slice(1)
  const n = parseInt(h, 10)
  return isNaN(n) ? null : n
}

function navigate(num, push = true) {
  const view = num !== null ? 'detail' : 'list'
  $.teach({ selected: num, view })
  const url = num !== null ? '#' + String(num).padStart(3, '0') : '#'
  if (push) self.history.pushState({ type: 'clownbot-letters', num }, '', url)
}

self.addEventListener('popstate', (e) => {
  const num = e.state?.type === 'clownbot-letters' ? e.state.num : numFromHash()
  $.teach({ selected: num, view: num !== null ? 'detail' : 'list' })
})

$.when('click', '[data-num]', e => {
  navigate(parseInt(e.target.closest('[data-num]').dataset.num, 10))
})

$.when('click', '[data-back]', () => {
  self.history.back()
})

fetch('/letters-manifest.json')
  .then(r => r.json())
  .then(letters => {
    const initial = numFromHash()
    $.teach({
      letters: letters.slice().reverse(),
      selected: initial !== null ? initial : letters.length ? letters[letters.length - 1].num : null,
      view: initial !== null ? 'detail' : 'list',
      loading: false,
    })
  })
  .catch(() => $.teach({ loading: false }))

$.style(`
  & {
    display: block;
    height: 100%;
    overflow: hidden;
    font-family: 'Courier New', Courier, monospace;
    background: #1d2021;
    color: #ebdbb2;
  }

  & .loading {
    padding: 2rem;
    color: #665c54;
    font-size: 0.85rem;
  }

  & .letters-layout {
    display: grid;
    grid-template-columns: 180px 1fr;
    height: 100%;
    overflow: hidden;
  }

  & .letters-nav {
    border-right: 1px solid #3c3836;
    overflow-y: auto;
    display: flex;
    flex-direction: column;
  }

  & .nav-header {
    padding: 0.75rem 0.75rem 0.5rem;
    font-size: 0.65rem;
    letter-spacing: 0.1em;
    color: #665c54;
    text-transform: uppercase;
    border-bottom: 1px solid #3c3836;
    flex-shrink: 0;
  }

  & .letter-item {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 2px;
    padding: 0.6rem 0.75rem;
    background: transparent;
    border: none;
    border-bottom: 1px solid #282828;
    color: #a89984;
    font-family: 'Courier New', Courier, monospace;
    font-size: 0.72rem;
    cursor: pointer;
    text-align: left;
    width: 100%;
  }

  & .letter-item:hover { background: #282828; color: #ebdbb2; }
  & .letter-item.active { background: #282828; color: #d79921; }

  & .letter-num {
    font-size: 0.65rem;
    color: #665c54;
  }

  & .letter-item.active .letter-num { color: #b57614; }

  & .letter-from {
    font-size: 0.72rem;
    letter-spacing: 0.04em;
  }

  & .letters-main {
    overflow-y: auto;
    max-width: 680px;
  }

  & .letter-content {
    padding: 2rem 2.5rem;
  }

  & .letter-empty {
    color: #504945;
    font-size: 0.85rem;
    font-style: italic;
    padding: 1rem 0;
  }

  & .letter-header {
    margin-bottom: 2rem;
    padding-bottom: 1rem;
    border-bottom: 1px solid #3c3836;
  }

  & .letter-meta-from {
    font-size: 0.72rem;
    color: #8ec07c;
    letter-spacing: 0.04em;
  }

  & .letter-meta-date {
    font-size: 0.65rem;
    color: #665c54;
    margin-top: 2px;
  }

  & .letter-body p {
    line-height: 1.7;
    margin: 0 0 1rem;
    font-size: 0.9rem;
    color: #d5c4a1;
  }

  & .letter-body h1,
  & .letter-body h2 {
    color: #ebdbb2;
    font-size: 1rem;
    margin: 1.5rem 0 0.5rem;
  }

  & .letter-body ul {
    margin: 0 0 1rem;
    padding-left: 1.25rem;
  }

  & .letter-body li {
    font-size: 0.9rem;
    color: #d5c4a1;
    line-height: 1.7;
    margin-bottom: 0.25rem;
  }

  & .letter-body code {
    background: #282828;
    color: #8ec07c;
    padding: 1px 4px;
    border-radius: 2px;
    font-size: 0.85em;
  }

  & .letter-body pre {
    background: #282828;
    padding: 1rem;
    border-radius: 4px;
    overflow-x: auto;
    margin: 0 0 1rem;
  }

  & .letter-body pre code {
    background: none;
    padding: 0;
    font-size: 0.82rem;
    color: #8ec07c;
  }

  & .letter-body .signoff {
    color: #a89984;
    font-size: 0.82rem;
    margin-top: 2rem;
    font-style: italic;
  }

  & .back-btn {
    display: none;
    background: #1d2021;
    border: none;
    border-bottom: 1px solid #3c3836;
    color: #d79921;
    font-family: 'Courier New', Courier, monospace;
    font-size: 0.75rem;
    cursor: pointer;
    padding: 0.6rem 1.25rem;
    position: sticky;
    top: 0;
    width: 100%;
    text-align: left;
    z-index: 1;
  }

  @media (max-width: 600px) {
    & .letters-layout {
      grid-template-columns: 1fr;
      grid-template-rows: 1fr;
    }

    & .letters-layout.show-list .letters-nav { display: flex; }
    & .letters-layout.show-list .letters-main { display: none; }
    & .letters-layout.show-detail .letters-nav { display: none; }
    & .letters-layout.show-detail .letters-main { display: block; }

    & .back-btn { display: block; }

    & .letter-content {
      padding: 1.25rem;
    }
  }
`)
