import { Self } from '@plan98/types'
import { bayunCore, BayunCore, getSessionId } from './cyber-security.js'

const ENC_PREFIX = 'bayun:'
const $ = Self('solid-utils', {})

// ── Bayun encrypt / decrypt ───────────────────────────────────────────────────

export async function encryptLiteral(plainText, groupId) {
  const sessionId = getSessionId()
  if (!bayunCore || !sessionId) return String(plainText)
  try {
    const ct = await bayunCore.lockText({
      sessionId,
      text: String(plainText),
      encryptionPolicy:  groupId ? BayunCore.EncryptionPolicy.GROUP  : BayunCore.EncryptionPolicy.MEMBER,
      keyGenerationPolicy: groupId ? BayunCore.KeyGenerationPolicy.GROUP : BayunCore.KeyGenerationPolicy.DEFAULT,
      ...(groupId ? { groupId } : {}),
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

// ── TTL helpers ───────────────────────────────────────────────────────────────

function ttlStr(s) {
  return String(s)
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\n/g, '\\n')
    .replace(/\r/g, '\\r')
    .replace(/\t/g, '\\t')
}

function parseTtlStr(s) {
  return s
    .replace(/\\n/g, '\n')
    .replace(/\\r/g, '\r')
    .replace(/\\t/g, '\t')
    .replace(/\\"/g, '"')
    .replace(/\\\\/g, '\\')
}

// ── boardToTurtle — complete serialization ────────────────────────────────────
// Encrypted fields: bb:content (card text), bb:typeName (edge label),
//                   bb:record (attachment data)
// Plain fields: all structural refs, coords, colors, dates, IDs

export async function boardToTurtle(boardId, cards, edgeTypes, groupId) {
  const now = new Date().toISOString()
  const cardEntries = Object.entries(cards)

  // encrypt card text — use card's groupId if present, else MEMBER
  const encContents = await Promise.all(
    cardEntries.map(([, c]) => encryptLiteral(c.text || '', c.groupId))
  )

  // encrypt edge type names (MEMBER — structural, not group-scoped)
  const encTypeNames = {}
  await Promise.all(Object.entries(edgeTypes).map(async ([tid, et]) => {
    encTypeNames[tid] = await encryptLiteral(et.label || et.name || tid)
  }))

  // encrypt attachment records using same group as their card
  const encAttachRecords = {}
  for (const [cardId, card] of cardEntries) {
    for (const [aid, att] of Object.entries(card.attachments || {})) {
      const raw = att.record ? JSON.stringify(att.record) : ''
      encAttachRecords[aid] = raw ? await encryptLiteral(raw, card.groupId) : ''
    }
  }

  const out = [
    '@prefix xsd:     <http://www.w3.org/2001/XMLSchema#> .',
    '@prefix dcterms: <http://purl.org/dc/terms/> .',
    '@prefix bb:      <https://plan98.net/vocab/bulletin-board#> .',
    '@prefix ht:      <https://plan98.net/vocab/hypertext#> .',
    '',
    '<> a bb:Board ;',
    `   dcterms:identifier "${ttlStr(boardId)}" ;`,
    ...(groupId ? [`   bb:groupId "${ttlStr(groupId)}" ;`] : []),
    `   dcterms:modified "${now}"^^xsd:dateTime .`,
    '',
  ]

  // edge type nodes
  for (const [tid, et] of Object.entries(edgeTypes)) {
    out.push(`<#et-${tid}> a bb:EdgeType ;`)
    out.push(`   bb:typeId "${ttlStr(tid)}" ;`)
    out.push(`   bb:typeName "${ttlStr(encTypeNames[tid])}" ;`)
    out.push(`   bb:typeColor "${ttlStr(et.color || '#888888')}" .`)
    out.push('')
  }

  // card nodes
  cardEntries.forEach(([id, c], i) => {
    out.push(`<#${id}> a bb:Card ;`)
    out.push(`   bb:content "${ttlStr(encContents[i])}" ;`)
    out.push(`   bb:x ${Math.round(c.x || 0)}^^xsd:integer ;`)
    out.push(`   bb:y ${Math.round(c.y || 0)}^^xsd:integer ;`)
    out.push(`   bb:width ${Math.round(c.w || 200)}^^xsd:integer ;`)
    out.push(`   bb:height ${Math.round(c.h || 120)}^^xsd:integer ;`)
    out.push(`   bb:color "${ttlStr(c.color || 'lemonchiffon')}" ;`)
    if (c.createdAt) out.push(`   dcterms:created "${ttlStr(c.createdAt)}"^^xsd:dateTime ;`)
    if (c.saga)    out.push(`   bb:saga "${ttlStr(c.saga)}" ;`)
    if (c.groupId) out.push(`   bb:groupId "${ttlStr(c.groupId)}" ;`)
    out.push(`   bb:placeholder "true" .`)  // sentinel to close the block cleanly
    out.push('')
  })

  // attachment nodes (separate subjects, back-reference cardId)
  for (const [cardId, card] of cardEntries) {
    for (const [aid, att] of Object.entries(card.attachments || {})) {
      out.push(`<#att-${aid}> a bb:Attachment ;`)
      out.push(`   bb:attachId "${ttlStr(aid)}" ;`)
      out.push(`   bb:cardId "${ttlStr(cardId)}" ;`)
      out.push(`   bb:attachType "${ttlStr(att.type || '')}" ;`)
      if (att.fbId) out.push(`   bb:fbId "${ttlStr(att.fbId)}" ;`)
      if (encAttachRecords[aid]) out.push(`   bb:record "${ttlStr(encAttachRecords[aid])}" ;`)
      if (att.createdAt) out.push(`   dcterms:created "${ttlStr(att.createdAt)}"^^xsd:dateTime ;`)
      out.push(`   bb:placeholder "true" .`)
      out.push('')
    }
  }

  // link nodes (UUID linkId as subject)
  for (const [srcId, card] of cardEntries) {
    for (const [linkId, link] of Object.entries(card.links || {})) {
      out.push(`<#${linkId}> a ht:TypedLink ;`)
      out.push(`   bb:linkId "${ttlStr(linkId)}" ;`)
      out.push(`   ht:source <#${srcId}> ;`)
      out.push(`   ht:target <#${link.to}> ;`)
      if (link.fromDir) out.push(`   ht:fromDir "${ttlStr(link.fromDir)}" ;`)
      if (link.toDir)   out.push(`   ht:toDir "${ttlStr(link.toDir)}" ;`)
      if (link.typeId)  out.push(`   bb:typeId "${ttlStr(link.typeId)}" ;`)
      out.push(`   bb:placeholder "true" .`)
      out.push('')
      // direct traversal arc (graph stays traversable without decryption)
      out.push(`<#${srcId}> ht:linksTo <#${link.to}> .`)
      out.push('')
    }
  }

  return out.join('\n')
}

// ── turtleToBoard — complete deserialization ──────────────────────────────────
// Returns { cards, edgeTypes }

export async function turtleToBoard(ttlString) {
  const lines = ttlString.split('\n')

  const rawCards = {}
  const rawEdgeTypes = {}
  const rawAttachments = []
  const rawLinks = []
  const rawBoard = {}

  let subject = null, type = null, block = {}

  function flush() {
    if (!subject || !type) { block = {}; subject = null; type = null; return }
    if (type === 'board')      Object.assign(rawBoard, block)
    else if (type === 'card')  rawCards[subject] = { ...block }
    else if (type === 'et')    rawEdgeTypes[block.typeId] = { ...block }
    else if (type === 'att')   rawAttachments.push({ ...block })
    else if (type === 'link')  rawLinks.push({ ...block })
    block = {}; subject = null; type = null
  }

  for (const raw of lines) {
    const line = raw.trim()
    if (!line || line.startsWith('@') || line.startsWith('#')) continue

    // board subject: <> a bb:Board
    if (line.match(/^<>\s+a\s+bb:Board/)) {
      flush()
      subject = '__board__'
      type = 'board'
      continue
    }

    // new subject <#id> a Type
    const subjMatch = line.match(/^<#([^>]+)>\s+a\s+(\S+)/)
    if (subjMatch) {
      flush()
      subject = subjMatch[1]
      const typeToken = subjMatch[2].replace(/[;.].*$/, '').trim()
      if (typeToken === 'bb:Card')          type = 'card'
      else if (typeToken === 'bb:EdgeType')   type = 'et'
      else if (typeToken === 'bb:Attachment') type = 'att'
      else if (typeToken === 'ht:TypedLink')  type = 'link'
      else { subject = null }
      continue
    }

    if (!subject) continue

    // string literal  bb:foo "value" [.;]
    const strMatch = line.match(/^\s*(?:bb:|ht:|dcterms:)(\S+)\s+"((?:[^"\\]|\\.)*)"/)
    if (strMatch) {
      block[strMatch[1]] = parseTtlStr(strMatch[2])
      continue
    }

    // integer  bb:foo 123^^xsd:integer
    const intMatch = line.match(/^\s*(?:bb:|ht:)(\S+)\s+(-?\d+)\^\^xsd:integer/)
    if (intMatch) {
      block[intMatch[1]] = parseInt(intMatch[2])
      continue
    }

    // IRI ref  ht:source <#cardId>
    const iriMatch = line.match(/^\s*(?:bb:|ht:|dcterms:)(\S+)\s+<#([^>]+)>/)
    if (iriMatch) {
      block[iriMatch[1]] = iriMatch[2]
      continue
    }

    if (line.endsWith('.')) flush()
  }
  flush()

  // decrypt card content
  const decCards = {}
  await Promise.all(Object.entries(rawCards).map(async ([id, c]) => {
    decCards[id] = {
      text:      await decryptLiteral(c.content || ''),
      x:         c.x ?? 0,
      y:         c.y ?? 0,
      w:         c.width ?? 200,
      h:         c.height ?? 120,
      color:     c.color || 'lemonchiffon',
      createdAt: c.created  || null,
      saga:      c.saga    || null,
      groupId:   c.groupId || null,
      links:     {},
      backlinks: {},
      attachments: {},
    }
    if (!decCards[id].createdAt) delete decCards[id].createdAt
    if (!decCards[id].saga)     delete decCards[id].saga
    if (!decCards[id].groupId)  delete decCards[id].groupId
  }))

  // decrypt edge types
  const decEdgeTypes = {}
  await Promise.all(Object.entries(rawEdgeTypes).map(async ([tid, et]) => {
    decEdgeTypes[tid] = {
      name:  await decryptLiteral(et.typeName || tid),
      label: await decryptLiteral(et.typeName || tid),
      color: et.typeColor || '#888888',
    }
  }))

  // decrypt and attach attachments to their cards
  await Promise.all(rawAttachments.map(async (att) => {
    const card = decCards[att.cardId]
    if (!card) return
    const aid = att.attachId
    const rec = att.record ? await decryptLiteral(att.record) : null
    card.attachments[aid] = {
      type:      att.attachType || '',
      createdAt: att.created || null,
      ...(att.fbId ? { fbId: att.fbId } : {}),
      ...(rec ? { record: JSON.parse(rec) } : {}),
    }
    if (!card.attachments[aid].createdAt) delete card.attachments[aid].createdAt
  }))

  // attach links and rebuild backlinks
  for (const link of rawLinks) {
    const srcId = link.source
    const tgtId = link.target
    const linkId = link.linkId
    if (!srcId || !tgtId || !linkId || !decCards[srcId] || !decCards[tgtId]) continue
    decCards[srcId].links[linkId] = {
      from:    srcId,
      to:      tgtId,
      fromDir: link.fromDir || null,
      toDir:   link.toDir   || null,
      typeId:  link.typeId  || null,
    }
    decCards[tgtId].backlinks[linkId] = srcId
  }

  return { cards: decCards, edgeTypes: decEdgeTypes, groupId: rawBoard.groupId || null }
}

export default $
