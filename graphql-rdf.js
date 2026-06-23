// graphql-rdf.js — vanilla GraphQL resolution over the bulletin-board Turtle store.
//
// The card IS the entity: <#uuid> is the subject, each elf namespace is a
// predicate (elf:State subjects), and a card's other-elf load-state hinges on it.
// This module is dependency-free and runs server-side. server.js owns the real
// GraphQL parser (npm:graphql `parse`) and WAS I/O; here we only walk the AST
// and the triples. The server stays zero-knowledge: encrypted literals
// (`bayun:…`) pass through untouched — only the client with the session decrypts.

// ── ttl literal (un)escaping — must mirror solid-utils.js ─────────────────────
function parseTtlStr(s) {
  return s
    .replace(/\\n/g, '\n').replace(/\\r/g, '\r').replace(/\\t/g, '\t')
    .replace(/\\"/g, '"').replace(/\\\\/g, '\\')
}
function ttlStr(s) {
  return String(s)
    .replace(/\\/g, '\\\\').replace(/"/g, '\\"')
    .replace(/\n/g, '\\n').replace(/\r/g, '\\r').replace(/\t/g, '\\t')
}
function tryJson(s) {
  if (s == null) return null
  try { return JSON.parse(s) } catch { return s }  // bayun:… ciphertext stays a string
}

// ── ttl → graph (no decryption; structure is plaintext by design) ─────────────
export function ttlToGraph(ttl) {
  const cards = {}
  const elfStates = []
  let subject = null, type = null, block = {}
  const ensure = (id) => (cards[id] ||= { id, fields: {}, elves: {}, linksTo: [] })

  const flush = () => {
    if (subject && type === 'card') Object.assign(ensure(subject).fields, block)
    else if (type === 'elfstate')  elfStates.push({ ...block })
    block = {}; subject = null; type = null
  }

  for (const raw of String(ttl).split('\n')) {
    const line = raw.trim()
    if (!line || line.startsWith('@') || line.startsWith('#')) continue

    // standalone traversal arc: <#src> ht:linksTo <#tgt> .
    const arc = line.match(/^<#([^>]+)>\s+ht:linksTo\s+<#([^>]+)>/)
    if (arc) { ensure(arc[1]).linksTo.push(arc[2]); continue }

    // new subject: <#id> a Type
    const subj = line.match(/^<#([^>]+)>\s+a\s+(\S+)/)
    if (subj) {
      flush()
      subject = subj[1]
      const t = subj[2].replace(/[;.].*$/, '').trim()
      if (t === 'bb:Card')       { type = 'card'; ensure(subject) }
      else if (t === 'elf:State') { type = 'elfstate' }
      else { subject = null; type = null }
      continue
    }
    if (!subject) continue

    const str = line.match(/^\s*(?:bb:|ht:|dcterms:|elf:)(\S+)\s+"((?:[^"\\]|\\.)*)"/)
    if (str) { block[str[1]] = parseTtlStr(str[2]); continue }
    const int = line.match(/^\s*(?:bb:|ht:)(\S+)\s+(-?\d+)\^\^xsd:integer/)
    if (int) { block[int[1]] = parseInt(int[2], 10); continue }
    if (line.endsWith('.')) flush()
  }
  flush()

  for (const st of elfStates) {
    if (!st.cardId || !st.namespace) continue
    ensure(st.cardId).elves[st.namespace] = tryJson(st.state)
  }
  return { cards }
}

// ── GraphQL AST → normalized field tree (dep-free; server passes us the AST) ──
function valueOf(node, vars) {
  switch (node.kind) {
    case 'Variable':     return vars?.[node.name.value]
    case 'IntValue':     return parseInt(node.value, 10)
    case 'FloatValue':   return parseFloat(node.value)
    case 'StringValue':  return node.value
    case 'BooleanValue': return node.value
    case 'NullValue':    return null
    case 'EnumValue':    return node.value
    case 'ListValue':    return node.values.map((v) => valueOf(v, vars))
    case 'ObjectValue':  return Object.fromEntries(node.fields.map((f) => [f.name.value, valueOf(f.value, vars)]))
    default:             return undefined
  }
}
function fieldTree(sel, vars) {
  const args = {}
  for (const a of sel.arguments || []) args[a.name.value] = valueOf(a.value, vars)
  const children = (sel.selectionSet?.selections || []).map((s) => fieldTree(s, vars))
  return { name: sel.name.value, alias: sel.alias?.value || null, args, children }
}

// Returns { op: 'query'|'mutation'|'subscription', roots: [fieldTree…] }
export function parseOperation(doc, vars = {}) {
  const opDef = doc.definitions.find((d) => d.kind === 'OperationDefinition')
  if (!opDef) throw new Error('no operation in document')
  return {
    op: opDef.operation,
    roots: opDef.selectionSet.selections.map((s) => fieldTree(s, vars)),
  }
}

// ── read resolution ───────────────────────────────────────────────────────────
const SCALAR = new Set(['content', 'x', 'y', 'width', 'height', 'color', 'saga', 'created', 'placeholder'])

function projectCard(graph, card, children) {
  if (!card) return null
  if (!children.length) return { id: card.id }
  const out = {}
  for (const f of children) {
    const key = f.alias || f.name
    if (f.name === 'id')            out[key] = card.id
    else if (f.name === 'elf')      out[key] = card.elves[f.args.ns] ?? null   // one namespace
    else if (f.name === 'elves')    out[key] = card.elves                      // whole bag
    else if (f.name === 'linksTo')  out[key] = card.linksTo.map((t) => projectCard(graph, graph.cards[t], f.children)).filter(Boolean)
    else if (SCALAR.has(f.name))    out[key] = card.fields[f.name] ?? null
    else                            out[key] = card.fields[f.name] ?? null
  }
  return out
}

// Resolve one read root (card / cards) against the graph.
export function resolveRead(graph, root) {
  if (root.name === 'card')  return projectCard(graph, graph.cards[root.args.id], root.children)
  if (root.name === 'cards') return Object.values(graph.cards).map((c) => projectCard(graph, c, root.children))
  return null
}

// ── write resolution — upsert an elf:State block (LWW: one block per id×ns) ────
// `literal` is stored verbatim — the client encrypts (bayun:…) before sending,
// so the server never sees plaintext on encrypted deployments.
export function upsertElfState(ttl, id, ns, literal) {
  let out = String(ttl || '')

  // ensure the elf: prefix is declared (old boards predate it)
  if (!out.includes('@prefix elf:')) {
    const decl = '@prefix elf:     <https://plan98.net/vocab/elf#> .'
    if (out.includes('@prefix ht:')) out = out.replace(/(@prefix ht:[^\n]*\n)/, `$1${decl}\n`)
    else out = `${decl}\n${out}`
  }

  // remove any existing block for this (id, ns) — terminator is the placeholder line
  const esc = (s) => String(s).replace(/[.*+?^${}()|[\]\\-]/g, '\\$&')
  const re = new RegExp(`<#elf-${esc(id)}-${esc(ns)}>\\s+a\\s+elf:State[\\s\\S]*?bb:placeholder "true" \\.\\n?`, 'g')
  out = out.replace(re, '')

  const block = [
    `<#elf-${id}-${ns}> a elf:State ;`,
    `   elf:cardId "${ttlStr(id)}" ;`,
    `   elf:namespace "${ttlStr(ns)}" ;`,
    ...(literal ? [`   elf:state "${ttlStr(literal)}" ;`] : []),
    `   bb:placeholder "true" .`,
    '',
  ].join('\n')

  return out.replace(/\n*$/, '\n') + '\n' + block + '\n'
}
