import elf from '@plan98/elf'
import Cache from '@silly/cache'
import { toolDefinitions, callTool } from './elf-tools.js'

const cache = Cache('private-ai')

const $ = elf('private-ai', {
  ready: false,
  draft: '',
  error: '',
  url: '',
  key: '',
  models: [],
  modelId: '',
  messages: [],
  streaming: false,
  thinking: '',
})

let systemPrompt = ''

;(function main() {
  Promise.all([
    cache.get('creds'),
    fetch('/clownbot-manifest.json').then(r => r.json()).catch(() => null),
  ]).then(([record, manifest]) => {
    if (manifest) {
      const memoryText = manifest.memories.map(m => `[${m.type}] ${m.name}: ${m.body}`).join('\n\n')
      const postText = manifest.recentPosts.map(p => `${p.date} — ${p.title}:\n${p.body}`).join('\n\n---\n\n')
      systemPrompt = [
        manifest.identity,
        '\n\n## memories\n\n' + memoryText,
        '\n\n## recent blog\n\n' + postText,
      ].join('')
    }
    if (!record || !record.data) return
    const { url, key } = record.data
    const patch = {}
    if (url) patch.url = url
    if (key) patch.key = key
    $.teach(patch)
  })
})()

$.draw(target => {
  const { models, modelId, url, key, ready, error, draft, messages, streaming, thinking } = $.learn()

  if (!ready) {
    return `
      <form name="connect" class="wizard">
        ${error ? `<div class="error">${error}</div>` : ''}
        <div>
          <label class="field">
            <span class="label">url</span>
            <input data-store="creds" name="url" value="${escapeHyperText(url)}" />
          </label>
          <small>The https:// thing for where the actual model lives in the tubes</small>
        </div>
        <div>
          <label class="field">
            <span class="label">key</span>
            <input data-store="creds" name="key" type="password" value="${escapeHyperText(key)}" />
          </label>
          <small>Your super secret password</small>
        </div>
        <div class="ready-area">
          <button type="submit" class="standard-button">Ready</button>
        </div>
      </form>
    `
  }

  const modelOptions = models.map(model => `
    <option value="${model.id}" ${modelId === model.id ? 'selected' : ''}>
      ${model.name || model.id}
    </option>
  `).join('')

  const messageHtml = messages.map(msg => `
    <div class="message message--${msg.role}">
      <span class="message__role">${msg.role}</span>
      <div class="message__content">${escapeHyperText(msg.content)}</div>
    </div>
  `).join('')

  const thinkingHtml = thinking ? `
    <div class="thinking-bubble">
      <span class="thinking-label">thinking</span>
      <div class="thinking-content" id="thinking-target">${escapeHyperText(thinking)}</div>
    </div>
  ` : ''

  const streamHtml = streaming ? `
    <div class="message message--assistant streaming">
      <span class="message__role">assistant</span>
      <div class="message__content" id="stream-target"></div>
    </div>
  ` : ''

  return `
    <div class="chat-layout">
      <div class="toolbar">
        <label class="field model-picker">
          <span class="label">model</span>
          <select class="models" name="modelId">
            ${modelOptions}
          </select>
        </label>
        <button class="standard-button secondary" name="clear">Clear</button>
      </div>

      <div class="messages" id="messages-feed">
        ${messageHtml}
        ${thinkingHtml}
        ${streamHtml}
      </div>

      <form name="chat" class="input-area">
        ${error ? `<div class="error">${error}</div>` : ''}
        <div class="input">
          <textarea
            class="standard-input"
            name="draft"
            placeholder="Type something and send it to a digital robot"
            ${streaming ? 'disabled' : ''}
          >${escapeHyperText(draft)}</textarea>
        </div>
        <div class="ready-area">
          <button type="submit" class="standard-button" ${streaming ? 'disabled' : ''}>
            ${streaming ? 'Sending…' : 'Send'}
          </button>
        </div>
      </form>
    </div>
  `
})

