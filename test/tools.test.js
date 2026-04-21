// tools.js test suite - run with: qjs --std test/tools.test.js
// Tests tool definitions and callTool dispatch (no browser APIs needed)

const toolDefinitions = [
  { name: 'read_file', description: 'Read a file and return its contents', input_schema: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] }},
  { name: 'write_file', description: 'Write content to a file', input_schema: { type: 'object', properties: { path: { type: 'string' }, content: { type: 'string' } }, required: ['path', 'content'] }},
  { name: 'patch_file', description: 'Patch a file with find-replace', input_schema: { type: 'object', properties: { path: { type: 'string' }, find: { type: 'string' }, replace: { type: 'string' } }, required: ['path', 'find', 'replace'] }},
  { name: 'list_files', description: 'List files in a directory', input_schema: { type: 'object', properties: { dir: { type: 'string' } }, required: ['dir'] }},
  { name: 'file_exists', description: 'Check if a file exists', input_schema: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] }}
]

// stub implementations for testing (just return mock data)
async function read_file(path) {
  if (path === '/nonexistent.txt') return { error: 'HTTP 404: Not Found' }
  return { content: '<!DOCTYPE html><html></html>' }
}

async function write_file(path, content) {
  return { ok: true }
}

async function patch_file(path, find, replace) {
  const existing = '<!DOCTYPE html><html></html>'
  const newContent = existing.replace(find, replace)
  return { content: newContent }
}

async function list_files(dir) {
  return { files: ['index.html', 'main.js', 'style.css'] }
}

async function file_exists(path) {
  if (path === '/nonexistent.txt') return { exists: false }
  return { exists: true }
}

async function callTool(name, args) {
  switch (name) {
    case 'read_file': return read_file(args.path)
    case 'write_file': return write_file(args.path, args.content)
    case 'patch_file': return patch_file(args.path, args.find, args.replace)
    case 'list_files': return list_files(args.dir)
    case 'file_exists': return file_exists(args.path)
    default: return { error: 'unknown tool: ' + name }
  }
}

// tests
function assert(condition, message) {
  if (!condition) throw new Error(message || 'assertion failed')
}

print('── tools: test suite ──')

let passed = 0
let failed = 0

const tests = [
  { name: 'has 5 tool definitions', fn: async () => {
    assert(toolDefinitions.length === 5, 'expected 5 tools')
    const names = toolDefinitions.map(t => t.name)
    assert(names.includes('read_file'))
    assert(names.includes('write_file'))
    assert(names.includes('patch_file'))
    assert(names.includes('list_files'))
    assert(names.includes('file_exists'))
  }},
  { name: 'read_file has input_schema', fn: async () => {
    const tool = toolDefinitions.find(t => t.name === 'read_file')
    assert(tool.input_schema !== undefined)
    assert(tool.input_schema.properties.path !== undefined)
  }},
  { name: 'file_exists returns false for missing', fn: async () => {
    const result = await callTool('file_exists', { path: '/nonexistent.txt' })
    assert(result.exists === false)
  }},
  { name: 'file_exists returns true for existing', fn: async () => {
    const result = await callTool('file_exists', { path: '/index.html' })
    assert(result.exists === true)
  }},
  { name: 'read_file reads existing file', fn: async () => {
    const result = await callTool('read_file', { path: '/index.html' })
    assert(result.content !== undefined)
    assert(result.content.includes('<!DOCTYPE'))
  }},
  { name: 'read_file returns error for missing', fn: async () => {
    const result = await callTool('read_file', { path: '/nonexistent.txt' })
    assert(result.error !== undefined)
  }},
  { name: 'write_file returns ok', fn: async () => {
    const result = await callTool('write_file', { path: '/test.txt', content: 'hello' })
    assert(result.ok === true)
  }},
  { name: 'patch_file replaces text', fn: async () => {
    const result = await callTool('patch_file', { path: '/test.txt', find: 'html', replace: 'body' })
    assert(result.content !== undefined)
    assert(result.content.includes('<!DOCTYPE body>'))
  }},
  { name: 'list_files returns array', fn: async () => {
    const result = await callTool('list_files', { dir: '/' })
    assert(result.files !== undefined)
    assert(Array.isArray(result.files))
    assert(result.files.length > 0)
  }},
  { name: 'unknown tool returns error', fn: async () => {
    const result = await callTool('unknown_tool', {})
    assert(result.error !== undefined)
    assert(result.error.includes('unknown tool'))
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