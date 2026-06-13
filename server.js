// plan1 app server — serves dist/, handles /app/<tag> routing
import { serveDir } from 'jsr:@std/http/file-server';
import { Ed25519Signer } from 'npm:@did.coop/did-key-ed25519@0.0.14';
import { StorageClient } from 'npm:@wallet.storage/fetch-client@^1.1.3';
import { resolve } from 'node:path';

const DIST    = (Deno.env.get('PLAN1_DIST') || new URL('./dist/', import.meta.url).pathname).replace(/\/?$/, '/');
const PRIVATE = new URL('./private/', import.meta.url).pathname;
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


// --- session cookie auth ---
async function sha256hex(str) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(str));
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
}

const _passphrase = safeEnv('PLAN1_PASSPHRASE');
// stable session token = sha256(passphrase + server secret); survives restarts with same env
const _serverSecret = safeEnv('PLAN1_SESSION_SECRET') || crypto.randomUUID();
const _sessionToken = _passphrase ? await sha256hex(_passphrase + _serverSecret) : '';

const SESSION_COOKIE = 'plan1_session';
const _deployKey = safeEnv('PLAN1_DEPLOY_KEY');

function checkAuth(request) {
  if (!_sessionToken) return true; // no passphrase set = open (localhost dev)
  const cookie = request.headers.get('cookie') ?? '';
  const match = cookie.match(/(?:^|;\s*)plan1_session=([^;]+)/);
  return match?.[1] === _sessionToken;
}

function sessionCookieHeader(secure) {
  const flags = `HttpOnly; SameSite=Strict; Path=/${secure ? '; Secure' : ''}`;
  return `${SESSION_COOKIE}=${_sessionToken}; ${flags}`;
}

// prevent path traversal: resolve filePath relative to DIST and assert it stays inside
function safeDistPath(filePath) {
  const resolved = resolve(DIST, filePath.replace(/^\/+/, ''));
  if (!resolved.startsWith(DIST.replace(/\/$/, ''))) return null;
  return resolved;
}

// --- live reload WebSocket ---
const reloadClients = new Set();
const enc = new TextEncoder();

// --- braid collaboration state ---
const braidState = new Map();   // filePath -> { text, version, subs: Set }
const braidLoading = new Map(); // filePath -> Promise<state>  (in-flight dedup)
const _loginAttempts = new Map(); // ip -> { count, until }

// --- wg-easy session (cached server-side; re-auth on 401) ---
let _wgSid = '';
async function wgAuth() {
  const wgUrl = safeEnv('WG_EASY_URL', 'http://localhost:51821');
  const wgPass = safeEnv('WG_EASY_PASSWORD', 'clownbot');
  try {
    const resp = await fetch(`${wgUrl}/api/session`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ password: wgPass }),
    });
    const cookie = resp.headers.get('set-cookie') ?? '';
    _wgSid = cookie.match(/connect\.sid=([^;]+)/)?.[1] ?? '';
    return _wgSid;
  } catch {
    return '';
  }
}

async function getBraidResource(filePath) {
  if (braidState.has(filePath)) return braidState.get(filePath);
  if (braidLoading.has(filePath)) return braidLoading.get(filePath);
  const p = (async () => {
    let text = '';
    try { text = await Deno.readTextFile(DIST + filePath); } catch { /* new file */ }
    const state = { text, version: '"v0"', subs: new Set() };
    braidState.set(filePath, state);
    braidLoading.delete(filePath);
    return state;
  })();
  braidLoading.set(filePath, p);
  return p;
}

function makeBraidBytes(versionHdr, parentHdr, contentRange, body) {
  let hdr = `HTTP 200 OK\r\nVersion: ${versionHdr}\r\n`;
  // always include Parents (empty string = [] = initial state); undefined.sort() throws in simpleton
  if (parentHdr != null) hdr += `Parents: ${parentHdr}\r\n`;
  const bodyBytes = enc.encode(body);
  if (contentRange) hdr += `Content-Length: ${bodyBytes.length}\r\nContent-Range: ${contentRange}\r\n\r\n`;
  else              hdr += `Content-Length: ${bodyBytes.length}\r\n\r\n`;
  const hdrBytes = enc.encode(hdr);
  const tail = enc.encode('\r\n\r\n');
  const out = new Uint8Array(hdrBytes.length + bodyBytes.length + tail.length);
  out.set(hdrBytes); out.set(bodyBytes, hdrBytes.length); out.set(tail, hdrBytes.length + bodyBytes.length);
  return out;
}
// --- end braid ---

function broadcastReload() {
  for (const ws of reloadClients) {
    try { ws.send('reload'); } catch { reloadClients.delete(ws); }
  }
}

const RELOAD_SCRIPT = `<script>(()=>{function connect(){const ws=new WebSocket((location.protocol==='https:'?'wss':'ws')+'://'+location.host+'/__reload');ws.onmessage=()=>location.reload();ws.onclose=()=>setTimeout(connect,1000)}connect()})()</script>`;
// --- end live reload ---