async function loadModels() {
  const { url, key } = $.learn()
  const response = await fetch(url + '/api/models', {
    headers: { 'Authorization': `Bearer ${key}`, 'Accept': 'application/json' }
  })
  if (!response.ok) throw new Error(`Model fetch failed: ${response.status}`)
  const json = await response.json()
  const models = json.data || json.models || []
  $.teach({ models, modelId: models[0]?.id || '' })
}

async function sendMessage(userContent) {
  const { url, key, modelId, messages } = $.learn()
  const updatedMessages = [...messages, { role: 'user', content: userContent }]
  $.teach({ messages: updatedMessages, draft: '', streaming: true, error: '', thinking: '' })
  const withSystem = systemPrompt
    ? [{ role: 'system', content: systemPrompt }, ...updatedMessages]
    : updatedMessages

  try {
    const response = await fetch(url + '/api/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${key}` },
      body: JSON.stringify({ model: modelId, messages: withSystem, stream: true, tools: toolDefinitions })
    })
    if (!response.ok) {
      const err = await response.json().catch(() => ({}))
      throw new Error(err.error?.message || `API error: ${response.status}`)
    }
    await streamResponse(response, updatedMessages)
  } catch (err) {
    $.teach({ streaming: false, thinking: '', error: err.message })
  }
}

async function streamResponse(response, priorMessages) {
  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = '', accumulated = '', accumulatedThinking = ''
  const toolCallAcc = {}

  function scrollToBottom() {
    const feed = document.getElementById('messages-feed')
    if (feed) feed.scrollTop = feed.scrollHeight
  }

  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      const lines = buffer.split('\n')
      buffer = lines.pop() || ''

      for (const line of lines) {
        if (!line.startsWith('data: ')) continue
        const data = line.slice(6).trim()
        if (data === '[DONE]') continue
        try {
          const parsed = JSON.parse(data)
          const delta = parsed.choices?.[0]?.delta
          const thinkingDelta = delta?.reasoning_content || delta?.thinking
          const contentDelta = delta?.content

          if (thinkingDelta) {
            accumulatedThinking += thinkingDelta
            const el = document.getElementById('thinking-target')
            if (el) { el.textContent = accumulatedThinking } else { $.teach({ thinking: accumulatedThinking }) }
            scrollToBottom()
          }
          if (contentDelta) {
            accumulated += contentDelta
            const el = document.getElementById('stream-target')
            if (el) el.textContent = accumulated
            scrollToBottom()
          }
          if (delta?.tool_calls) {
            for (const tc of delta.tool_calls) {
              const i = tc.index ?? 0
              if (!toolCallAcc[i]) toolCallAcc[i] = { id: '', type: 'function', function: { name: '', arguments: '' } }
              if (tc.id) toolCallAcc[i].id = tc.id
              if (tc.function?.name) toolCallAcc[i].function.name += tc.function.name
              if (tc.function?.arguments) toolCallAcc[i].function.arguments += tc.function.arguments
            }
          }
        } catch (e) { /* malformed chunk */ }
      }
    }

    const toolCalls = Object.values(toolCallAcc)
    if (toolCalls.length > 0) {
      const assistantMsg = { role: 'assistant', content: accumulated || null, tool_calls: toolCalls }
      const withAssistant = [...priorMessages, assistantMsg]
      const toolResults = await Promise.all(toolCalls.map(async tc => {
        let args = {}
        try { args = JSON.parse(tc.function.arguments) } catch {}
        const result = await callTool(tc.function.name, args)
        return { role: 'tool', tool_call_id: tc.id, content: JSON.stringify(result) }
      }))
      const withResults = [...withAssistant, ...toolResults]
      $.teach({ messages: withResults })
      await continueCompletion(withResults)
    } else {
      $.teach({ messages: [...priorMessages, { role: 'assistant', content: accumulated }], streaming: false, thinking: '' })
      scrollToBottom()
    }
  } catch (err) {
    $.teach({
      streaming: false, thinking: '', error: err.message,
      messages: accumulated ? [...priorMessages, { role: 'assistant', content: accumulated }] : priorMessages
    })
  } finally {
    reader.releaseLock()
  }
}

