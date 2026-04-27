#!/usr/bin/env -S deno run --allow-net --allow-env
/**
 * was_test.ts — smoke-test WAS connectivity: PUT a marker, GET it back, verify round-trip
 *
 * Usage:
 *   set -a && . .env && set +a && deno run --allow-net --allow-env debugging_utilities/was_test.ts
 *
 * Does NOT touch any real content — writes to was_test_marker.txt only.
 * Exits 0 on success, 1 on failure.
 */
import { Ed25519Signer } from 'npm:@did.coop/did-key-ed25519@0.0.14';
import { StorageClient } from 'npm:@wallet.storage/fetch-client@^1.1.3';

const signerJson = Deno.env.get('PLAN98_WAS_SIGNER') ?? '';
const spaceId    = Deno.env.get('PLAN98_WAS_SPACE_ID') ?? '';
const wasHost    = Deno.env.get('PLAN98_WAS_HOST') ?? 'http://localhost:1088';

if (!signerJson || !spaceId) {
  console.error('Error: PLAN98_WAS_SIGNER and PLAN98_WAS_SPACE_ID must be set');
  Deno.exit(1);
}

console.log(`space: ${spaceId}`);
console.log(`host:  ${wasHost}\n`);

const signer  = await Ed25519Signer.fromJSON(signerJson);
const storage = new StorageClient(new URL(wasHost));
const space   = storage.space({ signer, id: `urn:uuid:${spaceId}` });

const key     = 'was_test_marker.txt';
const payload = `was_test ok @ ${new Date().toISOString()}`;

const putRes = await space.resource(key).put(new Blob([payload], { type: 'text/plain' }), { signer });
console.log(`PUT ${key} → ${putRes.status}`);
if (!putRes.ok) { console.error('PUT failed'); Deno.exit(1); }

const getRes = await space.resource(key).get({ signer });
const blob   = await getRes.blob();
const text   = await blob.text();
console.log(`GET ${key} → ${getRes.status} body=${JSON.stringify(text)}`);

if (text !== payload) {
  console.error('round-trip mismatch');
  Deno.exit(1);
}

console.log('\nWAS round-trip OK');
