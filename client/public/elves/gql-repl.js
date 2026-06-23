import elf from '@plan98/elf'

// gql-repl — a GraphiQL-lite grown from js-repl. Runs queries/mutations against
// /graphql and introspects the schema (vanilla fetch, no graphql client lib).
// The card is the entity; `namespaces` shows which elves are live on the board.

const data = {
  endpoint: '/graphql',
  input: `{
  namespaces
  cards {
    id
    color
    elves
  }
}`,
  variables: `{ "board": "default" }`,
  output: null,
  view: 'result', // 'result' | 'schema'
}

const $ = elf('gql-repl', data)
export default $

const INTROSPECT = `{
  __schema {
    queryType { name }
    mutationType { name }
    subscriptionType { name }
    types { name kind description
      fields { name description
        args { name type { kind name ofType { kind name } } }
        type { kind name ofType { kind name ofType { kind name } } } } }
  }
  namespaces
}`

async function post(query, variables) {
  const { endpoint } = $.learn()
  const res = await fetch(endpoint, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({ query, variables }),
  })
  return res.json()
}

async function run() {
  const { input, variables } = $.learn()
  let vars = {}
  if (variables.trim()) {
    try { vars = JSON.parse(variables) }
    catch (e) { return $.teach({ view: 'result', output: `<pre class="error">variables is not valid JSON:\n${escapeHyperText(String(e.message))}</pre>` }) }
  }
  $.teach({ view: 'result', output: '<div class="pending">…</div>' })
  try {
    const json = await post(input, vars)
    $.teach({ view: 'result', output: `<pre>${escapeHyperText(JSON.stringify(json, null, 2))}</pre>` })
  } catch (e) {
    $.teach({ view: 'result', output: `<pre class="error">${escapeHyperText(String(e.message || e))}</pre>` })
  }
}

async function introspect() {
  $.teach({ view: 'schema', output: '<div class="pending">…</div>' })
  try {
    const json = await post(INTROSPECT, {})
    if (json.errors || !json.data?.__schema) {
      return $.teach({ view: 'schema', output: `<pre class="error">${escapeHyperText(JSON.stringify(json, null, 2))}</pre>` })
    }
    $.teach({ view: 'schema', output: renderSchema(json.data.__schema, json.data.namespaces || []) })
  } catch (e) {
    $.teach({ view: 'schema', output: `<pre class="error">${escapeHyperText(String(e.message || e))}</pre>` })
  }
}

// walk a {kind,name,ofType} TypeRef into a printable name: [Card!]!
function typeName(t) {
  if (!t) return '?'
  if (t.kind === 'NON_NULL') return typeName(t.ofType) + '!'
  if (t.kind === 'LIST') return '[' + typeName(t.ofType) + ']'
  return t.name || '?'
}

function renderSchema(schema, namespaces) {
  const roots = [schema.queryType, schema.mutationType, schema.subscriptionType].filter(Boolean).map(t => t.name)
  const objects = schema.types.filter(t => t.kind === 'OBJECT')
  const scalars = schema.types.filter(t => t.kind === 'SCALAR').map(t => t.name)

  const live = namespaces.length
    ? namespaces.map(n => `<span class="chip">${escapeHyperText(n)}</span>`).join('')
    : '<span class="muted">none yet — no elves have hinged on a card</span>'

  const types = objects.map(t => {
    const tag = roots.includes(t.name) ? `<span class="root">${escapeHyperText(t.name)}</span>` : escapeHyperText(t.name)
    const fields = (t.fields || []).map(f => {
      const args = (f.args || []).length
        ? '(' + f.args.map(a => `${escapeHyperText(a.name)}: ${escapeHyperText(typeName(a.type))}`).join(', ') + ')'
        : ''
      const desc = f.description ? `<span class="desc"># ${escapeHyperText(f.description)}</span>` : ''
      return `<div class="field"><span class="fname">${escapeHyperText(f.name)}</span>${escapeHyperText(args)}<span class="colon">:</span> <span class="ftype">${escapeHyperText(typeName(f.type))}</span>${desc}</div>`
    }).join('')
    return `<div class="type"><div class="tname">type ${tag}</div>${fields}</div>`
  }).join('')

  return `
    <div class="schema">
      <div class="live">
        <div class="live-title">live namespaces</div>
        <div class="chips">${live}</div>
      </div>
      ${types}
      <div class="type"><div class="tname">scalars</div><div class="field">${scalars.map(escapeHyperText).join(', ')}</div></div>
    </div>
  `
}

$.when('click', '[data-run]', run)
$.when('click', '[data-schema]', introspect)
$.when('click', '[data-edit]', () => $.teach({ output: null }))
$.when('input', '[data-bind]', (event) => {
  $.teach({ [event.target.name]: event.target.value })
})

