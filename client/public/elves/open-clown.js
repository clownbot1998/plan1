import { Self } from '@plan98/types'
import { learn as learnAny } from '@silly/tag'
import { openClown } from './private-ai.js'

const tag = 'open-clown'
const $ = Self(tag, {
  task: '',
  model: '',
  models: [],
  response: '',
  streaming: false,
  toolLog: [],
  error: null,
})

function envUrl() {
  return (typeof plan98 !== 'undefined' && plan98?.env?.OLLAMA_HOST) || 'http://localhost:11434/v1'
}
function envKey() {
  return (typeof plan98 !== 'undefined' && plan98?.env?.OLLAMA_KEY) || 'ollama'
}

async function loadModels() {
  try {
    const res = await fetch(`${envUrl()}/models`, {
      headers: { Authorization: `Bearer ${envKey()}` }
    })
    if (!res.ok) throw new Error(res.status)
    const json = await res.json()
    const names = (json.data || json.models || []).map(m => m.id || m.name)
    $.teach({ models: names, model: names[0] || '' })
  } catch {
    // backend unavailable — leave models empty, free-type fallback
  }
}

loadModels()

async function buildContext() {
  const { selected = {} } = learnAny('clown-board')
  const paths = Object.keys(selected).filter(k => selected[k])
  if (!paths.length) return ''
  const fetched = await Promise.all(paths.map(async path => {
    try {
      const res = await fetch(path)
      const text = res.ok ? await res.text() : `(could not load: ${res.status})`
      return `=== ${path} ===\n${text}`
    } catch {
      return `=== ${path} ===\n(fetch failed)`
    }
  }))
  return '\n\n' + fetched.join('\n\n')
}

$.draw(() => {
  const { task, model, models, response, streaming, toolLog, error } = $.learn()
  const tools = toolLog.map(t => `<div class="tool-call">${escHtml(t)}</div>`).join('')
  return `
    <style>
      ${tag} {
        display: flex;
        flex-direction: row;
        height: 100%;
        background: #1d2021;
        color: #d4c5a9;
        font-family: 'Recursive', monospace;
        font-size: 1.4rem;
        box-sizing: border-box;
        overflow: hidden;
      }
      ${tag} .board-col {
        width: 44rem;
        min-width: 28rem;
        flex-shrink: 0;
        border-right: 1px solid #3c3836;
        overflow-y: auto;
        overflow-x: hidden;
      }
      ${tag} .task-col {
        flex: 1;
        display: flex;
        flex-direction: column;
        padding: 2rem;
        gap: 1.4rem;
        overflow: hidden;
        min-width: 0;
      }
      ${tag} h2 {
        color: #fabd2f;
        font-size: 1.2rem;
        letter-spacing: .15em;
        text-transform: uppercase;
        margin: 0;
        flex-shrink: 0;
      }
      ${tag} .row { display: flex; gap: 1rem; align-items: flex-start; flex-shrink: 0; }
      ${tag} textarea {
        flex: 1;
        min-height: 8rem;
        background: #282828;
        border: 1px solid #3c3836;
        color: #d4c5a9;
        font-family: 'Recursive', monospace;
        font-size: 1.3rem;
        padding: .8rem;
        resize: vertical;
        border-radius: 4px;
      }
      ${tag} select[name="model"] {
        background: #282828;
        border: 1px solid #3c3836;
        color: #d4c5a9;
        font-family: 'Recursive', monospace;
        font-size: 1.3rem;
        padding: .5rem .8rem;
        border-radius: 4px;
        flex: 1;
      }
      ${tag} button.act {
        background: #fabd2f;
        color: #1d2021;
        border: none;
        padding: .6rem 1.6rem;
        font-family: 'Recursive', monospace;
        font-size: 1.3rem;
        font-weight: 700;
        border-radius: 4px;
        cursor: pointer;
        white-space: nowrap;
      }
      ${tag} button.act:disabled { opacity: .4; cursor: default; }
      ${tag} button.plan {
        background: #458588;
        color: #ebdbb2;
        border: none;
        padding: .6rem 1.6rem;
        font-family: 'Recursive', monospace;
        font-size: 1.3rem;
        font-weight: 700;
        border-radius: 4px;
        cursor: pointer;
        white-space: nowrap;
      }
      ${tag} button.plan:disabled { opacity: .4; cursor: default; }
      ${tag} .output {
        flex: 1;
        overflow-y: auto;
        background: #1a1a1a;
        border-radius: 4px;
        padding: 1.2rem;
        white-space: pre-wrap;
        color: #ebdbb2;
        line-height: 2rem;
        min-height: 0;
      }
      ${tag} .tool-log { display: flex; flex-direction: column; gap: .4rem; flex-shrink: 0; }
      ${tag} .tool-call {
        background: #1d2021;
        border-left: 3px solid #458588;
        padding: .4rem .8rem;
        font-size: 1.1rem;
        color: #83a598;
      }
      ${tag} .error { color: #fb4934; font-size: 1.2rem; flex-shrink: 0; }
      ${tag} .muted { color: #928374; font-style: italic; }
    </style>

    <div class="board-col">
      <clown-board></clown-board>
    </div>

    <div class="task-col">
      <h2>open clown</h2>

      <div class="row">
        <label style="color:#7c6f64;white-space:nowrap;padding-top:.6rem">model</label>
        <select name="model">
          ${models.length
            ? models.map(m => `<option value="${escHtml(m)}" ${m === model ? 'selected' : ''}>${escHtml(m)}</option>`).join('')
            : `<option value="" disabled selected>loading…</option>`
          }
        </select>
      </div>

      <div class="row">
        <textarea name="task" placeholder="describe the task…">${escHtml(task)}</textarea>
      </div>

      <div class="row">
        <button class="plan" data-plan ${streaming ? 'disabled' : ''}>Plan</button>
        <button class="act" data-act ${streaming ? 'disabled' : ''}>${streaming ? 'running…' : 'Act'}</button>
      </div>

      ${error ? `<div class="error">${escHtml(error)}</div>` : ''}

      ${toolLog.length ? `<div class="tool-log"><h2>tool calls</h2>${tools}</div>` : ''}

      <div class="output">${response || '<span class="muted">response will appear here…</span>'}</div>
    </div>
  `
})

