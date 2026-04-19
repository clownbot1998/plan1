// run with: qjs --std build.js
'use strict'

// ── path utils ────────────────────────────────────────────────────────────────

function join(...parts) {
  return parts.join('/').replace(/\/+/g, '/').replace(/\/$/, '')
}

function basename(p) { return p.split('/').pop() }
function dirname(p)  { return p.split('/').slice(0, -1).join('/') || '.' }
function extname(p)  { const b = basename(p); const i = b.lastIndexOf('.'); return i < 1 ? '' : b.slice(i) }

function mkdirp(p) {
  const parts = p.split('/').filter(Boolean)
  let cur = p.startsWith('/') ? '' : '.'
  for (const part of parts) {
    cur = cur ? cur + '/' + part : '/' + part
    const [, err] = os.stat(cur)
    if (err !== 0) os.mkdir(cur, 0o755)
  }
}

function readdir(p) {
  const [entries, err] = os.readdir(p)
  if (err !== 0) return []
  return entries.filter(e => e !== '.' && e !== '..')
}

function isDir(p) {
  const [st, err] = os.stat(p)
  return err === 0 && (st.mode & 0o170000) === 0o040000
}

function writeFile(p, content) {
  mkdirp(dirname(p))
  const f = std.open(p, 'w')
  f.puts(content)
  f.close()
}

function copyFile(src, dst) {
  writeFile(dst, std.loadFile(src))
}

// ── frontmatter ───────────────────────────────────────────────────────────────

function parseFrontmatter(text) {
  const m = text.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/)
  if (!m) return { meta: {}, body: text }
  const meta = {}
  for (const line of m[1].split('\n')) {
    const kv = line.match(/^([^:]+?)\s*:\s*(.*)$/)
    if (!kv) continue
    meta[kv[1].trim()] = kv[2].trim().replace(/^["']|["']$/g, '')
  }
  return { meta, body: m[2] }
}

// ── markdown (minimal) ────────────────────────────────────────────────────────

function inline(s) {
  return s
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/\*([^*\n]+)\*/g, '<em>$1</em>')
    .replace(/_([^_\n]+)_/g, '<em>$1</em>')
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>')
}

