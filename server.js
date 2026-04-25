// plan1 app server — serves dist/, handles /app/<tag> routing
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
  return html.replace('</head>', buildEnvScript() + '</head>');
}

let baseHTML;
try {
  baseHTML = await Deno.readTextFile(`${DIST}index.html`);
} catch {
  console.error(`error: dist/index.html not found — run ./plan1.sh build first`);
  Deno.exit(1);
}

const TYPES = {
  html: 'text/html; charset=utf-8',
  js: 'text/javascript',
  mjs: 'text/javascript',
  cjs: 'text/javascript',
  css: 'text/css',
  json: 'application/json',
  svg: 'image/svg+xml',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  ico: 'image/x-icon',
  woff: 'font/woff',
  woff2: 'font/woff2',
  ttf: 'font/ttf',
  mp3: 'audio/mpeg',
  mp4: 'video/mp4',
  webm: 'video/webm',
  txt: 'text/plain',
  md: 'text/markdown',
  saga: 'text/plain',
};

function mimeType(path) {
  const ext = path.split('.').pop()?.toLowerCase() ?? '';
  return TYPES[ext] ?? 'application/octet-stream';
}

function injectApp(tag, attrs = '') {
  return baseHTML.replace(
    /<main[^>]*>[\s\S]*?<\/main>/,
    `<main id="main"><${tag}${attrs}></${tag}></main>`
  );
}

Deno.serve({ port: PORT }, async (request) => {
  const url = new URL(request.url);
  let path = decodeURIComponent(url.pathname);

  if (path === '/') path = '/index.html';

  if (path.startsWith('/app/')) {
    const tag = path.split('/app/')[1].split('/')[0];
    let attrs = '';
    for (const [k, v] of url.searchParams) {
      attrs += ` ${k}="${v}"`;
    }
    return new Response(injectEnv(injectApp(tag, attrs)), {
      headers: { 'content-type': 'text/html; charset=utf-8' },
    });
  }

  try {
    const file = await Deno.open(DIST + path.slice(1), { read: true });
    const ct = mimeType(path);
    if (ct === 'text/html; charset=utf-8') {
      const text = await Deno.readTextFile(DIST + path.slice(1));
      return new Response(injectEnv(text), { headers: { 'content-type': ct } });
    }
    return new Response(file.readable, { headers: { 'content-type': ct } });
  } catch {
    return new Response(injectEnv(baseHTML), {
      status: 200,
      headers: { 'content-type': 'text/html; charset=utf-8' },
    });
  }
});

console.log(`serving dist/ on http://localhost:${PORT}`);
console.log(`open http://localhost:${PORT}/app/private-ai`);