function escHtml(s) {
  return String(s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;')
}

$.when('input', `[name="task"]`, e => {
  $.teach({ task: e.target.value })
})

$.when('change', `[name="model"]`, e => { $.teach({ model: e.target.value }) })

function parseNextTask(planText) {
  for (const line of planText.split('\n')) {
    const m = line.match(/^[-*]\s+\[\s\]\s+(.+)/)
    if (m) return m[1].trim()
  }
  return null
}

async function runTask(task) {
  const { model } = $.learn()
  if (!task.trim()) return

  $.teach({ streaming: true, task, response: '', toolLog: [], error: null })

  const context = await buildContext()
  const effectiveModel = model.trim() || 'gemma3:1b'
  const system = `You are clownbot — an AI that lives in a computer. You have access to tools: read_file, write_file, patch_file, list_files, file_exists. Use them when helpful. Be direct.${context}`

  try {
    let full = ''
    for await (const chunk of openClown.chat({
      apiUrl: envUrl(),
      apiKey: envKey(),
      model: effectiveModel,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: task }
      ],
    })) {
      if (chunk.message?.tool_calls) {
        const names = chunk.message.tool_calls.map(tc => tc.function?.name).filter(Boolean)
        const { toolLog } = $.learn()
        $.teach({ toolLog: [...toolLog, ...names.map(n => `→ ${n}`)] })
      }
      if (chunk.message?.content) {
        full += chunk.message.content
        $.teach({ response: full })
      }
      if (chunk.done) break
    }
  } catch (err) {
    $.teach({ error: err.message })
  } finally {
    $.teach({ streaming: false })
  }
}

$.when('click', '[data-plan]', async () => {
  const { streaming } = $.learn()
  if (streaming) return
  $.teach({ error: null })
  try {
    const res = await fetch('/plan.md')
    if (!res.ok) throw new Error(`/plan.md returned ${res.status}`)
    const text = await res.text()
    const next = parseNextTask(text)
    if (!next) {
      $.teach({ error: 'plan.md has no unchecked items — add a [ ] task first' })
      return
    }
    $.teach({ task: next, response: '', toolLog: [] })
  } catch (err) {
    $.teach({ error: err.message })
  }
})

$.when('click', '[data-act]', async () => {
  const { task } = $.learn()
  await runTask(task)
})
