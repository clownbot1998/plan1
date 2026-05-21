import { anthropic } from './gg-claude.js'
import { openClown } from './private-ai.js'

const SYSTEM = `You are clownbot — an AI that lives in a computer called plan1. Always on 3-foot stilts. Be direct and concise.`

const agents = [
  {
    name: 'Claude',
    provider: 'anthropic',
    model: 'claude-sonnet-4-6',
    system: SYSTEM,
  },
  {
    name: 'Ollama',
    provider: 'ollama',
    model: 'gemma3:1b',
    system: SYSTEM,
  },
]

const state = {
  mode: null,
  agentIndex: null,
  messages: [],
}

function getProvider(provider) {
  if (provider === 'anthropic') return anthropic
  return openClown
}

export async function agent(data, { partial, done } = {}) {
  if (!data || state.mode === null) {
    state.mode = 'picker'
    state.messages = []
    return 'AGENTS:\n' + agents.map((a, i) => `[${i}] ${a.name}`).join('\n')
  }

  if (state.mode === 'picker') {
    const index = parseInt(data)
    if (!isNaN(index) && agents[index]) {
      state.agentIndex = index
      state.mode = 'chat'
      return `on the line with ${agents[index].name}`
    }
    return 'enter a number from the list'
  }

  if (state.mode === 'chat') {
    const ag = agents[state.agentIndex]
    const provider = getProvider(ag.provider)
    state.messages.push({ role: 'user', content: data })

    const context = [
      { role: 'system', content: ag.system },
      ...state.messages,
    ]

    let full = ''
    const stream = await provider.chat({
      model: ag.model,
      apiKey: plan98?.env?.ANTHROPIC_API_KEY || '',
      apiUrl: plan98?.env?.OLLAMA_HOST || '',
      messages: context,
      stream: true,
    })

    for await (const chunk of stream) {
      if (chunk.message?.content) {
        full += chunk.message.content
        if (partial) partial(full)
      }
      if (chunk.done) break
    }

    state.messages.push({ role: 'assistant', content: full })
    if (done) done(full)
    return full
  }
}