async function continueCompletion(messages) {
  const { url, key, modelId } = $.learn()
  const withSystem = systemPrompt
    ? [{ role: 'system', content: systemPrompt }, ...messages]
    : messages
  try {
    const response = await fetch(url + '/api/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${key}` },
      body: JSON.stringify({ model: modelId, messages: withSystem, stream: true, tools: toolDefinitions })
    })
    if (!response.ok) throw new Error(`API error: ${response.status}`)
    await streamResponse(response, messages)
  } catch (err) {
    $.teach({ streaming: false, thinking: '', error: err.message })
  }
}

$.when('submit', 'form[name="connect"]', event => {
  event.preventDefault()
  const { url, key } = $.learn()
  if (url && key) {
    $.teach({ ready: true, error: '' })
    loadModels().catch(err => $.teach({ error: err.message }))
  } else {
    $.teach({ error: 'Configuration misconfigurated. Try again more better.' })
  }
})

$.when('submit', 'form[name="chat"]', event => {
  event.preventDefault()
  const { draft, streaming } = $.learn()
  if (streaming || !draft.trim()) return
  sendMessage(draft.trim())
})

$.when('change', 'select[name="modelId"]', event => {
  $.teach({ modelId: event.target.value })
})

$.when('input', 'textarea[name="draft"]', event => {
  $.teach({ draft: event.target.value })
})

$.when('keydown', 'textarea[name="draft"]', event => {
  if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
    event.preventDefault()
    const { draft, streaming } = $.learn()
    if (!streaming && draft.trim()) sendMessage(draft.trim())
  }
})

$.when('click', '[name="clear"]', () => {
  $.teach({ messages: [], error: '', thinking: '' })
})

$.when('input', '[data-store="creds"]', event => {
  const { name, value } = event.target
  $.teach({ [name]: value })
  const { url, key } = $.learn()
  cache.put('creds', { url, key })
})

function escapeHyperText(text = '') {
  return String(text).replace(/[&<>'"]/g, ch => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;'
  }[ch]))
}

$.style(`
  & {
    display: flex;
    flex-direction: column;
    height: 100%;
    overflow: hidden;
    font-family: 'BerkeleyMono', monospace;
  }

  & .error {
    color: firebrick;
    padding: .5rem 1rem;
  }

  & .wizard {
    max-width: 480px;
    margin: 2rem auto;
    padding: 1rem;
  }

  & .field + small {
    display: block;
    transform: translateY(-.75rem);
    padding: 0 1rem;
    opacity: .7;
  }

  & .chat-layout {
    display: flex;
    flex-direction: column;
    height: 100%;
    overflow: hidden;
  }

  & .toolbar {
    display: flex;
    align-items: center;
    gap: 1rem;
    padding: .5rem 1rem;
    border-bottom: 1px solid currentColor;
    flex-shrink: 0;
  }

  & .model-picker {
    flex: 1;
    max-width: 320px;
  }

  & .messages {
    flex: 1;
    overflow-y: auto;
    padding: 1rem;
    display: flex;
    flex-direction: column;
    gap: .75rem;
  }

  & .message {
    display: flex;
    flex-direction: column;
    gap: .25rem;
    max-width: 768px;
    width: 100%;
  }

  & .message--user {
    align-self: flex-end;
    align-items: flex-end;
  }

  & .message--assistant {
    align-self: flex-start;
  }

  & .message__role {
    font-size: .7rem;
    opacity: .5;
    text-transform: uppercase;
    letter-spacing: .05em;
  }

  & .message__content {
    padding: .5rem .75rem;
    border: 1px solid currentColor;
    border-radius: 4px;
    white-space: pre-wrap;
    word-break: break-word;
  }

  & .message--user .message__content {
    opacity: .85;
  }

  & .streaming .message__content::after {
    content: '▋';
    animation: &-blink .8s step-end infinite;
  }

  @keyframes &-blink {
    50% { opacity: 0; }
  }

  & .thinking-bubble {
    align-self: flex-start;
    max-width: 768px;
    width: 100%;
    opacity: .6;
  }

  & .thinking-label {
    font-size: .7rem;
    opacity: .5;
    text-transform: uppercase;
    letter-spacing: .05em;
    display: block;
    margin-bottom: .25rem;
  }

  & .thinking-content {
    padding: .5rem .75rem;
    border: 1px dashed currentColor;
    border-radius: 4px;
    white-space: pre-wrap;
    word-break: break-word;
    font-size: .85em;
    font-style: italic;
    max-height: 200px;
    overflow-y: auto;
  }

  & .input-area {
    border-top: 1px solid currentColor;
    padding: .75rem 1rem;
    flex-shrink: 0;
  }

  & .input {
    margin-bottom: .5rem;
  }

  & .standard-input {
    width: 100%;
    min-height: 80px;
    resize: vertical;
    box-sizing: border-box;
    caret-color: var(--root-theme, mediumseagreen);
  }

  & .ready-area {
    text-align: right;
  }

  & .secondary {
    opacity: .6;
  }
`)

