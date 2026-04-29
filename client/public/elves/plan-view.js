import { Self } from '@plan98/types'

const tag = 'plan-view'
const $ = Self(tag, { sections: [], total: 0, done: 0, error: null })

async function loadPlan() {
  try {
    const res = await fetch('/plan.md')
    if (!res.ok) throw new Error(`/plan.md returned ${res.status}`)
    const text = await res.text()
    $.teach(parsePlan(text))
  } catch (err) {
    $.teach({ error: err.message })
  }
}

function parsePlan(text) {
  const lines = text.split('\n')
  const sections = []
  let current = null
  let total = 0, done = 0

  for (const line of lines) {
    const heading = line.match(/^#{1,3}\s+(.+)/)
    if (heading) {
      current = { heading: heading[1], items: [] }
      sections.push(current)
      continue
    }
    const item = line.match(/^[-*]\s+\[([x ])\]\s+(.+)/)
    if (item) {
      const checked = item[1] === 'x'
      if (!current) {
        current = { heading: null, items: [] }
        sections.push(current)
      }
      current.items.push({ checked, text: item[2] })
      total++
      if (checked) done++
    }
  }

  return { sections: sections.filter(s => s.items.length), total, done }
}

loadPlan()

$.draw(() => {
  const { sections, total, done, error } = $.learn()

  if (error) return `
    <style>${tag}{display:block;padding:1rem;color:#fb4934;font-family:'Recursive',monospace;background:#1d2021;height:100%;box-sizing:border-box}</style>
    <div>${escHtml(error)}</div>
  `

  const pct = total ? Math.round(done / total * 100) : 0

  const secHtml = sections.map(s => {
    const sDone = s.items.filter(i => i.checked).length
    const sTotal = s.items.length

    const items = s.items.map(i => `
      <div class="item ${i.checked ? 'checked' : 'open'}">
        <span class="cb">${i.checked ? '✓' : '○'}</span>
        <span class="text">${escHtml(i.text)}</span>
      </div>
    `).join('')

    return `
      <div class="section">
        ${s.heading ? `<div class="sec-head"><span>${escHtml(s.heading)}</span><span class="sec-pct">${sDone}/${sTotal}</span></div>` : ''}
        ${items}
      </div>
    `
  }).join('')

  return `
    <style>
      ${tag} {
        display: block;
        background: #1d2021;
        color: #ebdbb2;
        font-family: 'Recursive', monospace;
        font-variation-settings: 'MONO' 1;
        padding: 1.6rem;
        height: 100%;
        box-sizing: border-box;
        overflow-y: auto;
      }
      ${tag} h2 {
        color: #fabd2f;
        font-size: 1.2rem;
        letter-spacing: .15em;
        text-transform: uppercase;
        margin: 0 0 .8rem;
      }
      ${tag} .progress-bar {
        background: #3c3836;
        border-radius: 2px;
        height: 8px;
        overflow: hidden;
        margin-bottom: .4rem;
      }
      ${tag} .progress-fill {
        height: 100%;
        background: #b8bb26;
        border-radius: 2px;
        transition: width .3s;
      }
      ${tag} .progress-label {
        color: #928374;
        font-size: 1rem;
        margin-bottom: 1.6rem;
      }
      ${tag} .section { margin-bottom: 1.4rem; }
      ${tag} .sec-head {
        display: flex;
        justify-content: space-between;
        align-items: baseline;
        color: #83a598;
        font-size: 1rem;
        letter-spacing: .1em;
        text-transform: uppercase;
        margin-bottom: .5rem;
        padding-bottom: .3rem;
        border-bottom: 1px solid #3c3836;
      }
      ${tag} .sec-pct { color: #7c6f64; font-size: .9rem; }
      ${tag} .item {
        display: flex;
        gap: .6rem;
        align-items: flex-start;
        padding: .25rem 0;
        font-size: 1.1rem;
        line-height: 1.5;
      }
      ${tag} .cb { flex-shrink: 0; width: 1.4rem; }
      ${tag} .item.checked .cb { color: #b8bb26; }
      ${tag} .item.open .cb { color: #7c6f64; }
      ${tag} .item.checked .text { color: #928374; text-decoration: line-through; }
      ${tag} .item.open .text { color: #ebdbb2; }
    </style>

    <h2>plan</h2>
    <div class="progress-bar"><div class="progress-fill" style="width:${pct}%"></div></div>
    <div class="progress-label">${done} / ${total} — ${pct}%</div>
    ${secHtml}
  `
})

function escHtml(s) {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}
