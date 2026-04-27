#!/usr/bin/env -S deno run --allow-net --allow-env
/**
 * was_bootstrap.ts — upload all bootstrap dependencies to WAS from local server
 *
 * Usage:
 *   set -a && . .env && set +a && deno run --allow-net --allow-env debugging_utilities/was_bootstrap.ts
 *   set -a && . .env && set +a && deno run --allow-net --allow-env debugging_utilities/was_bootstrap.ts --dry-run
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
  // core firmware
  '/index.html', '/plan98.js', '/plan98-shims.js', '/main.js',
  '/saga.js', '/cache.js', '/types.js', '/as2.js',
  // styles
  '/styles/system.css',
  // fonts
  '/fonts/Recursive_VF_1.085--subset-GF_latin_basic.woff2',
  // all registered elves (mirrors ELVES map in index.html)
  '/elves/ur-shell.js',
  '/elves/multi-task.js',
  '/elves/source-code.js',
  '/elves/flip-book.js',
  '/elves/dial-tone.js',
  '/elves/lore-baby.js',
  '/elves/saga-pitch.js',
  '/elves/my-computer.js',
  '/elves/qr-code.js',
  '/elves/private-ai.js',
  '/elves/title-page.js',
  '/elves/project-manager.js',
  '/elves/blog-search.js',
  '/elves/clown-eyes.js',
  '/elves/preview-gallery.js',
  '/elves/paper-pocket.js',
  '/elves/clownbot-brief.js',
  '/elves/plan98-tree.js',
  '/elves/plan98-wallet.js',
  '/elves/plan98-modal.js',
  '/elves/plan98-panel.js',
  '/elves/plan98-toast.js',
  '/elves/plan98-console.js',
  '/elves/squad-code.js',
  '/elves/was-code.js',
  '/elves/hypertext-action.js',
  '/elves/hypertext-address.js',
  '/elves/hypertext-blankline.js',
  '/elves/hypertext-comment.js',
  '/elves/hypertext-effect.js',
  '/elves/hypertext-highlighter.js',
  '/elves/hypertext-parenthetical.js',
  '/elves/hypertext-puppet.js',
  '/elves/hypertext-quote.js',
  '/elves/hypertext-variable.js',
  // sticky menu (loaded directly in index.html)
  '/elves/sticky-menu.js',
  '/elves/lrud-elf.js',
  '/elves/debug-gamepads.js',
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
    const putRes = await space.resource(path.replace(/^\//, '')).put(typedBlob, { signer });
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
