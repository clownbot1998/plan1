#!/usr/bin/env -S deno run --allow-net --allow-env --allow-read
/**
 * reset_test_state.ts — factory-resets accessibility-mode's persisted state
 *
 * accessibility-mode's workspaces/tabs/chat history persist server-side via
 * WAS (/my-sagas/workspaces.json), not per-browser-profile — a fresh
 * puppeteer.launch() with no userDataDir still loads whatever the LAST test
 * run (or real user session) left behind. Repeated e2e runs against this
 * elf accumulate workspaces/tabs indefinitely and land on unpredictable
 * starting states (sessions browser vs. a chat tab, mid-auth vs. logged
 * out, model selection vs. "silly") — any e2e flow that opens
 * accessibility-mode should call this first for a deterministic starting
 * point, the same way a factory reset works for any other test fixture.
 *
 * Usage:
 *   deno run ... reset_test_state.ts
 *
 * Wired into: ./plan1.sh reset-test-state
 */
import { Ed25519Signer } from 'npm:@did.coop/did-key-ed25519@0.0.14'
import { StorageClient } from 'npm:@wallet.storage/fetch-client@1.1.3'

const signerJson = Deno.env.get('PLAN98_WAS_SIGNER') ?? ''
const spaceId    = Deno.env.get('PLAN98_WAS_SPACE_ID') ?? ''
const wasHost    = Deno.env.get('PLAN98_WAS_HOST') ?? 'http://localhost:1088'

if (!signerJson || !spaceId) {
  console.error('Error: PLAN98_WAS_SIGNER and PLAN98_WAS_SPACE_ID must be set')
  Deno.exit(1)
}

const signer = await Ed25519Signer.fromJSON(signerJson)
const storage = new StorageClient(new URL(wasHost))
const space = storage.space({ signer, id: `urn:uuid:${spaceId}` })

// mirrors accessibility-mode.js's own $ initial state exactly (see the
// Self(tag, {...}) call around line 375) — a true factory reset, not an
// approximation of one.
const clean = {
  workspaces: [{
    id: 'ws-default', label: 'Workspace 1', updatedAt: 0,
    tabs: [{ id: 'default', label: 'Chat' }], tabSnapshots: {},
    activeTabId: 'default', messages: [], history: [], agentLogs: [],
    previewUrl: '/app/bulletin-board',
  }],
  activeWorkspaceId: 'ws-default',
}

const blob = new Blob([JSON.stringify(clean)], { type: 'application/json' })
const res = await space.resource('/my-sagas/workspaces.json').put(blob, { signer })
console.log(`reset /my-sagas/workspaces.json → ${res.status} ${res.ok ? 'OK' : 'FAIL'}`)
if (!res.ok) Deno.exit(1)

// accessibility-mode.js's own _shellSessionId defaults to the literal
// string 'default' whenever the page has no ?id= query param (which is
// exactly how every e2e flow opens it) — messages/history for that session
// live in this SEPARATE resource, untouched by the workspaces reset above.
// loadSession() treats a session with no human-authored message as "no
// session" (my-sagas.js: `if (!msgs.some(m => m.author === 'human'))
// return null`), so an empty messages array here is enough to reset it —
// no need to replicate deleteSession()'s actual DELETE calls.
const emptySession = new Blob([JSON.stringify({ messages: [], history: [] })], { type: 'application/json' })
const res2 = await space.resource('/my-sagas/default.json').put(emptySession, { signer })
console.log(`reset /my-sagas/default.json → ${res2.status} ${res2.ok ? 'OK' : 'FAIL'}`)
if (!res2.ok) Deno.exit(1)

// AND when loadSession() returns null (exactly what an empty messages array
// above now causes), execute() falls back to reading this SEPARATE plaintext
// companion (my-sagas.js's getSaga/sagaPath: `/my-sagas/${id}.saga`) and
// displays THAT as the chat history instead — every real message save also
// writes this parallel .saga text export, so a stale one here silently wins
// over the just-emptied .json (confirmed the hard way: a full server
// restart + only resetting default.json still showed old chat content).
const res3 = await space.resource('/my-sagas/default.saga').put(new Blob([''], { type: 'text/plain' }), { signer })
console.log(`reset /my-sagas/default.saga → ${res3.status} ${res3.ok ? 'OK' : 'FAIL'}`)
if (!res3.ok) Deno.exit(1)
