#!/usr/bin/env -S deno run --allow-net --allow-env
/**
 * was_check.ts — verify a resource exists in WAS using the .env signer
 *
 * Usage:
 *   deno run --allow-net --allow-env was_check.ts /plan98.js
 *   deno run --allow-net --allow-env was_check.ts /elves/my-computer.js
 *
 * Reads PLAN98_WAS_SIGNER, PLAN98_WAS_SPACE_ID, PLAN98_WAS_HOST from env.
 * Falls back to .env defaults if env vars not set (load via --env-file .env).
 */
import { Ed25519Signer } from 'npm:@did.coop/did-key-ed25519@0.0.14';
import { StorageClient } from 'npm:@wallet.storage/fetch-client@^1.1.3';

const signerJson = Deno.env.get('PLAN98_WAS_SIGNER') ?? '';
const spaceId    = Deno.env.get('PLAN98_WAS_SPACE_ID') ?? '';
const wasHost    = Deno.env.get('PLAN98_WAS_HOST') ?? 'http://localhost:1088';

if (!signerJson || !spaceId) {
  console.error('Error: PLAN98_WAS_SIGNER and PLAN98_WAS_SPACE_ID must be set');
  console.error('Run with: deno run --allow-net --allow-env --env-file .env was_check.ts /path');
  Deno.exit(1);
}

const path = Deno.args[0] ?? '/plan98.js';

const signer = await Ed25519Signer.fromJSON(signerJson);
const storage = new StorageClient(new URL(wasHost));
const space = storage.space({ signer, id: `urn:uuid:${spaceId}` });

console.log(`Checking ${wasHost}/space/${spaceId}${path}`);
const res = await space.resource(path).get({ signer });
console.log(`Status: ${res.status} ${res.ok ? 'OK' : 'FAIL'}`);

if (res.ok) {
  const blob = await res.blob();
  console.log(`Size: ${blob.size} bytes`);
  console.log(`Content-Type: ${res.headers.get('content-type')}`);
} else {
  try {
    const body = await res.json();
    console.log('Error body:', JSON.stringify(body));
  } catch {
    console.log('(no json body)');
  }
}
