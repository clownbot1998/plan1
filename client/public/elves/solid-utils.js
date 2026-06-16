import { Self } from '@plan98/types'
import { bayunCore, BayunCore, getSessionId } from './cyber-security.js'

const ENC_PREFIX = 'bayun:'

const $ = Self('solid-utils', {})

// ── Bayun encrypt / decrypt ───────────────────────────────────────────────────

export async function encryptLiteral(plainText) {
  const sessionId = getSessionId()
  if (!bayunCore || !sessionId) return String(plainText)
  try {
    const ct = await bayunCore.lockText({
      sessionId,
      text: String(plainText),
      encryptionPolicy: BayunCore.EncryptionPolicy.MEMBER,
      keyGenerationPolicy: BayunCore.KeyGenerationPolicy.DEFAULT,
    })
    return ct ? `${ENC_PREFIX}${ct}` : String(plainText)
  } catch { return String(plainText) }
}

export async function decryptLiteral(text) {
  if (!String(text).startsWith(ENC_PREFIX)) return text
  const sessionId = getSessionId()
  if (!bayunCore || !sessionId) return text
  try {
    return await bayunCore.unlockText({
      sessionId,
      lockedText: String(text).slice(ENC_PREFIX.length),
    }) ?? text
  } catch { return text }
}

// ── TTL serializer ────────────────────────────────────────────────────────────

function ttlStr(s) {
  return String(s)
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\n/g, '\\n')
    .replace(/\r/g, '\\r')
    .replace(/\t/g, '\\t')
}

export async function boardToTurtle(boardId, cards, edgeTypes) {
  const now = new Date().toISOString()
  const cardEntries = Object.entries(cards)

  const encContents = await Promise.all(
    cardEntries.map(([, c]) => encryptLiteral(c.text || ''))
  )

  const usedTypeIds = [...new Set(
    cardEntries.flatMap(([, c]) =>
      Object.values(c.links || {}).map(l => l.typeId).filter(Boolean)
    )
  )]
  const encLabels = {}
  await Promise.all(usedTypeIds.map(async (tid) => {
    encLabels[tid] = await encryptLiteral(edgeTypes[tid]?.label || tid)
  }))

  const out = [
    '@prefix xsd:     <http://www.w3.org/2001/XMLSchema#> .',
    '@prefix dcterms: <http://purl.org/dc/terms/> .',
    '@prefix bb:      <https://plan98.net/vocab/bulletin-board#> .',
    '@prefix ht:      <https://plan98.net/vocab/hypertext#> .',
    '',
    '<> a bb:Board ;',
    `   dcterms:identifier "${ttlStr(boardId)}" ;`,
    `   dcterms:modified "${now}"^^xsd:dateTime .`,
    '',
  ]

  cardEntries.forEach(([id, c], i) => {
    out.push(`<#${id}> a bb:Card ;`)
    out.push(`   bb:content "${ttlStr(encContents[i])}" ;`)
    out.push(`   bb:x ${Math.round(c.x || 0)}^^xsd:integer ;`)
    out.push(`   bb:y ${Math.round(c.y || 0)}^^xsd:integer ;`)
    out.push(`   bb:width ${Math.round(c.w || 200)}^^xsd:integer ;`)
    out.push(`   bb:height ${Math.round(c.h || 120)}^^xsd:integer ;`)
    out.push(`   bb:color "${ttlStr(c.color || 'lemonchiffon')}" .`)
    out.push('')
  })

  for (const [srcId, card] of cardEntries) {
    for (const [tgtId, link] of Object.entries(card.links || {})) {
      const et = edgeTypes[link.typeId]
      const linkId = `link-${srcId.slice(0, 8)}-${tgtId.slice(0, 8)}`
      out.push(`<#${linkId}> a ht:TypedLink ;`)
      out.push(`   ht:source <#${srcId}> ;`)
      out.push(`   ht:target <#${tgtId}> ;`)
      out.push(`   ht:linkLabel "${ttlStr(encLabels[link.typeId] || link.typeId || 'link')}" ;`)
      out.push(`   ht:linkColor "${ttlStr(et?.color || '#888888')}" .`)
      out.push('')
      out.push(`<#${srcId}> ht:linksTo <#${tgtId}> .`)
      out.push('')
    }
  }

  return out.join('\n')
}

export async function turtleToBoard(ttlString) {
  const lines = ttlString.split('\n')
  const cards = {}
  const links = []

  let subject = null, block = {}
  function flush() {
    if (!subject) return
    if (block.type === 'card') {
      cards[subject] = {
        text: '', x: 0, y: 0, w: 200, h: 120,
        color: 'lemonchiffon',
        links: {}, backlinks: {}, attachments: {},
        ...block,
      }
    } else if (block.type === 'link') {
      links.push(block)
    }
    block = {}; subject = null
  }

  for (const raw of lines) {
    const line = raw.trim()
    if (!line || line.startsWith('@')) continue

    const subjMatch = line.match(/^<#([^>]+)>\s+a\s+(\S+)/)
    if (subjMatch) {
      flush()
      subject = subjMatch[1]
      const typeToken = subjMatch[2].replace(/\s*;.*$/, '')
      block.type = typeToken.includes('Card') ? 'card' : typeToken.includes('TypedLink') ? 'link' : typeToken
      continue
    }

    if (!subject) continue

    const propMatch = line.match(/^\s*(bb:|ht:|dcterms:)(\S+)\s+"((?:[^"\\]|\\.)*)"\s*[.;]/)
    if (propMatch) {
      const key = propMatch[2]
      const val = propMatch[3].replace(/\\n/g, '\n').replace(/\\"/g, '"').replace(/\\\\/g, '\\')
      block[key] = val
      continue
    }
    const intMatch = line.match(/^\s*(bb:|ht:)(\S+)\s+(-?\d+)\^\^xsd:integer/)
    if (intMatch) { block[intMatch[2]] = parseInt(intMatch[3]); continue }

    const linkMatch = line.match(/^\s*(ht:source|ht:target)\s+<#([^>]+)>/)
    if (linkMatch) { block[linkMatch[1].replace('ht:', '')] = linkMatch[2]; continue }

    if (line.endsWith('.')) flush()
  }
  flush()

  await Promise.all(Object.values(cards).map(async (c) => {
    c.text = await decryptLiteral(c.content || '')
    delete c.content
  }))

  for (const l of links) {
    if (l.source && l.target && cards[l.source]) {
      const label = await decryptLiteral(l.linkLabel || '')
      cards[l.source].links[l.target] = { label, color: l.linkColor }
    }
  }

  return cards
}

export default $