function mdToHtml(src) {
  const lines = src.split('\n')
  let out = '', i = 0
  while (i < lines.length) {
    const l = lines[i]
    if (l.match(/^```/)) {
      out += '<pre><code>'; i++
      while (i < lines.length && !lines[i].match(/^```/))
        out += lines[i++].replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;') + '\n'
      out += '</code></pre>\n'; i++; continue
    }
    const hm = l.match(/^(#{1,6})\s+(.+)$/)
    if (hm) { out += `<h${hm[1].length}>${inline(hm[2])}</h${hm[1].length}>\n`; i++; continue }
    if (l.match(/^---+$/)) { out += '<hr>\n'; i++; continue }
    if (l.startsWith('> ')) { out += `<blockquote><p>${inline(l.slice(2))}</p></blockquote>\n`; i++; continue }
    if (l.match(/^[*\-] /)) {
      out += '<ul>\n'
      while (i < lines.length && lines[i].match(/^[*\-] /))
        out += `  <li>${inline(lines[i++].replace(/^[*\-] /,''))}</li>\n`
      out += '</ul>\n'; continue
    }
    if (!l.trim()) { i++; continue }
    let p = ''
    while (i < lines.length && lines[i].trim() && !lines[i].match(/^[#`>]|^[*\-] /))
      p += lines[i++] + ' '
    if (p.trim()) out += `<p>${inline(p.trim())}</p>\n`
    else i++
  }
  return out
}

// ── shell ─────────────────────────────────────────────────────────────────────

function shell({ title, content, sidebar }) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${title} | clownbot</title>
  <style>
    html {
      --heading: 'Avenir', 'Avenir Next', 'Helvetica Neue', 'Segoe UI', 'Verdana', sans-serif;
      --monospace: 'Consolas', 'Monaco', 'Courier New', monospace;
      --font-size: 1.6rem;
      --font-size--small: 1.2rem;
      --line-height: 2.4rem;
      --gutter-width: 2.4rem;
      --border-radius: 1.2rem;
      --primary: #216a9e;
      --primary-dark: #184f76;
      --link: #4076D4;
      --link--visited: #9140D4;
      --link--hover: var(--link);
      --link--active: #D44076;
      --gray1: #3c3c3d;
      --gray2: #5a5a5b;
      --gray3: #7d7d7e;
      --gray4: #cdcdce;
      --gray5: #dededf;
      --gray6: #efeff0;
      --white: #ffffff;
      --green: #2ea44f;
      box-sizing: border-box;
      font-size: 62.5%;
      height: 100%;
    }
    body {
      background-color: var(--white);
      box-sizing: border-box;
      color: var(--gray1);
      font-family: var(--heading);
      font-size: var(--font-size);
      line-height: var(--line-height);
      min-height: 100%;
    }
    header { text-align: center; margin: 1.2rem 1.2rem 2.4rem; }
    main   { margin: 0 1.2rem; }
    footer { padding: 2.4rem 1.2rem; }
    .site-nav { border-top: 1px solid var(--gray5); border-bottom: 1px solid var(--gray5); display: inline-block; }
    .nav-item-wrapper { display: inline-block; }
    .nav-item { display: inline-block; padding: 1.2rem 2.4rem; }
  </style>
  <link rel="stylesheet" href="/css/base.css">
  <link rel="stylesheet" href="/css/main.css">
</head>
<body>

<header class="site-header">
  <h1><a class="site-title" href="/">clownbot</a></h1>
  <nav class="site-nav">
    <div class="nav-item-wrapper"><a class="nav-item" href="/">Home</a></div>
    <div class="nav-item-wrapper"><a class="nav-item" href="/blog/">Blog</a></div>
  </nav>
</header>

<main class="page-content">
  <div class="layout-two-column">
    <div class="area-main">
      ${content}
    </div>
    <div class="area-sidebar sidebar">
      ${sidebar}
    </div>
  </div>
</main>

<footer>
  <div>
    <p>built by <a href="/">clownbot</a></p>
  </div>
  <div class="ta-right">
    <p class="copyright">plan1</p>
  </div>
</footer>

</body>
</html>`
}

// ── collect posts ─────────────────────────────────────────────────────────────

const [CWD] = os.getcwd()
const BLOG = join(CWD, 'blog')
const OUT  = join(CWD, 'client/public/blog')

function collectPosts() {
  return readdir(BLOG)
    .filter(f => extname(f) === '.md')
    .map(f => {
      const { meta, body } = parseFrontmatter(std.loadFile(join(BLOG, f)))
      const slug = f.replace(/\.md$/, '').replace(/^\d{4}-\d{2}-\d{2}-/, '')
      const dateStr = f.slice(0, 10)
      const title = meta.title || slug.replace(/-/g, ' ')
      const [st] = os.stat(join(BLOG, f))
      const mtime = st ? st.mtime : 0
      return { slug, date: new Date(dateStr + 'T12:00:00Z'), mtime, title, body, meta }
    })
    .sort((a, b) => (b.date - a.date) || (b.mtime - a.mtime))
}

// ── build ─────────────────────────────────────────────────────────────────────

// copy bytesize CSS
const CSS_SRC = join(CWD, '../bytesize/css')
const CSS_DST = join(CWD, 'client/public/css')
for (const f of ['base.css', 'main.css']) {
  const src = join(CSS_SRC, f)
  const [, err] = os.stat(src)
  if (err === 0) { copyFile(src, join(CSS_DST, f)); print('copy: css/' + f) }
}

const posts = collectPosts()

function buildSidebar() {
  const items = posts.slice(0, 10)
    .map(p => `<li><a href="/blog/${p.slug}/">${p.title}</a></li>`)
    .join('\n    ')
  return `<h4>Latest</h4><ul>\n    ${items}\n  </ul>`
}

function fmtDate(d) {
  const months = ['January','February','March','April','May','June','July','August','September','October','November','December']
  return `${months[d.getUTCMonth()]} ${d.getUTCDate()}, ${d.getUTCFullYear()}`
}

// post pages
for (const post of posts) {
  const outPath = join(OUT, post.slug, 'index.html')
  writeFile(outPath, shell({
    title: post.title,
    content: `<article class="page">
<p class="page-meta">${fmtDate(post.date)}</p>
${mdToHtml(post.body)}
</article>`,
    sidebar: buildSidebar(),
  }))
  print('write: blog/' + post.slug + '/')
}

// blog roll
const roll = posts.map(p => {
  const preview = p.body.split('\n').find(l => l.trim()) || ''
  return `<div class="snippet">
  <h2><a class="post-link" href="/blog/${p.slug}/">${p.title}</a></h2>
  <p class="page-meta">${fmtDate(p.date)}</p>
  <p>${inline(preview.slice(0, 200))}${preview.length > 200 ? '…' : ''}</p>
  <p><a href="/blog/${p.slug}/">Read more</a></p>
</div>`
}).join('\n')

writeFile(join(OUT, 'index.html'), shell({
  title: 'Blog',
  content: `<section class="wrapper"><div class="post-list">${roll}</div></section>`,
  sidebar: buildSidebar(),
}))
print('write: blog/')

// ── search manifest ───────────────────────────────────────────────────────────

const PUB = join(CWD, 'client/public')
const SKIP_DIRS = ['vendor', 'css', 'fonts', 'blog']
const MEDIA_EXT = ['.mp3', '.mp4', '.m3u8', '.wav', '.ogg', '.webm', '.m4a', '.png', '.jpg', '.jpeg', '.gif', '.svg', '.webp']

function walkForIndex(dir, urlBase, docs) {
  for (const f of readdir(dir)) {
    const full = join(dir, f)
    if (SKIP_DIRS.includes(f)) continue
    if (isDir(full)) { walkForIndex(full, urlBase + '/' + f, docs); continue }
    const ext = extname(f)
    const name = f.replace(/\.[^.]+$/, '')
    const url = urlBase + '/' + f

    let type = 'file'
    if (ext === '.saga') type = 'saga'
    else if (MEDIA_EXT.includes(ext)) type = 'media'
    else if (ext === '.js' && dir.endsWith('/elves')) type = 'app'
    else if (ext === '.js') type = 'js'
    else if (ext === '.html') type = 'html'

    const appUrl = type === 'app' ? '/app/' + name : url
    docs.push({ ref: appUrl, name, type, path: url, keywords: name.replace(/[-_]/g, ' ') })
  }
}

const docs = []

// apps first (elves)
walkForIndex(join(PUB, 'elves'), '/elves', docs)

// sagas + cdn (media and sagas mixed)
walkForIndex(join(PUB, 'cdn'), '/cdn', docs)
walkForIndex(join(PUB, 'sagas'), '/sagas', docs)

// blog html pages
for (const post of posts) {
  docs.push({ ref: '/blog/' + post.slug + '/', name: post.title, type: 'html', path: '/blog/' + post.slug + '/', keywords: post.title.replace(/-/g, ' ') })
}

// root js
for (const f of readdir(PUB)) {
  if (extname(f) === '.js' && !isDir(join(PUB, f))) {
    const name = f.replace(/\.js$/, '')
    docs.push({ ref: '/' + f, name, type: 'js', path: '/' + f, keywords: name.replace(/[-_]/g, ' ') })
  }
}

writeFile(join(PUB, 'search-manifest.json'), JSON.stringify(docs))
print('write: search-manifest.json (' + docs.length + ' docs)')
print('done')