function buildEnvScript(isAdmin = false) {
  const env = {
    OLLAMA_HOST:         safeEnv('OLLAMA_HOST',    'http://localhost:11434/v1'),
    OLLAMA_KEY:          safeEnv('OLLAMA_KEY',      'ollama'),
    ANTHROPIC_API_KEY:   safeEnv('ANTHROPIC_API_KEY'),
    LIBRE_TRANSLATE_URL:  safeEnv('LIBRE_TRANSLATE_URL'),
    ELEVEN_LABS_API_KEY:  safeEnv('ELEVEN_LABS_API_KEY'),
    PLAN98_WAS_HOST:     safeEnv('PLAN98_WAS_HOST', 'http://localhost:1088'),
    PLAN98_WAS_SPACE_ID: _spaceId,
    PLAN98_WAS_SIGNER:   _signerJson,
    PLAN98_REALTIME:     safeEnv('PLAN98_REALTIME'),
    HEAVY_ASSET_CDN_URL: safeEnv('HEAVY_ASSET_CDN_URL'),
    PLAN98_GECKOS_URL:   safeEnv('PLAN98_GECKOS_URL'),
  };
  if (isAdmin) {
    env.PLAN98_APP_ID        = safeEnv('PLAN98_APP_ID');
    env.PLAN98_APP_SECRET    = safeEnv('PLAN98_APP_SECRET');
    env.PLAN98_BASE_URL      = safeEnv('PLAN98_BASE_URL');
    env.PLAN98_PUBLIC_KEY    = safeEnv('PLAN98_PUBLIC_KEY');
  }
  const entries = Object.entries(env).map(([k, v]) => `${k}: ${JSON.stringify(v)}`).join(', ');
  return `<script>plan98 = { env: { ${entries} }, registry: {} }</script>`;
}