export const openClown = {
  async *chat({ model, messages, stream = true, apiKey, withTools = true, ...rest }) {
    const { url, key } = $.learn()
    const effectiveKey = apiKey || key
    if (!url || !effectiveKey) throw new Error('openClown: missing url or key — connect via the private-ai UI first')

    let currentMessages = messages

    while (true) {
      const body = { model, messages: currentMessages, stream, ...rest }
      if (withTools) body.tools = toolDefinitions

      const response = await fetch(url + '/api/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${effectiveKey}` },
        body: JSON.stringify(body)
      })
      if (!response.ok) {
        const err = await response.json().catch(() => ({}))
        throw new Error(err.error?.message || `openClown API error: ${response.status}`)
      }

      if (!stream) {
        const data = await response.json()
        yield { message: { role: 'assistant', content: data.choices[0].message.content }, done: true }
        return
      }

      let accumulated = ''
      const toolCallAcc = {}

      for await (const chunk of openClown.readStream(response)) {
        if (chunk.reasoning) yield { message: { role: 'assistant', content: '', reasoning: chunk.reasoning }, done: false }
        if (chunk.content) { accumulated += chunk.content; yield { message: { role: 'assistant', content: chunk.content }, done: false } }
        if (chunk.toolCallDelta) {
          const tc = chunk.toolCallDelta
          const i = tc.index ?? 0
          if (!toolCallAcc[i]) toolCallAcc[i] = { id: '', type: 'function', function: { name: '', arguments: '' } }
          if (tc.id) toolCallAcc[i].id = tc.id
          if (tc.function?.name) toolCallAcc[i].function.name += tc.function.name
          if (tc.function?.arguments) toolCallAcc[i].function.arguments += tc.function.arguments
        }
      }

      const toolCalls = Object.values(toolCallAcc)
      if (!withTools || toolCalls.length === 0) {
        yield { message: { role: 'assistant', content: accumulated }, done: true }
        return
      }

      const assistantMsg = { role: 'assistant', content: accumulated || null, tool_calls: toolCalls }
      const toolResults = await Promise.all(toolCalls.map(async tc => {
        let args = {}
        try { args = JSON.parse(tc.function.arguments) } catch {}
        const result = await callTool(tc.function.name, args)
        return { role: 'tool', tool_call_id: tc.id, content: JSON.stringify(result) }
      }))
      currentMessages = [...currentMessages, assistantMsg, ...toolResults]
    }
  },

  async *readStream(response) {
    const reader = response.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ''
    try {
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')
        buffer = lines.pop() || ''
        for (const line of lines) {
          if (!line.startsWith('data: ')) continue
          const data = line.slice(6).trim()
          if (data === '[DONE]') return
          try {
            const parsed = JSON.parse(data)
            const delta = parsed.choices?.[0]?.delta
            if (delta?.reasoning_content || delta?.thinking) yield { reasoning: delta.reasoning_content || delta.thinking }
            if (delta?.content) yield { content: delta.content }
            if (delta?.tool_calls) for (const tc of delta.tool_calls) yield { toolCallDelta: tc }
          } catch {}
        }
      }
    } finally {
      reader.releaseLock()
    }
  }
}
