// plan1 app server — serves dist/, handles /app/<tag> routing
import { serveDir } from 'jsr:@std/http/file-server';
import { Ed25519Signer } from 'npm:@did.coop/did-key-ed25519@0.0.14';
import { StorageClient } from 'npm:@wallet.storage/fetch-client@^1.1.3';

const DIST = new URL('./dist/', import.meta.url).pathname;
const PORT = Number(Deno.env.get('PLAN1_PORT') ?? 1998);

function safeEnv(key, fallback = '') {
  return Deno.env.get(key) ?? fallback;
}

function getContentTypeByPath(p) {
  const ext = p.split('.').pop()?.toLowerCase() ?? '';
  return ({
    js: 'text/javascript', mjs: 'text/javascript',
    css: 'text/css', html: 'text/html; charset=utf-8',
    json: 'application/json', svg: 'image/svg+xml',
    png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg',
    gif: 'image/gif', webp: 'image/webp', ico: 'image/x-icon',
    wasm: 'application/wasm', mp3: 'audio/mpeg', wav: 'audio/wav',
    mp4: 'video/mp4', webm: 'video/webm',
  })[ext] ?? 'application/octet-stream';
}

// --- keycard bootstrap (uses @did.coop/did-key-ed25519 so format is wallet-compatible) ---
const _savedSignerJson = safeEnv('PLAN98_WAS_SIGNER');
let _spaceId = safeEnv('PLAN98_WAS_SPACE_ID');

const _signer = _savedSignerJson
  ? await Ed25519Signer.fromJSON(_savedSignerJson)
  : await Ed25519Signer.generate();

const _signerJson = JSON.stringify(_signer.toJSON());

if (!_savedSignerJson || !_spaceId) {
  if (!_spaceId) _spaceId = crypto.randomUUID();
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

// /admin/ — the ticket booth.
// Knowing PLAN1_PASSPHRASE lets you scan the QR, decrypt the root keycard,
// and import it into plan98-wallet. The keycard grants write access to the
// same WAS space the server reads from. Default (no passphrase) = disk only.
async function adminPage() {
  const passphrase = safeEnv('PLAN1_PASSPHRASE');
  if (!passphrase) return new Response(
    'set PLAN1_PASSPHRASE in .env to enable /admin/',
    { status: 503, headers: { 'content-type': 'text/plain' } }
  );

  const { default: CryptoJS } = await import('npm:crypto-js');

  const wasHost = safeEnv('PLAN98_WAS_HOST', 'http://localhost:1088');
  const payload = {
    jsonrpc: '2.0',
    method: 'import-keycard',
    params: {
      type: 'keycard',
      keycard: {
        id: _spaceId,
        title: 'plan1',
        src: '/app/time-machine',
        asJSON: JSON.parse(_signerJson),
        host: wasHost,
      }
    }
  };

  const encrypted = CryptoJS.AES.encrypt(btoa(JSON.stringify(payload)), passphrase).toString();
  const safeKeycard = encodeURIComponent(encrypted);

  const body = `
    <div style="background: white; height: 100%; width: 100%; overflow: hidden; display: flex; align-items: center; justify-content: center;">
      <qr-code lazy-prefix="true" src="/app/plan98-wallet?data=${safeKeycard}" style="width: 75vmin; height: 75vmin;" target="_top"></qr-code>
    </div>
  `;

  const html = (await getBaseHTML())
    .replace(/<main[^>]*>[\s\S]*?<\/main>/, `<main id="main">${body}</main>`);

  return new Response(injectEnv(html), {
    headers: { 'content-type': 'text/html; charset=utf-8' }
  });
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

  if (path === '/admin' || path === '/admin/') return adminPage();

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
    const wasHost = safeEnv('PLAN98_WAS_HOST');
    if (wasHost && _spaceId) {
      try {
        const storage = new StorageClient(new URL(wasHost));
        const space = storage.space({ signer: _signer, id: `urn:uuid:${_spaceId}` });
        const wasRes = await space.resource(path).get({ signer: _signer }).catch(() => null);
        if (wasRes?.status === 200) {
          console.log('Serving ' + path + ' from WAS ' + _spaceId);
          const ct = getContentTypeByPath(path);
          const headers = new Headers({ 'content-type': ct });
          for (const [k, v] of Object.entries(ISOLATION_HEADERS)) headers.set(k, v);
          return new Response(await wasRes.blob(), { status: 200, headers });
        }
      } catch (e) {
        console.error('WAS fallback error:', e.message);
      }
    }
    // extensionless unknown path → 404 canvas (flip-book seeded by URL)
    const hasExt = path.includes('.', path.lastIndexOf('/') + 1);
    if (!hasExt && path !== '/') {
      const html = await getBaseHTML();
      return new Response(injectEnv(injectApp(html, 'flip-book', ` id="${path}"`)), {
        status: 200,
        headers: { 'content-type': 'text/html; charset=utf-8' },
      });
    }
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
