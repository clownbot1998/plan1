// plan1 app server — serves dist/, handles /app/<tag> routing
const DIST = new URL('./dist/', import.meta.url).pathname;
const PORT = Number(Deno.env.get('PLAN1_PORT') ?? 1998);

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
    return new Response(injectApp(tag, attrs), {
      headers: { 'content-type': 'text/html; charset=utf-8' },
    });
  }

  try {
    const file = await Deno.open(DIST + path.slice(1), { read: true });
    return new Response(file.readable, {
      headers: { 'content-type': mimeType(path) },
    });
  } catch {
    return new Response(baseHTML, {
      status: 200,
      headers: { 'content-type': 'text/html; charset=utf-8' },
    });
  }
});

console.log(`serving dist/ on http://localhost:${PORT}`);
console.log(`open http://localhost:${PORT}/app/private-ai`);
