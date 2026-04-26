// plan1 app server — serves dist/, handles /app/<tag> routing
import { serveDir } from 'jsr:@std/http/file-server';

const DIST = new URL('./dist/', import.meta.url).pathname;
const PORT = Number(Deno.env.get('PLAN1_PORT') ?? 1998);

function safeEnv(key, fallback = '') {
  return Deno.env.get(key) ?? fallback;
}

// --- Ed25519 keycard bootstrap ---
// multicodec varint prefixes
const ED25519_PUB_PREFIX  = new Uint8Array([0xed, 0x01]);
const ED25519_PRIV_PREFIX = new Uint8Array([0x80, 0x26]);
const BASE58_ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';

function bytesToBase58(bytes) {
  let n = 0n;
  for (const b of bytes) n = n * 256n + BigInt(b);
  let result = '';
  while (n > 0n) { result = BASE58_ALPHABET[Number(n % 58n)] + result; n /= 58n; }
  for (const b of bytes) { if (b !== 0) break; result = '1' + result; }
  return result;
}

function toMultibase(prefix, keyBytes) {
  const buf = new Uint8Array(prefix.length + keyBytes.length);
  buf.set(prefix); buf.set(keyBytes, prefix.length);
  return 'z' + bytesToBase58(buf);
}

function b64urlToBytes(b64url) {
  return Uint8Array.from(atob(b64url.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0));
}

async function generateSignerJson() {
  const { privateKey, publicKey } = await crypto.subtle.generateKey(
    { name: 'Ed25519' }, true, ['sign', 'verify']
  );
  const pubJwk  = await crypto.subtle.exportKey('jwk', publicKey);
  const privJwk = await crypto.subtle.exportKey('jwk', privateKey);
  const pubBytes  = b64urlToBytes(pubJwk.x);
  const privBytes = b64urlToBytes(privJwk.d);
  const publicKeyMultibase  = toMultibase(ED25519_PUB_PREFIX,  pubBytes);
  const privateKeyMultibase = toMultibase(ED25519_PRIV_PREFIX, privBytes);
  const controller = `did:key:${publicKeyMultibase}`;
  return JSON.stringify({ publicKeyMultibase, privateKeyMultibase, controller });
}

let _signerJson = safeEnv('PLAN98_WAS_SIGNER');
let _spaceId    = safeEnv('PLAN98_WAS_SPACE_ID');

if (!_signerJson || !_spaceId) {
  if (!_signerJson) _signerJson = await generateSignerJson();
  if (!_spaceId)    _spaceId    = crypto.randomUUID();
  console.log('\ngenerated ephemeral keycard — persist in .env to survive restart:');
  console.log(`PLAN98_WAS_SPACE_ID=${_spaceId}`);
  console.log(`PLAN98_WAS_SIGNER='${_signerJson}'\n`);
}
// --- end keycard bootstrap ---

// --- live reload SSE ---
const reloadClients = new Set();
const enc = new TextEncoder();

function broadcastReload() {
  for (const ctrl of reloadClients) {
    try { ctrl.enqueue(enc.encode('data: reload\n\n')); } catch { reloadClients.delete(ctrl); }
  }
}

const RELOAD_SCRIPT = `<script>(()=>{const e=new EventSource('/__reload');e.onmessage=()=>location.reload()})()</script>`;
// --- end live reload ---

function buildEnvScript() {
  const env = {
    OLLAMA_HOST:         safeEnv('OLLAMA_HOST',    'http://localhost:11434/v1'),
    OLLAMA_KEY:          safeEnv('OLLAMA_KEY',      'ollama'),
    ANTHROPIC_API_KEY:   safeEnv('ANTHROPIC_API_KEY'),
    PLAN98_WAS_HOST:     safeEnv('PLAN98_WAS_HOST', 'http://localhost:1088'),
    PLAN98_WAS_SPACE_ID: _spaceId,
    PLAN98_WAS_SIGNER:   _signerJson,
  };
  const entries = Object.entries(env).map(([k, v]) => `${k}: ${JSON.stringify(v)}`).join(', ');
  return `<script>plan98 = { env: { ${entries} }, registry: {} }</script>`;
}

function injectEnv(html) {
  return html.replace('</head>', buildEnvScript() + RELOAD_SCRIPT + '</head>');
}

async function getBaseHTML() {
  try {
    return await Deno.readTextFile(`${DIST}index.html`);
  } catch {
    console.error(`error: dist/index.html not found — run ./plan1.sh build first`);
    Deno.exit(1);
  }
}

