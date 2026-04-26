#!/usr/bin/env -S deno run --allow-net --allow-env --allow-read --allow-write
/**
 * was_private.ts — sync private/ folder to/from WAS
 *
 * Usage:
 *   deno run ... was_private.ts           # push private/ → WAS
 *   deno run ... was_private.ts --pull    # pull WAS /private/ → private/
 *   deno run ... was_private.ts --dry-run # show what would happen
 */
import { Ed25519Signer } from 'npm:@did.coop/did-key-ed25519@0.0.14';
import { StorageClient } from 'npm:@wallet.storage/fetch-client@^1.1.3';
import { join, relative } from 'jsr:@std/path';

const signerJson = Deno.env.get('PLAN98_WAS_SIGNER') ?? '';
const spaceId    = Deno.env.get('PLAN98_WAS_SPACE_ID') ?? '';
const wasHost    = Deno.env.get('PLAN98_WAS_HOST') ?? 'http://localhost:1088';
const pull       = Deno.args.includes('--pull');
const dryRun     = Deno.args.includes('--dry-run');

if (!signerJson || !spaceId) {
  console.error('Error: PLAN98_WAS_SIGNER and PLAN98_WAS_SPACE_ID must be set in .env');
  Deno.exit(1);
}

const signer  = await Ed25519Signer.fromJSON(signerJson);
const storage = new StorageClient(new URL(wasHost));
const space   = storage.space({ signer, id: `urn:uuid:${spaceId}` });

const privateDir = join(new URL('.', import.meta.url).pathname, '../private');

async function push() {
  let ok = 0, skip = 0, fail = 0;
  for await (const entry of walk(privateDir)) {
    const rel  = '/' + relative(privateDir, entry);
    const path = '/private' + rel;
    if (dryRun) { console.log('PUSH', path); skip++; continue; }
    try {
      const bytes = await Deno.readFile(entry);
      const ct    = guessMime(entry);
      const blob  = new Blob([bytes], { type: ct });
      const res   = await space.resource(path).put(blob, { signer });
      console.log(`${res.status} ${path} (${bytes.length}B)`);
      if (res.ok) ok++; else fail++;
    } catch (e: unknown) {
      console.log(`ERR ${path}: ${e instanceof Error ? e.message : String(e)}`);
      fail++;
    }
  }
  console.log(dryRun
    ? `\nDry run: ${skip} files would be uploaded`
    : `\nDone: ${ok} uploaded, ${fail} failed`);
  if (fail > 0) Deno.exit(1);
}

async function pull_() {
  const listRes = await space.resource('/private/').get({ signer }).catch(() => null);
  if (!listRes || !listRes.ok) {
    console.error('Could not list /private/ from WAS — is WAS running?');
    Deno.exit(1);
  }
  const listing: string[] = await listRes.json().catch(() => []);
  if (!listing.length) {
    console.log('Nothing in /private/ on WAS.');
    return;
  }
  let ok = 0, fail = 0;
  for (const path of listing) {
    const localPath = join(privateDir, path.replace(/^\/private\//, ''));
    if (dryRun) { console.log('PULL', path, '→', localPath); continue; }
    try {
      const res = await space.resource(path).get({ signer }).catch(() => null);
      if (!res?.ok) { console.log(`SKIP ${path} — not found`); fail++; continue; }
      const bytes = new Uint8Array(await res.arrayBuffer());
      await Deno.mkdir(localPath.replace(/\/[^/]+$/, ''), { recursive: true });
      await Deno.writeFile(localPath, bytes);
      console.log(`${res.status} ${path} → ${localPath}`);
      ok++;
    } catch (e: unknown) {
      console.log(`ERR ${path}: ${e instanceof Error ? e.message : String(e)}`);
      fail++;
    }
  }
  console.log(`\nDone: ${ok} restored, ${fail} failed`);
  if (fail > 0) Deno.exit(1);
}

async function* walk(dir: string): AsyncGenerator<string> {
  for await (const entry of Deno.readDir(dir)) {
    const path = join(dir, entry.name);
    if (entry.isDirectory) yield* walk(path);
    else yield path;
  }
}

function guessMime(path: string): string {
  const ext = path.split('.').pop()?.toLowerCase() ?? '';
  const map: Record<string, string> = {
    jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png',
    gif: 'image/gif', webp: 'image/webp', heic: 'image/heic',
    mp4: 'video/mp4', mov: 'video/quicktime', mp3: 'audio/mpeg',
    wav: 'audio/wav', pdf: 'application/pdf', txt: 'text/plain',
    json: 'application/json',
  };
  return map[ext] ?? 'application/octet-stream';
}

if (pull) await pull_();
else await push();
