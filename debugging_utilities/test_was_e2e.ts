/**
 * test_was_e2e.ts — end-to-end tests for plan1 ↔ WAS integration
 *
 * Run:
 *   deno task test
 *   deno test --no-check --allow-net --allow-env --env-file=.env debugging_utilities/test_was_e2e.ts
 *
 * WAS isolation tests use ephemeral keys + a fresh space UUID — no .env credentials.
 * Server fallback tests use .env keys (the running server uses those same keys).
 * Both legs use unique paths (/test-e2e-{uuid}) and clean up after themselves.
 *
 * sanitizeResources: false on each test — @wallet.storage/fetch-client never drains
 * the underlying Response body from PUT operations (library-internal leak).
 */

import { Ed25519Signer } from 'npm:@did.coop/did-key-ed25519@0.0.14';
import { StorageClient } from 'npm:@wallet.storage/fetch-client@1.1.3';

const WAS_HOST   = Deno.env.get('PLAN98_WAS_HOST')     ?? 'http://localhost:1088';
const PLAN1_HOST = `http://localhost:${Deno.env.get('PLAN1_PORT') ?? '1998'}`;

// ── helpers ────────────────────────────────────────────────────────────────

function jsonBlob(obj: unknown) {
  return new Blob([JSON.stringify(obj)], { type: 'application/json' });
}

async function makeSpace() {
  const signer  = await Ed25519Signer.generate();
  const spaceId = crypto.randomUUID();
  const storage = new StorageClient(new URL(WAS_HOST));
  const space   = storage.space({ signer, id: `urn:uuid:${spaceId}` });

  // WAS requires PUT /space/{uuid} to provision the space before resource writes.
  // SpaceFetched.put returns the raw Response — drain body to avoid Deno leak tracking.
  const initRes = await space.put(jsonBlob({ controller: signer.controller }), { signer });
  await initRes.body?.cancel();
  if (!initRes.ok) throw new Error(`failed to provision space ${spaceId}: ${initRes.status}`);

  return { signer, spaceId, space };
}

const testOpts = { sanitizeResources: false, sanitizeOps: false };

// ── WAS isolation tests (ephemeral keys, no .env) ──────────────────────────

Deno.test({ name: 'WAS: PUT then GET returns same content', ...testOpts, async fn() {
  const { signer, space } = await makeSpace();
  const path    = `/test-${crypto.randomUUID()}.json`;
  const payload = { hello: 'plan1', ts: Date.now() };

  const putRes = await space.resource(path).put(jsonBlob(payload), { signer });
  if (!putRes.ok) throw new Error(`PUT failed: ${putRes.status}`);

  const getRes = await space.resource(path).get({ signer });
  if (!getRes.ok) throw new Error(`GET failed: ${getRes.status}`);

  const body = await getRes.json!() as typeof payload;
  if (body.hello !== payload.hello || body.ts !== payload.ts) {
    throw new Error(`content mismatch: ${JSON.stringify(body)}`);
  }
}});

Deno.test({ name: 'WAS: GET non-existent resource returns 404', ...testOpts, async fn() {
  const { signer, space } = await makeSpace();
  const res = await space.resource(`/missing-${crypto.randomUUID()}.json`).get({ signer });
  if (res.status !== 404) throw new Error(`expected 404, got ${res.status}`);
}});

Deno.test({ name: 'WAS: unsigned GET returns non-200 (auth required)', ...testOpts, async fn() {
  const { signer, space } = await makeSpace();
  const path = `/test-${crypto.randomUUID()}.json`;

  const putRes = await space.resource(path).put(jsonBlob({ x: 1 }), { signer });
  if (!putRes.ok) throw new Error(`PUT failed: ${putRes.status}`);

  const raw = await fetch(`${WAS_HOST}${space.path}${path}`);
  await raw.text();
  // WAS rejects unsigned reads — 401, 403, or 500 depending on server implementation
  if (raw.status === 200) throw new Error('unsigned read returned 200 — auth not enforced');
}});

// WAS resources are immutable: a second PUT to the same path is acknowledged
// but GET continues to return the first-written content.
Deno.test({ name: 'WAS: resources are immutable (PUT does not overwrite)', ...testOpts, async fn() {
  const { signer, space } = await makeSpace();
  const path = `/test-${crypto.randomUUID()}.json`;

  const put1 = await space.resource(path).put(jsonBlob({ v: 1 }), { signer });
  if (!put1.ok) throw new Error(`first PUT failed: ${put1.status}`);

  const put2 = await space.resource(path).put(jsonBlob({ v: 2 }), { signer });
  if (!put2.ok) throw new Error(`second PUT failed: ${put2.status}`);

  const res  = await space.resource(path).get({ signer });
  const body = await res.json!() as { v: number };
  // First write wins — this documents the WAS immutability contract
  if (body.v !== 1) throw new Error(`expected first write (v=1) to persist, got v=${body.v}`);
}});