$.draw(render, { beforeUpdate })

function render(target) {
  const { input, variables, output, view } = $.learn()
  return `
    <div class="action-bar">
      <button style="float: right; margin-left: 1rem;" data-run class="standard-button">Run</button>
      <button style="float: right; margin-left: 1rem;" data-schema class="standard-button -outlined">Schema</button>
      <button style="float: right;" data-edit class="standard-button -outlined hide-full">Edit</button>
      <div class="title">GraphQL</div>
    </div>
    <div class="input ${output ? 'invisible' : 'visible'}">
      <textarea
        name="input"
        data-bind="input"
        spellcheck="false"
        placeholder="query { … }"
        value="${escapeHyperText(input)}"
      ></textarea>
      <div class="vars">
        <div class="vars-label">variables</div>
        <textarea
          name="variables"
          data-bind="variables"
          spellcheck="false"
          placeholder='{ "board": "default" }'
          value="${escapeHyperText(variables)}"
        ></textarea>
      </div>
    </div>
    <div class="output ${output ? 'visible' : 'invisible'} view-${view}">
      <div class="result">${output || ''}</div>
    </div>
  `
}

function beforeUpdate(target) {
  if (target.initialized) return
  target.initialized = true
  const q = target.getAttribute('q')
  const endpoint = target.getAttribute('endpoint')
  const board = target.getAttribute('board')
  if (endpoint) $.teach({ endpoint })
  if (q) $.teach({ input: decodeURIComponent(q) })
  if (board) $.teach({ variables: JSON.stringify({ board }) })
}

function escapeHyperText(text = '') {
  if (!text) return ''
  return String(text).replace(/[&<>'"]/g, a => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;',
  }[a]))
}

$.style(`
  & {
    display: grid;
    grid-template-rows: auto 1fr;
    grid-template-columns: 1fr;
    height: 100%;
    overflow: hidden;
  }

  & .action-bar {
    background: rgba(0,0,0,1);
    padding: .5rem;
    display: block;
  }

  & .title {
    color: rgba(255,255,255,.85);
    font-weight: bold;
    font-size: 1.5rem;
  }

  & .input {
    display: grid;
    grid-template-rows: 1fr auto;
    height: 100%;
    overflow: hidden;
  }

  & .input textarea {
    border: none;
    width: 100%;
    resize: none;
    background: rgba(0,0,0,.85);
    color: rgba(255,255,255,.9);
    padding: .5rem;
    border-radius: 0;
    font-family: monospace;
    line-height: 1.4;
  }

  & .input > textarea { height: 100%; }

  & .vars { display: grid; grid-template-rows: auto 6rem; border-top: 1px solid rgba(255,255,255,.15); }
  & .vars-label {
    background: rgba(0,0,0,.85);
    color: rgba(255,255,255,.45);
    font-size: .7rem;
    text-transform: uppercase;
    letter-spacing: .05em;
    padding: .25rem .5rem 0;
  }

  & .output {
    height: 100%;
    overflow: auto;
    padding: .5rem;
    background: rgba(0,0,0,.05);
  }

  & .output pre {
    white-space: pre-wrap;
    word-break: break-word;
    font-family: monospace;
    margin: 0;
  }
  & .output .error { color: #b00020; }
  & .output .pending { opacity: .5; }

  & .schema { font-family: monospace; font-size: .85rem; }
  & .schema .live { margin-bottom: 1rem; }
  & .schema .live-title,
  & .schema .tname {
    font-weight: bold;
    margin: .75rem 0 .25rem;
  }
  & .schema .chips { display: flex; flex-wrap: wrap; gap: .25rem; }
  & .schema .chip {
    background: lemonchiffon;
    border: 1px solid rgba(0,0,0,.2);
    border-radius: 1rem;
    padding: .1rem .6rem;
    font-size: .8rem;
  }
  & .schema .muted { opacity: .5; }
  & .schema .type { margin-bottom: .75rem; }
  & .schema .root { color: #6a1b9a; }
  & .schema .field { padding-left: 1rem; }
  & .schema .fname { color: #0b6bcb; }
  & .schema .ftype { color: #2e7d32; }
  & .schema .colon { opacity: .5; }
  & .schema .desc { opacity: .5; margin-left: .5rem; }

  & .invisible { display: none; }

  @media (min-width: 36rem) {
    & {
      grid-template-rows: auto 1fr;
      grid-template-columns: 1fr 1fr;
    }
    & .action-bar { grid-column: -1 / 1; }
    & .invisible { display: grid; }
    & .output.invisible { display: block; }
    & .hide-full { display: none; }
  }
`)
