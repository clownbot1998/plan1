#!/usr/bin/env -S deno run --allow-net --allow-env --allow-read --allow-write
/**
 * was_private.ts — delta-sync private/ to/from WAS using manifests
 *
 * Usage:
 *   deno run ... was_private.ts           # push changed files → WAS
 *   deno run ... was_private.ts --pull    # pull WAS changes → private/
 *   deno run ... was_private.ts --dry-run # show what would happen
 *
 * Reads private-manifest.json (local state from build.js).
 * Maintains was-manifest.json (last-synced state) for delta detection.
 */
import { Ed25519Signer } from 'npm:@did.coop/did-key-ed25519@0.0.14';
import { StorageClient } from 'npm:@wallet.storage/fetch-client@^1.1.3';
import { join, dirname } from 'jsr:@std/path';

const signerJson = Deno.env.get('PLAN98_WAS_SIGNER') ?? '';
const spaceId    = Deno.env.get('PLAN98_WAS_SPACE_ID') ?? '';
const wasHost    = Deno.env.get('PLAN98_WAS_HOST') ?? 'http://localhost:1088';
const pull       = Deno.args.includes('--pull');
const dryRun     = Deno.args.includes('--dry-run');

if (!signerJson || !spaceId) {
  console.error('Error: PLAN98_WAS_SIGNER and PLAN98_WAS_SPACE_ID must be set in .env');
  Deno.exit(1);
}

const root           = new URL('../', import.meta.url).pathname;
const privateDir     = join(root, 'private');
const localManifest  = join(root, 'private-manifest.json');
const syncManifest   = join(root, 'was-manifest.json');

const signer  = await Ed25519Signer.fromJSON(signerJson);
const storage = new StorageClient(new URL(wasHost));
const space   = storage.space({ signer, id: `urn:uuid:${spaceId}` });

type LocalEntry  = { path: string; mtime: number; size: number }
type SyncEntry   = { path: string; mtime: number; etag?: string }
type SyncState   = Record<string, SyncEntry>

async function readJSON<T>(p: string, fallback: T): Promise<T> {
  try { return JSON.parse(await Deno.readTextFile(p)) } catch { return fallback }
}

async function push() {
  const local: LocalEntry[] = await readJSON(localManifest, []);
  if (!local.length) {
    console.log('No private-manifest.json — run ./plan1.sh build first');
    Deno.exit(1);
  }

  const synced: SyncState = await readJSON(syncManifest, {});
  const toSync = local.filter(f => {
    const last = synced[f.path];
    return !last || last.mtime < f.mtime;
  });

  if (!toSync.length) { console.log('Nothing to sync.'); return; }

  console.log(`Syncing ${toSync.length} of ${local.length} files to ${wasHost}\n`);
  let ok = 0, fail = 0;

  for (const f of toSync) {
    const wasPath = '/private' + f.path;
    if (dryRun) { console.log('PUSH', wasPath); ok++; continue; }
    try {
      const bytes = await Deno.readFile(join(privateDir, f.path));
      const ct    = guessMime(f.path);
      const blob  = new Blob([bytes], { type: ct });
      const res   = await space.resource(wasPath).put(blob, { signer });
      const etag  = res.headers?.get('etag') ?? undefined;
      console.log(`${res.status} ${wasPath} (${bytes.length}B)`);
      if (res.ok) {
        synced[f.path] = { path: f.path, mtime: f.mtime, etag };
        ok++;
      } else { fail++; }
    } catch (e: unknown) {
      console.log(`ERR ${wasPath}: ${e instanceof Error ? e.message : String(e)}`);
      fail++;
    }
  }

  if (!dryRun) await Deno.writeTextFile(syncManifest, JSON.stringify(synced, null, 2));
  console.log(`\nDone: ${ok} synced, ${fail} failed`);
  if (fail > 0) Deno.exit(1);
}

async function pullFiles() {
  const synced: SyncState = await readJSON(syncManifest, {});
  const listRes = await space.resource('/private/').get({ signer }).catch(() => null);
  if (!listRes?.ok) {
    console.error('Could not list /private/ from WAS — is WAS running?');
    Deno.exit(1);
  }
  const listing: string[] = await listRes.json().catch(() => []);
  if (!listing.length) { console.log('Nothing in /private/ on WAS.'); return; }

  let ok = 0, fail = 0;
  for (const wasPath of listing) {
    const localRel  = wasPath.replace(/^\/private/, '');
    const localPath = join(privateDir, localRel);
    if (dryRun) { console.log('PULL', wasPath, '→', localPath); continue; }
    try {
      const res = await space.resource(wasPath).get({ signer }).catch(() => null);
      if (!res?.ok) { console.log(`SKIP ${wasPath}`); fail++; continue; }
      const bytes = new Uint8Array(await res.arrayBuffer());
      await Deno.mkdir(dirname(localPath), { recursive: true });
      await Deno.writeFile(localPath, bytes);
      const stat = await Deno.stat(localPath);
      synced[localRel] = { path: localRel, mtime: stat.mtime?.getTime() ?? Date.now() };
      console.log(`${res.status} ${wasPath} → ${localPath}`);
      ok++;
    } catch (e: unknown) {
      console.log(`ERR ${wasPath}: ${e instanceof Error ? e.message : String(e)}`);
      fail++;
    }
  }
  if (!dryRun) await Deno.writeTextFile(syncManifest, JSON.stringify(synced, null, 2));
  console.log(`\nDone: ${ok} restored, ${fail} failed`);
  if (fail > 0) Deno.exit(1);
}

function guessMime(path: string): string {
  const ext = path.split('.').pop()?.toLowerCase() ?? '';
  const map: Record<string, string> = {
    jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png',
    gif: 'image/gif', webp: 'image/webp', heic: 'image/heic',
    mp4: 'video/mp4', mov: 'video/quicktime', mp3: 'audio/mpeg',
    wav: 'audio/wav', pdf: 'application/pdf', txt: 'text/plain',
    json: 'application/json', ogg: 'audio/ogg',
  };
  return map[ext] ?? 'application/octet-stream';
}

if (pull) await pullFiles();
else await push();
