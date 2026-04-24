// elf-tools.js test suite - run with: qjs --std test/tools.test.js

const toolDefinitions = [
  { name: 'read_file',   input_schema: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] } },
  { name: 'write_file',  input_schema: { type: 'object', properties: { path: { type: 'string' }, content: { type: 'string' } }, required: ['path', 'content'] } },
  { name: 'patch_file',  input_schema: { type: 'object', properties: { path: { type: 'string' }, find: { type: 'string' }, replace: { type: 'string' } }, required: ['path', 'find', 'replace'] } },
  { name: 'list_files',  input_schema: { type: 'object', properties: { dir: { type: 'string' } }, required: ['dir'] } },
  { name: 'file_exists', input_schema: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] } },
  { name: 'delete_file', input_schema: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] } },
]

// in-memory store standing in for wallet storage
const _store = {}
const _index = []

async function read_file(path) {
  if (_store[path] === undefined) return { error: 'not found' }
  return { content: _store[path] }
}

async function write_file(path, content) {
  _store[path] = content
  if (!_index.includes(path)) _index.push(path)
  return { ok: true }
}

async function patch_file(path, find, replace) {
  if (_store[path] === undefined) return { error: 'file not found' }
  const newContent = _store[path].replace(find, replace)
  _store[path] = newContent
  return { content: newContent }
}

async function list_files(dir) {
  const prefix = dir === '/' ? '' : dir.replace(/\/$/, '') + '/'
  const files = dir === '/' ? [..._index] : _index.filter(p => p.startsWith(prefix))
  return { files }
}

async function file_exists(path) {
  return { exists: _store[path] !== undefined }
}

async function delete_file(path) {
  delete _store[path]
  const i = _index.indexOf(path)
  if (i !== -1) _index.splice(i, 1)
  return { ok: true }
}

async function callTool(name, args) {
  switch (name) {
    case 'read_file':   return read_file(args.path)
    case 'write_file':  return write_file(args.path, args.content)
    case 'patch_file':  return patch_file(args.path, args.find, args.replace)
    case 'list_files':  return list_files(args.dir)
    case 'file_exists': return file_exists(args.path)
    case 'delete_file': return delete_file(args.path)
    default:            return { error: 'unknown tool: ' + name }
  }
}

function assert(condition, message) {
  if (!condition) throw new Error(message || 'assertion failed')
}

print('── elf-tools: test suite ──')

let passed = 0
let failed = 0

const tests = [
  { name: 'has 6 tool definitions', fn: async () => {
    assert(toolDefinitions.length === 6, 'expected 6 tools')
    const names = toolDefinitions.map(t => t.name)
    ;['read_file', 'write_file', 'patch_file', 'list_files', 'file_exists', 'delete_file'].forEach(n => assert(names.includes(n), 'missing ' + n))
  }},
  { name: 'file_exists false for missing', fn: async () => {
    const r = await callTool('file_exists', { path: '/missing.txt' })
    assert(r.exists === false)
  }},
  { name: 'write_file returns ok', fn: async () => {
    const r = await callTool('write_file', { path: '/test.txt', content: '<!DOCTYPE html>' })
    assert(r.ok === true)
  }},
  { name: 'file_exists true after write', fn: async () => {
    const r = await callTool('file_exists', { path: '/test.txt' })
    assert(r.exists === true)
  }},
  { name: 'read_file reads written file', fn: async () => {
    const r = await callTool('read_file', { path: '/test.txt' })
    assert(r.content !== undefined)
    assert(r.content.includes('<!DOCTYPE'))
  }},
  { name: 'read_file error for missing', fn: async () => {
    const r = await callTool('read_file', { path: '/missing.txt' })
    assert(r.error !== undefined)
  }},
  { name: 'patch_file replaces text', fn: async () => {
    const r = await callTool('patch_file', { path: '/test.txt', find: 'html', replace: 'body' })
    assert(r.content !== undefined)
    assert(r.content.includes('body'))
  }},
  { name: 'list_files returns written paths', fn: async () => {
    const r = await callTool('list_files', { dir: '/' })
    assert(Array.isArray(r.files))
    assert(r.files.includes('/test.txt'))
  }},
  { name: 'delete_file removes file', fn: async () => {
    const r = await callTool('delete_file', { path: '/test.txt' })
    assert(r.ok === true)
    const e = await callTool('file_exists', { path: '/test.txt' })
    assert(e.exists === false)
  }},
  { name: 'unknown tool returns error', fn: async () => {
    const r = await callTool('unknown_tool', {})
    assert(r.error !== undefined)
    assert(r.error.includes('unknown tool'))
  }},
]

async function runTests() {
  for (const { name, fn } of tests) {
    try {
      await fn()
      print('  ✓', name)
      passed++
    } catch (e) {
      print('  ✗', name, '-', e.message)
      failed++
    }
  }
  print('── ' + passed + '/' + tests.length + ' passed ──')
  if (failed > 0) std.exit(1)
}

runTests()
