#!/usr/bin/env -S deno run --allow-net --allow-env --allow-read
/**
 * was_put.ts — PUT a single file into WAS
 *
 * Usage:
 *   # Upload from local server path:
 *   deno run --allow-net --allow-env --env-file .env was_put.ts /plan98.js
 *
 *   # Upload from local filesystem:
 *   deno run --allow-net --allow-env --allow-read --env-file .env was_put.ts /plan98.js dist/plan98.js
 */
import { Ed25519Signer } from 'npm:@did.coop/did-key-ed25519@0.0.14';
import { StorageClient } from 'npm:@wallet.storage/fetch-client@^1.1.3';

const signerJson = Deno.env.get('PLAN98_WAS_SIGNER') ?? '';
const spaceId    = Deno.env.get('PLAN98_WAS_SPACE_ID') ?? '';
const wasHost    = Deno.env.get('PLAN98_WAS_HOST') ?? 'http://localhost:1088';
const plan1Port  = Deno.env.get('PLAN1_PORT') ?? '1998';

if (!signerJson || !spaceId) {
  console.error('Error: PLAN98_WAS_SIGNER and PLAN98_WAS_SPACE_ID must be set');
  Deno.exit(1);
}

const waspath  = Deno.args[0];
const localSrc = Deno.args[1]; // optional local file path

if (!waspath) {
  console.error('Usage: was_put.ts /was/path [local/file/path]');
  Deno.exit(1);
}

const signer = await Ed25519Signer.fromJSON(signerJson);
const storage = new StorageClient(new URL(wasHost));
const space = storage.space({ signer, id: `urn:uuid:${spaceId}` });

let blob: Blob;
let ct: string;

if (localSrc) {
  const bytes = await Deno.readFile(localSrc);
  const ext = localSrc.split('.').pop()?.toLowerCase() ?? '';
  ct = ({
    js: 'text/javascript', mjs: 'text/javascript', css: 'text/css',
    html: 'text/html; charset=utf-8', json: 'application/json',
    svg: 'image/svg+xml', png: 'image/png', wasm: 'application/wasm',
  })[ext] ?? 'application/octet-stream';
  blob = new Blob([bytes], { type: ct });
  console.log(`Source: ${localSrc} (${bytes.length}B)`);
} else {
  const res = await fetch(`http://localhost:${plan1Port}${waspath}`);
  if (!res.ok) {
    console.error(`Fetch failed: ${res.status} http://localhost:${plan1Port}${waspath}`);
    Deno.exit(1);
  }
  const rawBlob = await res.blob();
  ct = res.headers.get('content-type') ?? 'application/octet-stream';
  blob = new Blob([rawBlob], { type: ct });
  console.log(`Source: localhost:${plan1Port}${waspath} (${rawBlob.size}B)`);
}

const putRes = await space.resource(waspath).put(blob, { signer });
console.log(`PUT ${waspath} → ${putRes.status} ${putRes.ok ? 'OK' : 'FAIL'}`);
if (!putRes.ok) Deno.exit(1);