function injectEnv(html, isAdmin = false) {
  return html.replace('</head>', buildEnvScript(isAdmin) + RELOAD_SCRIPT + '</head>');
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
async function adminPage(request) {
  const passphrase = safeEnv('PLAN1_PASSPHRASE');
  if (!passphrase) return new Response(
    'set PLAN1_PASSPHRASE in .env to enable /admin/',
    { status: 503, headers: { 'content-type': 'text/plain' } }
  );

  if (!checkAuth(request)) {
    const loginHtml = `<!DOCTYPE html><html><head><meta charset="utf-8">
<style>*{box-sizing:border-box}body{margin:0;background:#1d2021;height:100vh;display:flex;align-items:center;justify-content:center;font-family:monospace}form{display:flex;flex-direction:column;gap:1rem;padding:2rem;background:#282828;border-radius:4px}label{color:#ebdbb2}input{padding:.5rem;background:#3c3836;color:#ebdbb2;border:1px solid #504945;border-radius:2px;font-family:monospace;font-size:1rem}button{padding:.5rem 1rem;background:#458588;color:#ebdbb2;border:none;border-radius:2px;font-family:monospace;font-size:1rem;cursor:pointer}#err{color:#cc241d;display:none}</style>
</head><body>
<form id="lf">
  <label>passphrase</label>
  <input id="pp" type="password" autocomplete="current-password" autofocus />
  <button type="submit">unlock</button>
  <div id="err">wrong passphrase</div>
</form>
<script>
document.getElementById('lf').addEventListener('submit', async e => {
  e.preventDefault();
  const res = await fetch('/api/login', {
    method: 'POST',
    headers: {'content-type':'application/json'},
    body: JSON.stringify({ passphrase: document.getElementById('pp').value }),
  });
  const data = await res.json().catch(() => ({}));
  if (res.ok) { const p = new URLSearchParams(location.search).get('next'); location.href = p || '/admin'; }
  else {
    const err = document.getElementById('err');
    err.style.display = 'block';
    if (res.status === 429) { err.textContent = 'locked out — try again in ' + data.retryAfter + 's'; startCountdown(data.retryAfter); }
    else if (data.remaining === 0) { err.textContent = 'locked — try again in ' + data.retryAfter + 's'; startCountdown(data.retryAfter); }
    else err.textContent = 'wrong passphrase — ' + data.remaining + ' attempt' + (data.remaining === 1 ? '' : 's') + ' left';
  }
});
function startCountdown(secs) {
  const btn = document.querySelector('button');
  const err = document.getElementById('err');
  btn.disabled = true;
  let t = secs;
  const iv = setInterval(() => {
    t--;
    if (t <= 0) { clearInterval(iv); btn.disabled = false; err.style.display = 'block'; err.textContent = 'try again'; }
    else err.textContent = 'locked — try again in ' + t + 's';
  }, 1000);
}
</script>
</body></html>`;
    return new Response(loginHtml, { headers: { 'content-type': 'text/html; charset=utf-8' } });
  }

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
  const ct = res.headers.get('content-type') ?? ''
  if (!ct.includes('text/html')) return res
  const h = new Headers(res.headers);
  for (const [k, v] of Object.entries(ISOLATION_HEADERS)) h.set(k, v);
  return new Response(res.body, { status: res.status, statusText: res.statusText, headers: h });
}

// Allow embedding in a COEP credentialless parent without adding COEP itself.
// Needed for pages excluded from COEP (vosk blob-worker pages) that we want
// to iframe from pages that do have COEP.
function addEmbeddable(res) {
  const h = new Headers(res.headers);
  h.set('Cross-Origin-Resource-Policy', 'cross-origin');
  return new Response(res.body, { status: res.status, statusText: res.statusText, headers: h });
}

// Pages that use blob workers with fetch (vosk-browser) can't run under COEP —
// Safari treats blob workers as null-origin, blocking same-origin fetches.
// ffmpeg pages still need COEP for SharedArrayBuffer.
const NO_COEP_PATHS = ['/app/hail-mary', '/app/ur-shell'];

const TTYD_BIN = '/home/clownbot/bin/ttyd'
const SESSION_PORTS = new Map() // sessionName → port
const partyRooms = new Map()   // partyId → { host, slots[4] }
const signalRooms = new Map()  // roomId → Map<peerId, ws>

async function spawnTtydSession(sessionName) {
  if (SESSION_PORTS.has(sessionName)) {
    const port = SESSION_PORTS.get(sessionName)
    try { await fetch(`http://localhost:${port}/`); return port } catch { SESSION_PORTS.delete(sessionName) }
  }
  // find a free port in 7700-7900
  let port = null
  for (let p = 7700; p < 7900; p++) {
    if ([...SESSION_PORTS.values()].includes(p)) continue
    try { const l = Deno.listen({ port: p }); l.close(); port = p; break } catch { /* in use */ }
  }
  if (!port) return null
  const tmuxArgs = sessionName === 'new'
    ? ['tmux', 'new-session']
    : ['tmux', 'new-session', '-A', '-s', sessionName]
  new Deno.Command(TTYD_BIN, { args: ['-p', String(port), '--once', '--writable', ...tmuxArgs] }).spawn()
  if (sessionName !== 'new') SESSION_PORTS.set(sessionName, port)
  // wait for ttyd to be ready (up to 2s)
  for (let i = 0; i < 20; i++) {
    await new Promise(r => setTimeout(r, 100))
    try { const r = await fetch(`http://localhost:${port}/`); if (r.ok) return port } catch { /* not yet */ }
  }
  return null
}

Deno.serve({ port: PORT }, async (request) => {
  const res = await handleRequest(request);
  const { pathname } = new URL(request.url);
  if (NO_COEP_PATHS.some(p => pathname.startsWith(p))) return addEmbeddable(res);
  return addIsolation(res);
});

async function handleRequest(request) {
  const url = new URL(request.url);
  let path = decodeURIComponent(url.pathname);

  if (path === '/') path = '/index.html';

  if (path === '/admin' || path === '/admin/') return adminPage(request);

  // login — POST /api/login { passphrase } → sets session cookie
  if (path === '/api/login' && request.method === 'POST') {
    if (!_passphrase) return new Response('no passphrase configured', { status: 503 });
    const ip = request.headers.get('x-forwarded-for')?.split(',')[0].trim() ?? 'unknown';
    const now = Date.now();
    const attempts = _loginAttempts.get(ip) ?? { count: 0, until: 0 };
    if (now < attempts.until) {
      const secs = Math.ceil((attempts.until - now) / 1000);
      return new Response(JSON.stringify({ error: 'locked', retryAfter: secs }), {
        status: 429,
        headers: { 'content-type': 'application/json', 'retry-after': String(secs) },
      });
    }
    let body;
    try { body = await request.json(); } catch { return new Response('bad request', { status: 400 }); }
    if (body?.passphrase !== _passphrase) {
      attempts.count += 1;
      const remaining = Math.max(0, 3 - attempts.count);
      if (attempts.count >= 3) attempts.until = now + Math.min((attempts.count - 2) * 30_000, 3_600_000);
      _loginAttempts.set(ip, attempts);
      return new Response(JSON.stringify({ error: 'wrong passphrase', remaining, locked: attempts.count >= 3, retryAfter: attempts.until ? Math.ceil((attempts.until - now) / 1000) : 0 }), {
        status: 401, headers: { 'content-type': 'application/json' },
      });
    }
    _loginAttempts.delete(ip);
    // detect if request arrived over HTTPS (Caddy sets X-Forwarded-Proto)
    const secure = request.headers.get('x-forwarded-proto') === 'https';
    return new Response('ok', {
      headers: {
        'content-type': 'text/plain',
        'set-cookie': sessionCookieHeader(secure),
      },
    });
  }

  // braid collaboration — /braid/<filePath> (in-memory only; no disk writes)
  if (path.startsWith('/braid/') && (request.method === 'GET' || request.method === 'PUT')) {
    const filePath = path.slice(6); // '/braid/plan98.js' → '/plan98.js'
    if (!safeDistPath(filePath)) return new Response('forbidden', { status: 403 });
    const state = await getBraidResource(filePath);

    if (request.method === 'GET') {
      let ctrl;
      const stream = new ReadableStream({
        start(c) {
          ctrl = c;
          state.subs.add(c);
          console.log(`braid SUB ${filePath} subs=${state.subs.size}`);
          c.enqueue(makeBraidBytes(state.version, '', null, state.text));
        },
        cancel() {
          state.subs.delete(ctrl);
          console.log(`braid UNSUB ${filePath} subs=${state.subs.size}`);
        },
      });
      return new Response(stream, {
        status: 209,
        headers: {
          'content-type': 'text/plain; charset=utf-8',
          'subscribe': 'true',
          'cache-control': 'no-cache, no-transform',
          'x-accel-buffering': 'no',
          'access-control-allow-origin': '*',
        },
      });
    }

    if (request.method === 'PUT') {
      if (!checkAuth(request)) return new Response('unauthorized', { status: 401 });
      const versionHdr  = request.headers.get('Version')  ?? `"upd-${Date.now()}"`;
      const parentHdr   = request.headers.get('Parents');
      const contentRange = request.headers.get('Content-Range');
      const patchText   = await request.text();
      const prevVersion = state.version;

      if (contentRange) {
        const digits = contentRange.match(/\d+/g);
        if (digits?.length >= 2) {
          const s = parseInt(digits[0]), e = parseInt(digits[1]);
          state.text = state.text.slice(0, s) + patchText + state.text.slice(e);
        }
      } else {
        state.text = patchText;
      }
      state.version = versionHdr;

      // broadcast to all subscribers (parents = previous server version)
      const update = makeBraidBytes(versionHdr, prevVersion, contentRange, patchText);
      console.log(`braid PUT ${filePath} subs=${state.subs.size} ver=${versionHdr} range=${contentRange ?? 'full'}`);
      for (const sub of state.subs) {
        try { sub.enqueue(update); } catch { state.subs.delete(sub); }
      }

      return new Response('ok', { headers: { 'access-control-allow-origin': '*' } });
    }
  }

  // explicit save — /save/<filePath> — writes to dist/ and WAS
  if (path.startsWith('/save/') && request.method === 'PUT') {
    if (!checkAuth(request)) return new Response('unauthorized', { status: 401 });
    const filePath = path.slice(5); // '/save/plan98.js' → '/plan98.js'
    const distPath = safeDistPath(filePath);
    if (!distPath) return new Response('forbidden', { status: 403 });

    const text = await request.text();

    // update in-memory braid state so subscribers stay consistent
    const state = await getBraidResource(filePath);
    state.text = text;
    state.version = `"save-${Date.now()}"`;

    Deno.writeTextFile(distPath, text).then(() => {
      console.log(`save: wrote ${text.length}B → ${distPath}`);
    }).catch(console.error);

    const wasHostStr = safeEnv('PLAN98_WAS_HOST');
    if (wasHostStr && _spaceId) {
      const wasStorage = new StorageClient(new URL(wasHostStr));
      const wasSpace   = wasStorage.space({ signer: _signer, id: `urn:uuid:${_spaceId}` });
      const ct = getContentTypeByPath(filePath);
      wasSpace.resource(filePath.replace(/^\//, '')).put(new Blob([text], { type: ct }), { signer: _signer }).catch(console.error);
    }

    return new Response('saved', { headers: { 'access-control-allow-origin': '*' } });
  }

  // /api/wg/* → wg-easy proxy (requires plan1 auth)
  if (path.startsWith('/api/wg/')) {
    if (!checkAuth(request)) return new Response('unauthorized', { status: 401 });
    const wgUrl = safeEnv('WG_EASY_URL', 'http://localhost:51821');
    const upstream = wgUrl + '/api' + path.slice('/api/wg'.length) + url.search;
    if (!_wgSid) await wgAuth();
    const doReq = async (sid) => {
      const headers = new Headers();
      headers.set('cookie', `connect.sid=${sid}`);
      const ct = request.headers.get('content-type');
      if (ct) headers.set('content-type', ct);
      return fetch(upstream, {
        method: request.method,
        headers,
        body: ['GET', 'HEAD'].includes(request.method) ? undefined : (await request.blob()),
      });
    };
    try {
      let resp = await doReq(_wgSid);
      if (resp.status === 401) {
        await wgAuth();
        resp = await doReq(_wgSid);
      }
      const ct = resp.headers.get('content-type') ?? 'application/octet-stream';
      return new Response(resp.body, { status: resp.status, headers: { 'content-type': ct, 'access-control-allow-origin': '*' } });
    } catch (e) {
      return new Response(JSON.stringify({ error: String(e) }), { status: 502, headers: { 'content-type': 'application/json' } });
    }
  }

  // /api/translate → libretranslate proxy (avoids mixed-content + CORS from browser)
  if (path === '/api/translate') {
    const libreUrl = safeEnv('LIBRE_TRANSLATE_URL')
    if (!libreUrl) return new Response('LIBRE_TRANSLATE_URL not configured', { status: 503 })
    try {
      const body = await request.text()
      const resp = await fetch(`${libreUrl}/translate`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body,
      })
      const data = await resp.text()
      return new Response(data, {
        status: resp.status,
        headers: { 'content-type': 'application/json', 'access-control-allow-origin': '*' },
      })
    } catch (e) {
      return new Response(JSON.stringify({ error: String(e) }), { status: 502, headers: { 'content-type': 'application/json' } })
    }
  }

  // /api/exec — run a shell command, return output; requires session auth
  if (path === '/api/exec' && request.method === 'POST') {
    if (!checkAuth(request)) return new Response('unauthorized', { status: 401 })
    let body
    try { body = await request.json() } catch { return new Response('bad json', { status: 400 }) }
    const { command, args } = body
    if (!command || typeof command !== 'string' || command.includes('/') || command.includes('..')) {
      return new Response(JSON.stringify({ error: 'invalid command' }), { status: 400, headers: { 'content-type': 'application/json' } })
    }
    const argList = typeof args === 'string' ? args.split(/\s+/).filter(Boolean) : (Array.isArray(args) ? args : [])
    try {
      const p = new Deno.Command(command, { args: argList, stdout: 'piped', stderr: 'piped' })
      const { stdout, stderr, code } = await p.output()
      const output = new TextDecoder().decode(stdout) + new TextDecoder().decode(stderr)
      return new Response(JSON.stringify({ output, code }), { headers: { 'content-type': 'application/json', 'access-control-allow-origin': '*' } })
    } catch (e) {
      return new Response(JSON.stringify({ error: String(e), code: 1 }), { status: 200, headers: { 'content-type': 'application/json' } })
    }
  }

  // /api/deploy — git pull + build + restart; auth via X-Deploy-Key header or ?key= param
  if (path === '/api/deploy' && request.method === 'POST') {
    const key = request.headers.get('x-deploy-key') || url.searchParams.get('key')
    if (!_deployKey || key !== _deployKey) return new Response('unauthorized', { status: 401 })
    const dir = new URL(import.meta.url).pathname.replace('/server.js', '')
    const run = async (cmd) => {
      const p = new Deno.Command('bash', { args: ['-c', cmd], cwd: dir, stdout: 'piped', stderr: 'piped' })
      const { stdout, stderr } = await p.output()
      return new TextDecoder().decode(stdout) + new TextDecoder().decode(stderr)
    }
    const log = []
    log.push(await run('git pull 2>&1'))
    log.push(await run('./plan1.sh build 2>&1'))
    // sync dist/ → PLAN1_DIST if they differ
    const distDir = dir + '/dist'
    const runtimeDir = Deno.env.get('PLAN1_DIST')
    if (runtimeDir && runtimeDir !== distDir) {
      log.push(await run(`rsync -a --delete ${distDir}/ ${runtimeDir}/`))
    }
    // restart via systemctl; fall back to SIGHUP
    new Deno.Command('bash', {
      args: ['-c', `sleep 1 && (systemctl restart plan1 2>/dev/null || kill -HUP ${Deno.pid})`],
      cwd: dir,
    }).spawn()
    return new Response(log.join('\n'), { headers: { 'content-type': 'text/plain' } })
  }

  // /shell/tools → MCP-shaped JSON index of PATH commands
  if (path === '/shell/tools') {
    if (!checkAuth(request)) return new Response('unauthorized', { status: 401 })
    const pathDirs = (Deno.env.get('PATH') || '').split(':').filter(Boolean)
    const seen = new Set()
    for (const dir of pathDirs) {
      try {
        for await (const entry of Deno.readDir(dir)) {
          if (entry.isFile || entry.isSymlink) seen.add(entry.name)
        }
      } catch { /* skip inaccessible */ }
    }
    const tools = [...seen].sort().map(name => ({
      name,
      description: `run ${name}`,
      inputSchema: {
        type: 'object',
        properties: {
          args: { type: 'string', description: 'arguments to pass' }
        }
      }
    }))
    return new Response(JSON.stringify({ tools }, null, 2), {
      headers: { 'content-type': 'application/json', 'access-control-allow-origin': '*' }
    })
  }

  // /api/anthropic → Anthropic messages API proxy
  if (path === '/api/anthropic') {
    const apiKey = safeEnv('ANTHROPIC_API_KEY')
    if (!apiKey) return new Response('ANTHROPIC_API_KEY not configured', { status: 503 })
    try {
      const body = await request.text()
      const resp = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
        },
        body,
      })
      return new Response(resp.body, {
        status: resp.status,
        headers: {
          'content-type': resp.headers.get('content-type') || 'application/json',
          'access-control-allow-origin': '*',
        },
      })
    } catch (e) {
      return new Response(JSON.stringify({ error: String(e) }), { status: 502, headers: { 'content-type': 'application/json' } })
    }
  }

  // /shell/ → ttyd proxy (HTTP + WebSocket) — requires auth
  if (path === '/shell' || path.startsWith('/shell/')) {
    if (!checkAuth(request)) {
      if (request.headers.get('upgrade') === 'websocket') {
        return new Response('unauthorized', { status: 401 });
      }
      return new Response(null, { status: 302, headers: { location: '/admin?next=' + encodeURIComponent(path) } });
    }
    const stripped = path.slice('/shell'.length) || '/'
    const sessionName = url.searchParams.get('session')
    const ttydPort = sessionName ? await spawnTtydSession(sessionName) : 7681
    if (!ttydPort) return new Response('session unavailable', { status: 502 })
    const qs = sessionName ? '' : url.search
    if (request.headers.get('upgrade') === 'websocket') {
      const proto = request.headers.get('sec-websocket-protocol') ?? undefined
      const { socket: client, response } = Deno.upgradeWebSocket(request, proto ? { protocol: proto } : {})
      const server = new WebSocket(`ws://localhost:${ttydPort}${stripped}${qs}`, proto ? [proto] : [])
      server.binaryType = 'arraybuffer'
      client.binaryType = 'arraybuffer'
      const pending = []
      client.onmessage = e => {
        if (server.readyState === 1) server.send(e.data)
        else pending.push(e.data)
      }
      client.onclose = () => { try { server.close() } catch { /* ignore */ } }
      client.onerror = () => { try { server.close() } catch { /* ignore */ } }
      server.onopen = () => {
        for (const msg of pending.splice(0)) server.send(msg)
      }
      server.onmessage = e => { if (client.readyState === 1) client.send(e.data) }
      server.onclose = () => { try { client.close() } catch { /* ignore */ } }
      server.onerror = () => { try { client.close() } catch { /* ignore */ } }
      return response
    }
    try {
      const resp = await fetch(`http://localhost:${ttydPort}${stripped}${qs}`, {
        method: request.method,
        headers: request.headers,
        body: request.body ?? undefined,
      })
      return new Response(resp.body, { status: resp.status, headers: resp.headers })
    } catch {
      return new Response('shell unavailable', { status: 502 })
    }
  }

  // live reload — WebSocket
  if (path === '/__reload' && request.headers.get('upgrade') === 'websocket') {
    const { socket, response } = Deno.upgradeWebSocket(request);
    socket.onopen = () => { reloadClients.add(socket); };
    socket.onclose = () => { reloadClients.delete(socket); };
    socket.onerror = () => { reloadClients.delete(socket); };
    return response;
  }

  // /api/party — WebSocket multiplayer relay for couch-coop
  if (path === '/api/party' && request.headers.get('upgrade') === 'websocket') {
    const { socket, response } = Deno.upgradeWebSocket(request);
    socket.onopen = () => {
      socket._partyId = null;
      socket._isHost = false;
      socket._slot = null;
    };
    socket.onmessage = (e) => {
      let msg;
      try { msg = JSON.parse(e.data); } catch { return; }
      const { type, payload } = msg;

      if (type === 'joinParty') {
        const { partyId, slot } = payload;
        socket._partyId = partyId;
        if (!partyRooms.has(partyId)) partyRooms.set(partyId, { host: null, slots: new Array(4).fill(null) });
        const room = partyRooms.get(partyId);
        if (slot === 'host') {
          socket._isHost = true;
          room.host = socket;
        } else {
          socket._slot = parseInt(slot);
          room.slots[socket._slot] = socket;
          if (room.host) room.host.send(JSON.stringify({ type: 'playerJoined', payload: { slot } }));
        }
      } else if (type === 'gamestateUpload') {
        const room = partyRooms.get(socket._partyId);
        if (!room) return;
        room.slots.forEach(s => { if (s && s.readyState === WebSocket.OPEN) s.send(JSON.stringify({ type: 'gamestateDownload', payload })); });
      } else if (type === 'gamepadSnapshot') {
        const room = partyRooms.get(socket._partyId);
        if (room?.host?.readyState === WebSocket.OPEN) room.host.send(JSON.stringify({ type: 'gamepadUpdate', payload }));
      } else if (type === 'noteAttack') {
        const room = partyRooms.get(socket._partyId);
        if (room?.host?.readyState === WebSocket.OPEN) room.host.send(JSON.stringify({ type: 'noteAttack', payload }));
      }
    };
    socket.onclose = () => {
      if (!socket._partyId) return;
      const room = partyRooms.get(socket._partyId);
      if (!room) return;
      if (socket._isHost) { room.host = null; }
      else if (socket._slot !== null) { room.slots[socket._slot] = null; }
      if (!room.host && room.slots.every(s => !s)) partyRooms.delete(socket._partyId);
    };
    socket.onerror = socket.onclose;
    return response;
  }

  // /api/signal — WebRTC signaling relay for board-call proximity voice
  if (path === '/api/signal' && request.headers.get('upgrade') === 'websocket') {
    const { socket, response } = Deno.upgradeWebSocket(request)
    const url = new URL(request.url)
    const room = url.searchParams.get('room') || 'default'
    const peer = url.searchParams.get('peer') || ''
    socket.onopen = () => {
      if (!signalRooms.has(room)) signalRooms.set(room, new Map())
      const peers = signalRooms.get(room)
      socket.send(JSON.stringify({ type: 'peers', peers: [...peers.keys()] }))
      peers.forEach(ws => { if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'join', from: peer })) })
      peers.set(peer, socket)
    }
    socket.onmessage = (e) => {
      let msg; try { msg = JSON.parse(e.data) } catch { return }
      const target = signalRooms.get(room)?.get(msg.to)
      if (target?.readyState === WebSocket.OPEN) target.send(JSON.stringify({ ...msg, from: peer }))
    }
    socket.onclose = () => {
      const peers = signalRooms.get(room)
      if (!peers) return
      peers.delete(peer)
      peers.forEach(ws => { if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'leave', from: peer })) })
      if (peers.size === 0) signalRooms.delete(room)
    }
    socket.onerror = socket.onclose
    return response
  }

  // live reload — trigger broadcast
  if (path === '/__reload' && request.method === 'POST') {
    broadcastReload();
    return new Response('ok');
  }

  if (request.method === 'PUT' && path.match(/^\/preview-gallery\/[^/]+\/config$/)) {
    const galleryId = path.split('/')[2]
    const body = await request.json().catch(() => null)
    if (!body) return new Response('invalid json', { status: 400 })
    const wasPath = `/preview-gallery/${galleryId}/index.json`
    const blob = new Blob([JSON.stringify(body)], { type: 'application/json' })
    const storage = new StorageClient(new URL(safeEnv('PLAN98_WAS_HOST', 'http://localhost:1088')))
    const space   = storage.space({ signer: _signer, id: `urn:uuid:${_spaceId}` })
    const res = await space.resource(wasPath).put(blob, { signer: _signer }).catch(e => ({ ok: false, status: 500, text: () => e.message }))
    return new Response(res.ok ? 'ok' : 'write failed', { status: res.ok ? 200 : 500 })
  }

  if (request.method === 'GET' && path.match(/^\/preview-gallery\/[^/]+\/refresh$/)) {
    const galleryId = path.split('/')[2]
    const waitMs    = url.searchParams.get('wait') ?? '2000'
    const script    = new URL('./debugging_utilities/was_gallery.ts', import.meta.url).pathname
    const enc2      = new TextEncoder()
    const stream    = new ReadableStream({
      async start(controller) {
        try {
          const child = new Deno.Command('deno', {
            args: ['run','--allow-run','--allow-net','--allow-env','--allow-read','--allow-write',
                   script, '--id', galleryId, '--wait', waitMs],
            stdout: 'piped', stderr: 'null',
            env: Deno.env.toObject(),
          }).spawn()
          const reader = child.stdout.pipeThrough(new TextDecoderStream()).getReader()
          let buf = ''
          while (true) {
            const { done, value } = await reader.read()
            if (done) break
            buf += value
            const lines = buf.split('\n')
            buf = lines.pop() ?? ''
            for (const line of lines) {
              if (line.trim()) controller.enqueue(enc2.encode(`data: ${JSON.stringify(line)}\n\n`))
            }
          }
          await child.status
          controller.enqueue(enc2.encode(`data: "done"\n\n`))
        } catch(e) {
          controller.enqueue(enc2.encode(`data: ${JSON.stringify('error: ' + e.message)}\n\n`))
        }
        controller.close()
      }
    })
    return new Response(stream, {
      headers: { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', 'connection': 'keep-alive' }
    })
  }

  if (path === '/eyes') {
    const target = url.searchParams.get('url')
    if (!target) return new Response('missing ?url=', { status: 400 })
    const outFile = `/tmp/clown-eyes-${Date.now()}.png`
    const script  = new URL('./debugging_utilities/screenshot.ts', import.meta.url).pathname
    const proc = new Deno.Command('deno', {
      args: ['run', '--allow-run', '--allow-net', '--allow-write', script, target, outFile],
      stdout: 'null', stderr: 'null',
    })
    const { code } = await proc.output()
    if (code !== 0) return new Response('screenshot failed', { status: 500 })
    const bytes = await Deno.readFile(outFile)
    Deno.remove(outFile).catch(() => {})
    return new Response(bytes, { headers: { 'content-type': 'image/png' } })
  }

  if (path === '/plan.md') {
    try {
      const text = await Deno.readTextFile('./plan.md');
      return new Response(text, { headers: { 'content-type': 'text/plain; charset=utf-8' } });
    } catch {
      return new Response('not found', { status: 404 });
    }
  }

  // blog source — list and serve raw markdown
  if (path === '/blog-src/') {
    try {
      const files = [];
      for await (const entry of Deno.readDir('./blog')) {
        if (entry.isFile && entry.name.endsWith('.md')) files.push(entry.name);
      }
      files.sort().reverse();
      return new Response(JSON.stringify(files), { headers: { 'content-type': 'application/json' } });
    } catch {
      return new Response('[]', { headers: { 'content-type': 'application/json' } });
    }
  }

  if (path.startsWith('/blog-src/')) {
    const filename = path.slice(10);
    if (!filename.endsWith('.md') || filename.includes('/') || filename.includes('..')) {
      return new Response('forbidden', { status: 403 });
    }
    try {
      const text = await Deno.readTextFile(`./blog/${filename}`);
      return new Response(text, { headers: { 'content-type': 'text/plain; charset=utf-8' } });
    } catch {
      return new Response('not found', { status: 404 });
    }
  }

  // memory files — list and serve
  if (path === '/memory/') {
    try {
      const files = [];
      for await (const entry of Deno.readDir('./memory')) {
        if (entry.isFile) files.push(entry.name);
      }
      return new Response(JSON.stringify(files), { headers: { 'content-type': 'application/json' } });
    } catch {
      return new Response('[]', { headers: { 'content-type': 'application/json' } });
    }
  }

  if (path.startsWith('/memory/') && path !== '/memory/') {
    const filename = path.slice(8);
    if (filename.includes('/') || filename.includes('..')) {
      return new Response('forbidden', { status: 403 });
    }
    try {
      const text = await Deno.readTextFile(`./memory/${filename}`);
      return new Response(text, { headers: { 'content-type': 'text/plain; charset=utf-8' } });
    } catch {
      return new Response('not found', { status: 404 });
    }
  }

  if (path.startsWith('/app/')) {
    const tag = path.split('/app/')[1].split('/')[0];

    // admin-only apps: redirect to /admin?next=<url> if not authenticated
    const ADMIN_APPS = new Set(['dream-team', 'cyber-security']);
    if (ADMIN_APPS.has(tag) && !checkAuth(request)) {
      return new Response(null, {
        status: 302,
        headers: { location: `/admin?next=${encodeURIComponent(url.pathname + url.search)}` },
      });
    }

    let attrs = '';
    for (const [k, v] of url.searchParams) {
      attrs += ` ${k}="${v}"`;
    }
    const isAdmin = checkAuth(request);
    const html = await getBaseHTML();
    return new Response(injectEnv(injectApp(html, tag, attrs), isAdmin), {
      headers: { 'content-type': 'text/html; charset=utf-8' },
    });
  }

  // serve .tar.gz / .zip with exact content-length so vosk worker doesn't truncate
  if (path.endsWith('.tar.gz') || path.endsWith('.zip')) {
    const filePath = `${DIST}${path.slice(1)}`;
    try {
      const file = await Deno.readFile(filePath);
      return new Response(file, {
        headers: {
          'content-type': path.endsWith('.zip') ? 'application/zip' : 'application/octet-stream',
          'content-length': String(file.byteLength),
          'content-encoding': 'identity',
          'cache-control': 'no-transform',
          'access-control-allow-origin': '*',
          'cross-origin-resource-policy': 'cross-origin',
        },
      });
    } catch {
      // proxy missing model zips from alphacephei.com so blob workers get same-origin response
      if (path.endsWith('.zip') && path.includes('/models/vosk-')) {
        const modelFile = path.split('/').pop();
        const upstream = `https://alphacephei.com/vosk/models/${modelFile}`;
        try {
          const upstreamRes = await fetch(upstream);
          if (upstreamRes.ok) {
            const data = await upstreamRes.arrayBuffer();
            return new Response(data, {
              headers: {
                'content-type': 'application/zip',
                'content-length': String(data.byteLength),
                'content-encoding': 'identity',
                'cache-control': 'no-transform',
                'access-control-allow-origin': '*',
                'cross-origin-resource-policy': 'cross-origin',
              },
            });
          }
        } catch { /* fall through */ }
      }
      return new Response('Not Found', { status: 404 });
    }
  }

  // plan98 serves from /public/ as root; rewrite that prefix so imported assets resolve
  if (path.startsWith('/public/')) {
    const rewritten = new URL(request.url);
    rewritten.pathname = path.slice('/public'.length);
    return fetch(rewritten.toString());
  }

  const res = await serveDir(request, { fsRoot: DIST, quiet: true });

  // serveDir can return text/plain for files whose names contain URL-encoded chars
  // (e.g. vendor deps with ^ encoded as %5E). Override with our own MIME detection.
  if (res.status === 200) {
    const urlPath = decodeURIComponent(new URL(request.url).pathname)
    const ct = getContentTypeByPath(urlPath)
    const existing = res.headers.get('content-type') ?? ''
    if (ct !== 'application/octet-stream' && !existing.includes(ct.split(';')[0])) {
      const h = new Headers(res.headers)
      h.set('content-type', ct)
      return new Response(res.body, { status: 200, statusText: res.statusText, headers: h })
    }
  }

  if (res.status === 404) {
    // private/ filesystem fallback — serves personal assets (samples, photos, etc.) directly
    const privateRes = await serveDir(request, { fsRoot: PRIVATE, urlRoot: 'private', quiet: true });
    if (privateRes.status === 200) return privateRes;

    const wasHost = safeEnv('PLAN98_WAS_HOST');
    if (wasHost && _spaceId) {
      try {
        const storage = new StorageClient(new URL(wasHost));
        const space = storage.space({ signer: _signer, id: `urn:uuid:${_spaceId}` });
        const wasKey = path.replace(/^\//, '');
        const wasRes = await space.resource(wasKey).get({ signer: _signer }).catch(() => null);
        if (wasRes?.status === 200) {
          console.log('Serving ' + path + ' from WAS ' + _spaceId);
          const ct = getContentTypeByPath(path);
          const headers = new Headers({ 'content-type': ct });
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
    return new Response('Not Found', { status: 404 });
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
