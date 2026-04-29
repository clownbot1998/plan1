// elf-tools: file I/O via the plan1 server (dist/ filesystem + braid layer)
// reads: plain fetch → dist/; writes: PUT /save/<path> → disk + braid broadcast

async function read_file(path) {
  try {
    const res = await fetch(path)
    if (res.status === 404) return { error: 'not found' }
    if (!res.ok) return { error: `fetch failed: ${res.status}` }
    return { content: await res.text() }
  } catch (e) {
    return { error: e.message }
  }
}

async function write_file(path, content) {
  try {
    const res = await fetch('/save' + path, {
      method: 'PUT',
      headers: { 'content-type': 'text/plain' },
      body: content,
    })
    if (!res.ok) return { error: `save failed: ${res.status}` }
    return { ok: true }
  } catch (e) {
    return { error: e.message }
  }
}

async function patch_file(path, find, replace) {
  try {
    const res = await fetch(path)
    if (!res.ok) return { error: 'file not found' }
    const original = await res.text()
    if (!original.includes(find)) return { error: 'find string not found in file' }
    const patched = original.replace(find, replace)
    const saveRes = await fetch('/save' + path, {
      method: 'PUT',
      headers: { 'content-type': 'text/plain' },
      body: patched,
    })
    if (!saveRes.ok) return { error: `save failed: ${saveRes.status}` }
    return { ok: true }
  } catch (e) {
    return { error: e.message }
  }
}

async function list_files(dir) {
  try {
    const res = await fetch('/file-manifest.json')
    if (!res.ok) return { error: 'could not load file-manifest.json' }
    const manifest = await res.json()
    const prefix = dir === '/' ? '' : dir.replace(/\/$/, '') + '/'
    const files = dir === '/'
      ? manifest.map(f => f.path)
      : manifest.map(f => f.path).filter(p => p.startsWith(prefix))
    return { files }
  } catch (e) {
    return { error: e.message }
  }
}

async function file_exists(path) {
  try {
    const res = await fetch(path, { method: 'HEAD' })
    return { exists: res.ok }
  } catch {
    return { exists: false }
  }
}

export const toolDefinitions = [
  {
    name: 'read_file',
    description: 'Read a file from the server and return its contents',
    input_schema: { type: 'object', properties: { path: { type: 'string', description: 'File path (e.g. /elves/my-computer.js)' } }, required: ['path'] }
  },
  {
    name: 'write_file',
    description: 'Write content to a file on the server (persists to disk)',
    input_schema: { type: 'object', properties: { path: { type: 'string', description: 'File path' }, content: { type: 'string', description: 'Full file content to write' } }, required: ['path', 'content'] }
  },
  {
    name: 'patch_file',
    description: 'Find and replace text in a file on the server (persists to disk)',
    input_schema: { type: 'object', properties: { path: { type: 'string', description: 'File path' }, find: { type: 'string', description: 'Exact text to find' }, replace: { type: 'string', description: 'Text to replace it with' } }, required: ['path', 'find', 'replace'] }
  },
  {
    name: 'list_files',
    description: 'List files in a directory using the file manifest',
    input_schema: { type: 'object', properties: { dir: { type: 'string', description: 'Directory path, use "/" for all files' } }, required: ['dir'] }
  },
  {
    name: 'file_exists',
    description: 'Check if a file exists on the server',
    input_schema: { type: 'object', properties: { path: { type: 'string', description: 'File path' } }, required: ['path'] }
  },
]

export async function callTool(name, args) {
  switch (name) {
    case 'read_file':   return read_file(args.path)
    case 'write_file':  return write_file(args.path, args.content)
    case 'patch_file':  return patch_file(args.path, args.find, args.replace)
    case 'list_files':  return list_files(args.dir)
    case 'file_exists': return file_exists(args.path)
    default:            return { error: `unknown tool: ${name}` }
  }
}
