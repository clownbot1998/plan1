// sports-stats-engine.js — the connection/session state machine, no DOM,
// no @plan98/elf, testable directly under `deno test`. Same split as
// hearts-engine.js: this is "what should happen," sports-stats.js is
// "make it happen over the network."
//
// unlike hearts' fixed 4 seats, sports-stats has open-ended roles: any
// number of receivers (real displays — a TV, an OBS browser-source) and
// any number of transmitters (an operator's own phone/tablet), all in one
// trust pool per session. any transmitter can cast to any receiver — no
// exclusive per-receiver lock. "pass the torch" and "recover from an
// error" are the SAME primitive: whoever holds a role can re-share its
// join code so a new device claims that exact role and continues it.

// receivers get a longer leash than transmitters — a receiver is meant to
// be a stable, "production grade" display that shouldn't flicker back to
// a reconnect state over a brief hiccup; a transmitter is just someone's
// phone, fine to be treated more provisionally, same posture hearts
// already takes toward its seats.
export const ROLE_TIMEOUT_MS = { receiver: 15000, transmitter: 8000 }

export function mintRoleId() { return crypto.randomUUID() }

export function createRole(name) { return { name, lastSeen: Date.now() } }

export function isStale(kind, role, now) {
  return now - (role.lastSeen || 0) > ROLE_TIMEOUT_MS[kind]
}

// pure so it's testable against a fixed `now` instead of real wall-clock
// timing — returns which ids in ONE role map (all receivers, or all
// transmitters) should be released this tick.
export function staleRoleIds(kind, roles, now) {
  return Object.keys(roles).filter(id => isStale(kind, roles[id], now))
}

export function joinUrl(origin, tag, gameId, kind, roleId) {
  return `${origin}/app/${tag}?id=${gameId}&join=${kind}:${roleId}`
}

// null/malformed on purpose returns null, not a throw — a join link is
// something a browser typed in or a QR scanner produced, not something
// this code controls the shape of.
export function parseJoinParam(value) {
  if (!value) return null
  const i = value.indexOf(':')
  if (i === -1) return null
  const kind = value.slice(0, i)
  const roleId = value.slice(i + 1)
  if (kind !== 'receiver' && kind !== 'transmitter') return null
  if (!roleId) return null
  return { kind, roleId }
}

// a null value tombstones an entry — same convention plan1-hearts' own
// ROOM_MERGE uses, generalized from a fixed seats{0..3} map to open-ended
// receivers{}/transmitters{} maps of any size.
export const ROOM_MERGE = `(state, payload) => {
  var out = Object.assign({}, state, payload)
  ;['receivers','transmitters'].forEach(function (field) {
    if (payload[field]) {
      var base = Object.assign({}, state[field] || {})
      var inc = payload[field]
      Object.keys(inc).forEach(function (k) { if (inc[k] === null) { delete base[k] } else { base[k] = inc[k] } })
      out[field] = base
    }
  })
  return out
}`