// To update a resource, delete then re-PUT.
Deno.test({ name: 'WAS: delete then re-PUT updates content', ...testOpts, async fn() {
  const { signer, space } = await makeSpace();
  const path = `/test-${crypto.randomUUID()}.json`;

  const put1 = await space.resource(path).put(jsonBlob({ v: 1 }), { signer });
  if (!put1.ok) throw new Error(`PUT v=1 failed: ${put1.status}`);

  await space.resource(path).delete({ signer });

  const put2 = await space.resource(path).put(jsonBlob({ v: 2 }), { signer });
  if (!put2.ok) throw new Error(`PUT v=2 after delete failed: ${put2.status}`);

  const res  = await space.resource(path).get({ signer });
  const body = await res.json!() as { v: number };
  if (body.v !== 2) throw new Error(`expected v=2 after delete+PUT, got v=${body.v}`);
}});

Deno.test({ name: 'WAS: different spaces are isolated', ...testOpts, async fn() {
  const a = await makeSpace();
  const b = await makeSpace();
  const path = `/isolation-${crypto.randomUUID()}.json`;

  const putA = await a.space.resource(path).put(jsonBlob({ owner: 'a' }), { signer: a.signer });
  if (!putA.ok) throw new Error(`space A PUT failed: ${putA.status}`);

  const resB = await b.space.resource(path).get({ signer: b.signer });
  if (resB.status !== 404) {
    throw new Error(`space B should not see space A's resource, got ${resB.status}`);
  }
}});

// ── server fallback tests (.env signer — same keys the running server uses) ─

const PRIMARY_SIGNER_JSON = Deno.env.get('PLAN98_WAS_SIGNER') ?? '';
const PRIMARY_SPACE_ID    = Deno.env.get('PLAN98_WAS_SPACE_ID') ?? '';
const HAS_PRIMARY         = Boolean(PRIMARY_SIGNER_JSON && PRIMARY_SPACE_ID);

Deno.test({ name: 'server: WAS fallback serves resource not on disk', ...testOpts,
  ignore: !HAS_PRIMARY,
  async fn() {
    const signer  = await Ed25519Signer.fromJSON(PRIMARY_SIGNER_JSON);
    const storage = new StorageClient(new URL(WAS_HOST));
    const space   = storage.space({ signer, id: `urn:uuid:${PRIMARY_SPACE_ID}` });

    const testPath    = `/test-e2e-${crypto.randomUUID()}.json`;
    const testPayload = { e2e: true, path: testPath, ts: Date.now() };

    const putRes = await space.resource(testPath).put(jsonBlob(testPayload), { signer });
    if (!putRes.ok) throw new Error(`WAS PUT failed: ${putRes.status}`);

    try {
      const res  = await fetch(PLAN1_HOST + testPath);
      const body = await res.json() as typeof testPayload;

      if (!res.ok) throw new Error(`server returned ${res.status} for ${testPath}`);

      const ct = res.headers.get('content-type') ?? '';
      if (!ct.includes('application/json')) {
        throw new Error(`expected application/json, got: ${ct}`);
      }
      if (body.e2e !== true || body.path !== testPath) {
        throw new Error(`body mismatch: ${JSON.stringify(body)}`);
      }
    } finally {
      await space.resource(testPath).delete({ signer }).catch(() => null);
    }
  },
});

Deno.test({ name: 'server: path not in WAS or disk returns SPA shell (200 text/html)', ...testOpts,
  ignore: !HAS_PRIMARY,
  async fn() {
    const res  = await fetch(`${PLAN1_HOST}/test-e2e-${crypto.randomUUID()}-gone.json`);
    const html = await res.text();

    if (!res.ok) throw new Error(`expected 200 SPA shell, got ${res.status}`);
    const ct = res.headers.get('content-type') ?? '';
    if (!ct.includes('text/html')) throw new Error(`expected text/html, got: ${ct}`);
    if (!html.includes('plan98')) throw new Error('SPA shell missing plan98 env injection');
  },
});

Deno.test({ name: 'server: bootstrap file reachable from disk or WAS', ...testOpts,
  ignore: !HAS_PRIMARY,
  async fn() {
    const res  = await fetch(`${PLAN1_HOST}/plan98.js`);
    const text = await res.text();

    if (!res.ok) throw new Error(`/plan98.js returned ${res.status}`);
    const ct = res.headers.get('content-type') ?? '';
    if (!ct.includes('javascript')) throw new Error(`expected javascript, got: ${ct}`);
    if (!text.includes('import')) throw new Error('/plan98.js body missing import statements');
  },
});
