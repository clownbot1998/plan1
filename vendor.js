// run with: qjs --std vendor.js
'use strict'

const SRC       = 'client/public'
const DIST      = 'dist'
const DEPS_LOC  = '/vendor/deps'           // URL path
const DEPS_DISK = DIST + DEPS_LOC          // disk path

// ── fs helpers (same as build.js) ────────────────────────────────────────────

function join(...parts) {
  return parts.join('/').replace(/\/+/g, '/').replace(/\/$/, '')
}

function dirname(p) { return p.split('/').slice(0, -1).join('/') || '.' }

function mkdirp(p) {
  const parts = p.split('/').filter(Boolean)
  let cur = p.startsWith('/') ? '' : '.'
  for (const part of parts) {
    cur = cur ? cur + '/' + part : '/' + part
    const [, err] = os.stat(cur)
    if (err !== 0) os.mkdir(cur, 0o755)
  }
}

function readFile(p) { return std.loadFile(p) || '' }

function writeFile(p, content) {
  mkdirp(dirname(p))
  const f = std.open(p, 'w')
  f.puts(content)
  f.close()
}

function exists(p) { return os.stat(p)[1] === 0 }

function readdir(p) {
  const [entries, err] = os.readdir(p)
  if (err !== 0) return []
  return entries.filter(e => e !== '.' && e !== '..')
}

function isDir(p) {
  const [st, err] = os.stat(p)
  return err === 0 && (st.mode & 0o170000) === 0o040000
}

function shell(cmd) {
  const f = std.popen(cmd, 'r')
  f.close()
}

function fetch(url, outPath) {
  mkdirp(dirname(outPath))
  const f = std.popen(`curl -sL --fail "${url}" -o "${outPath}" 2>/dev/null && echo ok`, 'r')
  const out = f.getline()
  f.close()
  return out === 'ok'
}

// ── copy src → dist ───────────────────────────────────────────────────────────

function copyDir(src, dst) {
  mkdirp(dst)
  for (const entry of readdir(src)) {
    const s = join(src, entry)
    const d = join(dst, entry)
    if (isDir(s)) copyDir(s, d)
    else writeFile(d, readFile(s))
  }
}

// ── importmap rewriting ───────────────────────────────────────────────────────

function safeName(url) {
  const withoutProto = url.replace(/^https?:\/\//, '')
  const [hostPath, query] = withoutProto.split('?')
  let p = hostPath.replace(/\/$/, '')
  if (query) {
    let h = 0
    for (let i = 0; i < query.length; i++) h = ((h << 5) - h + query.charCodeAt(i)) | 0
    p += '_q' + Math.abs(h).toString(36)
  }
  if (!/\.(m?js|css|wasm)$/.test(p)) p += '.js'
  return p
}

const fetched = {}

function vendorUrl(url) {
  if (fetched[url]) return fetched[url]

  const name     = safeName(url)
  const localUrl = DEPS_LOC + '/' + name
  const diskPath = DEPS_DISK + '/' + name
  fetched[url]   = localUrl

  if (exists(diskPath)) {
    print('  [cached]', url.replace('https://esm.sh/', ''))
  } else {
    print('  [fetch] ', url.replace('https://esm.sh/', ''))
    if (!fetch(url, diskPath)) {
      print('  [error] ', url)
      return localUrl
    }
  }

  // rewrite internal esm.sh imports recursively
  let code = readFile(diskPath)
  const rewrites = []

  for (const [, dep] of code.matchAll(/\bfrom\s*["'](https:\/\/esm\.sh\/[^"']+)["']/g)) rewrites.push(dep)
  for (const [, dep] of code.matchAll(/\bimport\s*\(["'](https:\/\/esm\.sh\/[^"']+)["']\)/g)) rewrites.push(dep)
  for (const [, dep] of code.matchAll(/\bfrom\s*["'](\/[a-z@][^"']+)["']/g)) rewrites.push('https://esm.sh' + dep)
  for (const [, dep] of code.matchAll(/\bimport\s*\(["'](\/[a-z@][^"']+)["']\)/g)) rewrites.push('https://esm.sh' + dep)

  let changed = false
  for (const dep of [...new Set(rewrites)]) {
    const depLocal = vendorUrl(dep)
    const raw = dep.startsWith('https://esm.sh') ? dep : dep.replace('https://esm.sh', '')
    if (code.includes(raw)) {
      code = code.split(`"${raw}"`).join(`"${depLocal}"`)
                 .split(`'${raw}'`).join(`'${depLocal}'`)
      changed = true
    }
  }

  if (changed) writeFile(diskPath, code)
  return localUrl
}

function rewriteHtml(file) {
  let html = readFile(file)
  const m = html.match(/<script type="importmap">([\s\S]*?)<\/script>/)
  if (!m) return

  let imports
  try { imports = JSON.parse(m[1]).imports } catch(e) { return }

  const updated = {}
  for (const [spec, url] of Object.entries(imports)) {
    if (url.includes('esm.sh')) {
      updated[spec] = vendorUrl(url)
    } else {
      updated[spec] = url
    }
  }

  const newMap = JSON.stringify({ imports: updated }, null, 4)
  html = html.replace(m[1], '\n  ' + newMap + '\n  ')
  writeFile(file, html)
}

// ── collect all html files with importmaps ────────────────────────────────────

function collectHtml(dir) {
  const files = []
  for (const entry of readdir(dir)) {
    const p = join(dir, entry)
    if (isDir(p)) files.push(...collectHtml(p))
    else if (entry === 'index.html') files.push(p)
  }
  return files
}

// ── main ──────────────────────────────────────────────────────────────────────

print('── vendor: sync source → dist ──')
copyDir(SRC, DIST)

print('── vendor: rewriting importmaps ──')
const htmlFiles = collectHtml(DIST)
for (const f of htmlFiles) rewriteHtml(f)

print('── vendor: done ──')
