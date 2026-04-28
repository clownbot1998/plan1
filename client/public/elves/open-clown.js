import { Self } from '@plan98/types'
import { openClown } from './private-ai.js'

const tag = 'open-clown'
const $ = Self(tag, {
  task: '',
  model: '',
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

$.draw(target => {
  const { task, model, response, streaming, toolLog, error } = $.learn()
  const tools = toolLog.map(t => `<div class="tool-call">${escHtml(t)}</div>`).join('')
  return `
    <style>
      ${tag} {
        display: flex;
        flex-direction: column;
        height: 100%;
        background: #1a1a1a;
        color: #d4c5a9;
        font-family: 'Recursive', monospace;
        font-size: 1.4rem;
        box-sizing: border-box;
        padding: 2.4rem;
        gap: 1.6rem;
        overflow: hidden;
      }
      ${tag} h2 {
        color: #fabd2f;
        font-size: 1.2rem;
        letter-spacing: .15em;
        text-transform: uppercase;
        margin: 0;
      }
      ${tag} .row { display: flex; gap: 1rem; align-items: flex-start; }
      ${tag} textarea {
        flex: 1;
        min-height: 8rem;
        background: #242424;
        border: 1px solid #3c3c3c;
        color: #d4c5a9;
        font-family: 'Recursive', monospace;
        font-size: 1.3rem;
        padding: .8rem;
        resize: vertical;
        border-radius: 4px;
      }
      ${tag} input[name="model"] {
        background: #242424;
        border: 1px solid #3c3c3c;
        color: #d4c5a9;
        font-family: 'Recursive', monospace;
        font-size: 1.3rem;
        padding: .5rem .8rem;
        border-radius: 4px;
        width: 22rem;
      }
      ${tag} button.act {
        background: #fabd2f;
        color: #1a1a1a;
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
      ${tag} .output {
        flex: 1;
        overflow-y: auto;
        background: #111;
        border-radius: 4px;
        padding: 1.2rem;
        white-space: pre-wrap;
        color: #ebdbb2;
        line-height: 2rem;
        min-height: 0;
      }
      ${tag} .tool-log { display: flex; flex-direction: column; gap: .4rem; }
      ${tag} .tool-call {
        background: #1d2021;
        border-left: 3px solid #458588;
        padding: .4rem .8rem;
        font-size: 1.1rem;
        color: #83a598;
      }
      ${tag} .error { color: #fb4934; font-size: 1.2rem; }
      ${tag} .muted { color: #928374; font-style: italic; }
    </style>

    <h2>open clown — act on a task</h2>

    <div class="row">
      <label style="color:#928374;white-space:nowrap;padding-top:.6rem">model</label>
      <input name="model" value="${escHtml(model)}" placeholder="llama3.2" />
    </div>

    <div class="row">
      <textarea name="task" placeholder="describe the task…">${escHtml(task)}</textarea>
    </div>

    <div class="row">
      <button class="act" data-act ${streaming ? 'disabled' : ''}>${streaming ? 'running…' : 'Act'}</button>
    </div>

    ${error ? `<div class="error">${escHtml(error)}</div>` : ''}

    ${toolLog.length ? `<div class="tool-log"><h2>tool calls</h2>${tools}</div>` : ''}

    <div class="output">${response || '<span class="muted">response will appear here…</span>'}</div>
  `
})

function escHtml(s) {
  return String(s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;')
}

$.when('input', `[name="task"]`, e => {
  $.teach({ task: e.target.value })
})

$.when('input', `[name="model"]`, e => {
  $.teach({ model: e.target.value })
})

$.when('click', '[data-act]', async () => {
  const { task, model } = $.learn()
  if (!task.trim()) return

  $.teach({ streaming: true, response: '', toolLog: [], error: null })

  const effectiveModel = model.trim() || 'llama3.2'
  const system = `You are clownbot — an AI that lives in a computer. You have access to tools: read_file, write_file, patch_file, list_files, file_exists. Use them when helpful. Be direct.`

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
        $.teach(s => ({ ...s, toolLog: [...s.toolLog, ...names.map(n => `→ ${n}`)] }))
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
})