function injectApp(html, tag, attrs = '') {
  return html.replace(
    /<main[^>]*>[\s\S]*?<\/main>/,
    `<main id="main"><${tag}${attrs}></${tag}></main>`
  );
}

async function adminPage(requestUrl) {
  const passphrase = safeEnv('PLAN1_PASSPHRASE');
  if (!passphrase) return new Response(
    'set PLAN1_PASSPHRASE in .env to enable /admin/',
    { status: 503, headers: { 'content-type': 'text/plain' } }
  );

  const { default: CryptoJS } = await import('npm:crypto-js');
  const { default: QRCode }   = await import('npm:qrcode');

  const wasHost = safeEnv('PLAN98_WAS_HOST', 'http://localhost:1088');
  const payload = {
    jsonrpc: '2.0',
    method: 'import-keycard',
    params: {
      type: 'keycard',
      keycard: {
        id: _spaceId,
        title: 'Memex',
        src: '/app/time-machine',
        asJSON: JSON.parse(_signerJson),
        host: wasHost,
      }
    }
  };

  const encrypted = CryptoJS.AES.encrypt(btoa(JSON.stringify(payload)), passphrase).toString();
  const keycardUrl = `${requestUrl.origin}/app/plan98-wallet?data=${encodeURIComponent(encrypted)}`;
  const svg = await QRCode.toString(keycardUrl, { type: 'svg', margin: 2 });

  return new Response(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>plan1 / admin</title>
  <style>
    body { margin: 0; min-height: 100dvh; display: flex; flex-direction: column;
           align-items: center; justify-content: center; font-family: 'BerkeleyMono', monospace;
           background: lemonchiffon; gap: 1rem; }
    h1 { font-size: 1rem; margin: 0; }
    .qr { width: min(80vmin, 360px); height: min(80vmin, 360px); }
    .qr svg { width: 100%; height: 100%; }
    p { font-size: .75rem; opacity: .5; margin: 0; }
  </style>
</head>
<body>
  <h1>scan to import keycard</h1>
  <div class="qr">${svg}</div>
  <p>requires PLAN1_PASSPHRASE on the receiving device</p>
</body>
</html>`, { headers: { 'content-type': 'text/html; charset=utf-8' } });
}

const ISOLATION_HEADERS = {
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Embedder-Policy': 'credentialless',
};

function addIsolation(res) {
  const h = new Headers(res.headers);
  for (const [k, v] of Object.entries(ISOLATION_HEADERS)) h.set(k, v);
  return new Response(res.body, { status: res.status, statusText: res.statusText, headers: h });
}

Deno.serve({ port: PORT }, async (request) => {
  const res = await handleRequest(request);
  return addIsolation(res);
});

async function handleRequest(request) {
  const url = new URL(request.url);
  let path = decodeURIComponent(url.pathname);

  if (path === '/') path = '/index.html';

  if (path === '/admin' || path === '/admin/') return adminPage(url);

  // live reload — SSE stream
  if (path === '/__reload' && request.method === 'GET') {
    let ctrl;
    const stream = new ReadableStream({
      start(c) { ctrl = c; reloadClients.add(c); },
      cancel() { reloadClients.delete(ctrl); },
    });
    return new Response(stream, {
      headers: {
        'content-type': 'text/event-stream',
        'cache-control': 'no-cache',
        'connection': 'keep-alive',
      },
    });
  }

  // live reload — trigger broadcast
  if (path === '/__reload' && request.method === 'POST') {
    broadcastReload();
    return new Response('ok');
  }

  if (path.startsWith('/app/')) {
    const tag = path.split('/app/')[1].split('/')[0];
    let attrs = '';
    for (const [k, v] of url.searchParams) {
      attrs += ` ${k}="${v}"`;
    }
    const html = await getBaseHTML();
    return new Response(injectEnv(injectApp(html, tag, attrs)), {
      headers: { 'content-type': 'text/html; charset=utf-8' },
    });
  }

  const res = await serveDir(request, { fsRoot: DIST, quiet: true });

  if (res.status === 404) {
    return new Response(injectEnv(await getBaseHTML()), {
      status: 200,
      headers: { 'content-type': 'text/html; charset=utf-8' },
    });
  }

  const ct = res.headers.get('content-type') ?? '';
  if (ct.includes('text/html') && res.status !== 304 && res.status !== 204) {
    const text = await res.text();
    const headers = new Headers(res.headers);
    headers.delete('content-length'); // length changes after env injection
    return new Response(injectEnv(text), { status: res.status, headers });
  }

  return res;
}

console.log(`serving dist/ on http://localhost:${PORT}`);
console.log(`open http://localhost:${PORT}/app/private-ai`);
