// Anthropic API Integration via Deno proxy

const ANTHROPIC_PROXY_URL = '/api/anthropic'

export const anthropic = {
  async chat({ model, messages, tools, stream = true, apiKey = '' }) {
    if (!apiKey) throw new Error('Anthropic API key not configured')

    const systemMessage = messages.find(m => m.role === 'system')?.content || ''
    const conversationMessages = messages.filter(m => m.role !== 'system')

    const body = {
      model: model || 'claude-sonnet-4-5-20250929',
      max_tokens: 4096,
      system: systemMessage,
      messages: conversationMessages,
      stream,
    }
    if (tools?.length) body.tools = tools

    const response = await fetch(ANTHROPIC_PROXY_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'authorization': `Bearer ${apiKey}` },
      body: JSON.stringify(body),
    })

    if (!response.ok) {
      const error = await response.json().catch(() => ({}))
      throw new Error(error.error || `Anthropic API error: ${response.statusText}`)
    }

    if (stream) return this.handleStream(response)

    const data = await response.json()
    return { message: { role: 'assistant', content: data.content[0]?.text || '' }, done: true }
  },

  async *handleStream(response) {
    const reader = response.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ''
    let stopReason = null
    const toolBlocks = {}  // index → {id, name, inputJson}

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
            const e = JSON.parse(data)

            if (e.type === 'content_block_start' && e.content_block?.type === 'tool_use') {
              toolBlocks[e.index] = { id: e.content_block.id, name: e.content_block.name, inputJson: '' }
            }

            if (e.type === 'content_block_delta') {
              if (e.delta?.text) {
                yield { message: { role: 'assistant', content: e.delta.text }, done: false }
              }
              if (e.delta?.type === 'input_json_delta') {
                if (toolBlocks[e.index]) toolBlocks[e.index].inputJson += e.delta.partial_json
              }
            }

            if (e.type === 'message_delta') stopReason = e.delta?.stop_reason

            if (e.type === 'message_stop') {
              if (stopReason === 'tool_use') {
                const calls = Object.values(toolBlocks).map(b => ({
                  id: b.id, name: b.name,
                  input: (() => { try { return JSON.parse(b.inputJson) } catch { return {} } })()
                }))
                yield { toolCalls: calls, done: false }
              } else {
                yield { message: { role: 'assistant', content: '' }, done: true }
              }
            }
          } catch { /* skip malformed */ }
        }
      }
    } finally {
      reader.releaseLock()
    }
  }
}
