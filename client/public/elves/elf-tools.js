import { get, put, del } from './plan98-wallet.js'

// list_files needs an index because WAS has no native directory listing
const INDEX = '/_tools_index.json'

async function readIndex() {
  try {
    const blob = await get(INDEX)
    if (!blob) return []
    return JSON.parse(await blob.text())
  } catch {
    return []
  }
}

async function writeIndex(paths) {
  await put(INDEX, JSON.stringify(paths), { type: 'application/json' })
}

async function read_file(path) {
  try {
    const blob = await get(path)
    if (!blob) return { error: 'not found' }
    return { content: await blob.text() }
  } catch (e) {
    return { error: e.message }
  }
}

async function write_file(path, content) {
  try {
    await put(path, content, { type: 'text/plain' })
    const index = await readIndex()
    if (!index.includes(path)) await writeIndex([...index, path])
    return { ok: true }
  } catch (e) {
    return { error: e.message }
  }
}

async function patch_file(path, find, replace) {
  try {
    const blob = await get(path)
    if (!blob) return { error: 'file not found' }
    const newContent = (await blob.text()).replace(find, replace)
    await put(path, newContent, { type: 'text/plain' })
    return { content: newContent }
  } catch (e) {
    return { error: e.message }
  }
}

async function list_files(dir) {
  try {
    const index = await readIndex()
    const prefix = dir === '/' ? '' : dir.replace(/\/$/, '') + '/'
    const files = dir === '/' ? index : index.filter(p => p.startsWith(prefix))
    return { files }
  } catch (e) {
    return { error: e.message }
  }
}

async function file_exists(path) {
  try {
    const blob = await get(path)
    return { exists: !!blob }
  } catch {
    return { exists: false }
  }
}

async function delete_file(path) {
  try {
    await del(path)
    const index = await readIndex()
    await writeIndex(index.filter(p => p !== path))
    return { ok: true }
  } catch (e) {
    return { error: e.message }
  }
}

export const toolDefinitions = [
  {
    name: 'read_file',
    description: 'Read a file and return its contents',
    input_schema: { type: 'object', properties: { path: { type: 'string', description: 'File path' } }, required: ['path'] }
  },
  {
    name: 'write_file',
    description: 'Write content to a file',
    input_schema: { type: 'object', properties: { path: { type: 'string', description: 'File path' }, content: { type: 'string', description: 'Content to write' } }, required: ['path', 'content'] }
  },
  {
    name: 'patch_file',
    description: 'Patch a file with find-replace',
    input_schema: { type: 'object', properties: { path: { type: 'string', description: 'File path' }, find: { type: 'string', description: 'Text to find' }, replace: { type: 'string', description: 'Text to replace with' } }, required: ['path', 'find', 'replace'] }
  },
  {
    name: 'list_files',
    description: 'List files in a directory',
    input_schema: { type: 'object', properties: { dir: { type: 'string', description: 'Directory path, use "/" for all' } }, required: ['dir'] }
  },
  {
    name: 'file_exists',
    description: 'Check if a file exists',
    input_schema: { type: 'object', properties: { path: { type: 'string', description: 'File path' } }, required: ['path'] }
  },
  {
    name: 'delete_file',
    description: 'Delete a file',
    input_schema: { type: 'object', properties: { path: { type: 'string', description: 'File path to delete' } }, required: ['path'] }
  }
]

export async function callTool(name, args) {
  switch (name) {
    case 'read_file':   return read_file(args.path)
    case 'write_file':  return write_file(args.path, args.content)
    case 'patch_file':  return patch_file(args.path, args.find, args.replace)
    case 'list_files':  return list_files(args.dir)
    case 'file_exists': return file_exists(args.path)
    case 'delete_file': return delete_file(args.path)
    default:            return { error: `unknown tool: ${name}` }
  }
}
