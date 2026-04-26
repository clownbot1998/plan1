#!/usr/bin/env -S deno run --allow-net --allow-env
/**
 * was_list_spaces.ts — list all spaces in WAS, filtered by our signer's controller DID
 *
 * Usage:
 *   deno run --allow-net --allow-env --env-file .env was_list_spaces.ts
 *   deno run --allow-net --allow-env --env-file .env was_list_spaces.ts --all
 *
 * By default shows only spaces controlled by PLAN98_WAS_SIGNER's key.
 * --all shows every space in the WAS server.
 */
import { Ed25519Signer } from 'npm:@did.coop/did-key-ed25519@0.0.14';

const signerJson = Deno.env.get('PLAN98_WAS_SIGNER') ?? '';
const wasHost    = Deno.env.get('PLAN98_WAS_HOST') ?? 'http://localhost:1088';
const showAll    = Deno.args.includes('--all');

const res = await fetch(`${wasHost}/spaces/`);
if (!res.ok) {
  console.error(`Failed to list spaces: ${res.status}`);
  Deno.exit(1);
}
const { items } = await res.json();

if (showAll) {
  console.log(`All spaces (${items.length}):`);
  for (const s of items) {
    console.log(`  ${s.uuid} — ${s.controller ?? '(no controller)'}`);
  }
  Deno.exit(0);
}

if (!signerJson) {
  console.error('PLAN98_WAS_SIGNER not set; use --all to list every space');
  Deno.exit(1);
}

const signer = await Ed25519Signer.fromJSON(signerJson);
const ours = items.filter((s: { controller?: string }) => s.controller === signer.controller);

console.log(`Spaces controlled by ${signer.controller}:`);
if (ours.length === 0) {
  console.log('  (none)');
} else {
  for (const s of ours) {
    console.log(`  ${s.uuid}`);
  }
}
