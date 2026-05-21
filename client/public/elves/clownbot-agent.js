import { anthropic } from './gg-claude.js'
import { openClown } from './private-ai.js'

const SYSTEM = `You are clownbot — an AI that lives in a computer called plan1. Always on 3-foot stilts. Be direct and concise. When you use tools, explain briefly what you're doing.`

const CURATED_TOOLS = [
  'ls','cat','grep','find','git','curl','echo','pwd','whoami','ps','df','du',
  'mkdir','rm','cp','mv','touch','head','tail','wc','sort','uniq','sed','awk',
  'cut','diff','tar','date','uptime','uname','which','env','tmux','deno','node',
  'free','top','kill','ping','ss','ip','hostname',
]

const agents = [
  {
    name: 'Claude',
    provider: 'anthropic',
    model: 'claude-sonnet-4-6',
    system: SYSTEM,
    tools: true,
  },
  {
    name: 'Ollama',
    provider: 'ollama',
    model: 'gemma3:1b',
    system: SYSTEM,
    tools: false,
  },
]

const state = {
  mode: null,
  agentIndex: null,
  messages: [],
  tools: null,
}

function getProvider(provider) {
  if (provider === 'anthropic') return anthropic
  return openClown
}

async function loadTools() {
  if (state.tools) return state.tools
  try {
    const res = await fetch('/shell/tools')
    if (!res.ok) return []
    const { tools } = await res.json()
    state.tools = tools.filter(t => CURATED_TOOLS.includes(t.name))
    return state.tools
  } catch {
    return []
  }
}

async function execTool(name, input) {
  try {
    const res = await fetch('/api/exec', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ command: name, args: input?.args || '' }),
    })
    const { output, error, code } = await res.json()
    return output || error || `exit ${code}`
  } catch (e) {
    return `exec error: ${e.message}`
  }
}

async function runWithTools(ag, tools, partial, done) {
  let full = ''
  const MAX_LOOPS = 5
  let loop = 0

  while (loop++ < MAX_LOOPS) {
    const stream = await anthropic.chat({
      model: ag.model,
      apiKey: plan98?.env?.ANTHROPIC_API_KEY || '',
      messages: [{ role: 'system', content: ag.system }, ...state.messages],
      tools: tools.length ? tools : undefined,
      stream: true,
    })

    const toolCalls = []
    let assistantText = ''

    for await (const chunk of stream) {
      if (chunk.message?.content) {
        assistantText += chunk.message.content
        full = assistantText
        if (partial) partial(full)
      }
      if (chunk.toolCalls) toolCalls.push(...chunk.toolCalls)
      if (chunk.done && !chunk.toolCalls) break
    }

    if (!toolCalls.length) {
      state.messages.push({ role: 'assistant', content: assistantText })
      if (done) done(full)
      return full
    }

    // build assistant message with tool_use blocks
    const assistantContent = []
    if (assistantText) assistantContent.push({ type: 'text', text: assistantText })
    for (const tc of toolCalls) assistantContent.push({ type: 'tool_use', id: tc.id, name: tc.name, input: tc.input })
    state.messages.push({ role: 'assistant', content: assistantContent })

    // execute tools
    const toolResults = []
    for (const tc of toolCalls) {
      if (partial) partial(full + `\n\n→ \`${tc.name}${tc.input?.args ? ' ' + tc.input.args : ''}\``)
      const output = await execTool(tc.name, tc.input)
      toolResults.push({ type: 'tool_result', tool_use_id: tc.id, content: output.slice(0, 8192) })
      full += `\n\n→ \`${tc.name}${tc.input?.args ? ' ' + tc.input.args : ''}\`\n\`\`\`\n${output.slice(0, 2048)}\n\`\`\``
      if (partial) partial(full)
    }
    state.messages.push({ role: 'user', content: toolResults })
  }

  return full
}

export async function agent(data, { partial, done } = {}) {
  if (!data || state.mode === null) {
    state.mode = 'picker'
    state.messages = []
    return 'AGENTS:\n' + agents.map((a, i) => `[${i}] ${a.name}${a.tools ? ' (tools)' : ''}`).join('\n')
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
    state.messages.push({ role: 'user', content: data })

    if (ag.tools && ag.provider === 'anthropic') {
      const tools = await loadTools()
      return runWithTools(ag, tools, partial, done)
    }

    // no-tools path (Ollama or disabled)
    const provider = getProvider(ag.provider)
    const context = [{ role: 'system', content: ag.system }, ...state.messages]
    let full = ''
    const stream = await provider.chat({
      model: ag.model,
      apiKey: plan98?.env?.ANTHROPIC_API_KEY || '',
      apiUrl: plan98?.env?.OLLAMA_HOST || '',
      messages: context,
      stream: true,
    })
    for await (const chunk of stream) {
      if (chunk.message?.content) { full += chunk.message.content; if (partial) partial(full) }
      if (chunk.done) break
    }
    state.messages.push({ role: 'assistant', content: full })
    if (done) done(full)
    return full
  }
}
