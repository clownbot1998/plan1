#!/usr/bin/env -S deno run --allow-net --allow-env
/**
 * was_bootstrap.ts — upload all bootstrap dependencies to WAS from local server
 *
 * Usage:
 *   deno run --allow-net --allow-env --env-file .env was_bootstrap.ts
 *   deno run --allow-net --allow-env --env-file .env was_bootstrap.ts --dry-run
 *
 * Fetches each bootstrap file from PLAN1_HOST (default localhost:1998) and
 * PUTs it into WAS. Idempotent — re-running overwrites with latest dist content.
 */
import { Ed25519Signer } from 'npm:@did.coop/did-key-ed25519@0.0.14';
import { StorageClient } from 'npm:@wallet.storage/fetch-client@^1.1.3';

const signerJson  = Deno.env.get('PLAN98_WAS_SIGNER') ?? '';
const spaceId     = Deno.env.get('PLAN98_WAS_SPACE_ID') ?? '';
const wasHost     = Deno.env.get('PLAN98_WAS_HOST') ?? 'http://localhost:1088';
const plan1Port   = Deno.env.get('PLAN1_PORT') ?? '1998';
const plan1Base   = `http://localhost:${plan1Port}`;
const dryRun      = Deno.args.includes('--dry-run');

if (!signerJson || !spaceId) {
  console.error('Error: PLAN98_WAS_SIGNER and PLAN98_WAS_SPACE_ID must be set');
  Deno.exit(1);
}

const bootstrapPaths = [
  '/index.html', '/plan98.js', '/plan98-shims.js', '/main.js',
  '/saga.js', '/cache.js', '/types.js',
  '/styles/system.css', '/css/base.css', '/css/main.css',
  '/elves/plan98-modal.js', '/elves/plan98-panel.js', '/elves/plan98-toast.js',
  '/elves/plan98-wallet.js', '/elves/paper-pocket.js', '/elves/debug-gamepads.js',
  '/elves/lrud-elf.js', '/elves/multi-task.js', '/elves/my-computer.js',
  '/elves/flip-book.js',
];

if (dryRun) {
  console.log('DRY RUN — would upload:');
  for (const p of bootstrapPaths) console.log(' ', p);
  Deno.exit(0);
}

const signer = await Ed25519Signer.fromJSON(signerJson);
const storage = new StorageClient(new URL(wasHost));
const space = storage.space({ signer, id: `urn:uuid:${spaceId}` });

console.log(`Uploading to ${wasHost} space ${spaceId}`);
console.log(`Fetching from ${plan1Base}\n`);

let ok = 0, fail = 0;
for (const path of bootstrapPaths) {
  try {
    const res = await fetch(plan1Base + path);
    if (!res.ok) {
      console.log(`SKIP ${path} — fetch ${res.status}`);
      fail++;
      continue;
    }
    const blob = await res.blob();
    const ct = res.headers.get('content-type') ?? 'application/octet-stream';
    const typedBlob = new Blob([blob], { type: ct });
    const putRes = await space.resource(path).put(typedBlob, { signer });
    console.log(`${putRes.status} ${path} (${blob.size}B)`);
    if (putRes.ok) ok++; else fail++;
  } catch(e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    console.log(`ERR ${path}: ${msg}`);
    fail++;
  }
}

console.log(`\nDone: ${ok} uploaded, ${fail} failed`);
if (fail > 0) Deno.exit(1);
