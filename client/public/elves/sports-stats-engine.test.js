// sports-stats-engine.test.js — run with: deno test --allow-read client/public/elves/sports-stats-engine.test.js
import { assert, assertEquals } from 'jsr:@std/assert'
import { ROLE_TIMEOUT_MS, mintRoleId, createRole, isStale, staleRoleIds, joinUrl, parseJoinParam, ROOM_MERGE } from './sports-stats-engine.js'

Deno.test('mintRoleId: unique each call', () => {
  const a = mintRoleId(), b = mintRoleId()
  assert(a.length > 0)
  assertEquals(new Set([a, b]).size, 2)
})

Deno.test('createRole: stamps a lastSeen at creation time', () => {
  const before = Date.now()
  const role = createRole('Court Side Screen')
  assertEquals(role.name, 'Court Side Screen')
  assert(role.lastSeen >= before)
})

Deno.test('isStale: false right after creation, true well past the timeout', () => {
  const role = createRole('x')
  assert(!isStale('receiver', role, role.lastSeen + 100))
  assert(isStale('receiver', role, role.lastSeen + ROLE_TIMEOUT_MS.receiver + 1))
})

Deno.test('isStale: receivers get a longer leash than transmitters', () => {
  assert(ROLE_TIMEOUT_MS.receiver > ROLE_TIMEOUT_MS.transmitter)
  const role = createRole('x')
  const midpoint = role.lastSeen + ROLE_TIMEOUT_MS.transmitter + 1
  assert(isStale('transmitter', role, midpoint))   // transmitter timeout already passed
  assert(!isStale('receiver', role, midpoint))      // receiver timeout has not
})

Deno.test('staleRoleIds: only returns the ones actually past their timeout', () => {
  const now = 1_000_000
  const roles = {
    fresh: { name: 'a', lastSeen: now - 1000 },
    stale: { name: 'b', lastSeen: now - ROLE_TIMEOUT_MS.receiver - 1 },
  }
  assertEquals(staleRoleIds('receiver', roles, now), ['stale'])
})

Deno.test('joinUrl / parseJoinParam: round-trips kind and roleId', () => {
  const url = joinUrl('https://example.com', 'sports-stats', 'game-1', 'receiver', 'role-9')
  const parsed = new URL(url)
  assertEquals(parsed.searchParams.get('id'), 'game-1')
  const join = parseJoinParam(parsed.searchParams.get('join'))
  assertEquals(join, { kind: 'receiver', roleId: 'role-9' })
})

Deno.test('parseJoinParam: rejects malformed or unknown-kind input instead of guessing', () => {
  assertEquals(parseJoinParam(null), null)
  assertEquals(parseJoinParam(''), null)
  assertEquals(parseJoinParam('nonsense'), null)          // no colon
  assertEquals(parseJoinParam('receiver:'), null)          // empty roleId
  assertEquals(parseJoinParam('umpire:abc'), null)         // not a real kind
})

Deno.test('parseJoinParam: a roleId containing a colon still parses correctly', () => {
  assertEquals(parseJoinParam('transmitter:abc:def'), { kind: 'transmitter', roleId: 'abc:def' })
})

// ROOM_MERGE is a string meant for a QuickJS sandbox at runtime — eval'd
// directly here since a test trusts its own code; this is the same merge
// behavior the sandbox will actually run.
function merge(state, payload) {
  // deno-lint-ignore no-eval
  return (0, eval)(`(${ROOM_MERGE})`)(state, payload)
}

Deno.test('ROOM_MERGE: adds new entries without touching existing ones', () => {
  const state = { receivers: { a: { name: 'A', lastSeen: 1 } }, transmitters: {} }
  const out = merge(state, { receivers: { b: { name: 'B', lastSeen: 2 } } })
  assertEquals(Object.keys(out.receivers).sort(), ['a', 'b'])
  assertEquals(out.receivers.a, state.receivers.a)
})

Deno.test('ROOM_MERGE: null tombstones an entry (deletes it), not just blanks it', () => {
  const state = { receivers: { a: { name: 'A', lastSeen: 1 }, b: { name: 'B', lastSeen: 2 } }, transmitters: {} }
  const out = merge(state, { receivers: { a: null } })
  assertEquals(Object.keys(out.receivers), ['b'])
})

Deno.test('ROOM_MERGE: two different receivers claimed in the same tick both survive (no clobber)', () => {
  const state = { receivers: {}, transmitters: {} }
  const afterFirst = merge(state, { receivers: { a: { name: 'A', lastSeen: 1 } } })
  const afterSecond = merge(afterFirst, { receivers: { b: { name: 'B', lastSeen: 2 } } })
  assertEquals(Object.keys(afterSecond.receivers).sort(), ['a', 'b'])
})

Deno.test('ROOM_MERGE: fields outside receivers/transmitters fall back to plain overwrite', () => {
  const state = { view: 'boot', receivers: {}, transmitters: {} }
  const out = merge(state, { view: 'receiver' })
  assertEquals(out.view, 'receiver')
})
