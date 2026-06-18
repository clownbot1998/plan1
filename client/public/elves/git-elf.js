import { Self } from '@plan98/types'
import git from 'isomorphic-git'
import FS from '@isomorphic-git/lightning-fs'

const tag = 'git-elf'
const $ = Self(tag, { lines: [], ready: false })

const REMOTE = 'https://tangled.org/clowncode.bsky.social/plan1'
const DIR = '/plan1'

let fs, pfs

function initFS() {
  if (fs) return
  fs = new FS('git-elf')
  pfs = fs.promises
}

const http = {
  async request({ url, method, headers, body }) {
    let reqBody
    if (body) {
      const chunks = []
      for await (const chunk of body) chunks.push(chunk)
      const len = chunks.reduce((n, c) => n + c.length, 0)
      const buf = new Uint8Array(len)
      let off = 0
      for (const c of chunks) { buf.set(c, off); off += c.length }
      reqBody = buf
    }
    const resp = await fetch(`/api/git-proxy?url=${encodeURIComponent(url)}`, {
      method, headers, body: reqBody,
    })
    return {
      url: resp.url, method,
      headers: Object.fromEntries(resp.headers),
      body: [new Uint8Array(await resp.arrayBuffer())],
      statusCode: resp.status,
      statusMessage: resp.statusText,
    }
  }
}

function print(line) {
  $.teach({ lines: [String(line)] }, (s, p) => ({ ...s, lines: [...s.lines, ...p.lines] }))
}

async function runCmd(cmdStr) {
  initFS()
  const parts = cmdStr.trim().split(/\s+/)
  const [cmd, ...args] = parts

  if (cmd === 'clone') {
    print(`cloning ${REMOTE} → ${DIR}`)
    await git.clone({
      fs, http, dir: DIR, url: REMOTE,
      depth: 1, singleBranch: true,
      onProgress: e => print(`  ${e.phase}${e.total ? ` ${e.loaded}/${e.total}` : ''}`),
    })
    print('done')

  } else if (cmd === 'pull') {
    print('pulling...')
    await git.pull({ fs, http, dir: DIR, author: { name: 'git-elf', email: 'elf@plan98' } })
    print('done')

  } else if (cmd === 'fetch') {
    print('fetching...')
    await git.fetch({ fs, http, dir: DIR, depth: 1 })
    print('done')

  } else if (cmd === 'log') {
    const n = parseInt((args.find(a => a.startsWith('-n')) || '-n20').slice(2)) || 20
    const oneline = args.includes('--oneline')
    const commits = await git.log({ fs, dir: DIR, depth: n })
    for (const { oid, commit } of commits) {
      if (oneline) {
        print(`${oid.slice(0, 7)} ${commit.message.split('\n')[0]}`)
      } else {
        print(`commit ${oid}`)
        print(`Author: ${commit.author.name} <${commit.author.email}>`)
        print(`Date:   ${new Date(commit.author.timestamp * 1000).toISOString()}`)
        print('')
        print(`    ${commit.message.split('\n')[0]}`)
        print('')
      }
    }

  } else if (cmd === 'ls-files') {
    const files = await git.listFiles({ fs, dir: DIR })
    print(files.join('\n'))

  } else if (cmd === 'ls') {
    const p = args[0] ? `${DIR}/${args[0]}` : DIR
    const entries = await pfs.readdir(p)
    print(entries.join('  '))

  } else if (cmd === 'cat') {
    const filepath = args[0]
    if (!filepath) { print('usage: cat <path>'); return }
    const content = await pfs.readFile(`${DIR}/${filepath}`, 'utf8')
    print(content)

  } else if (cmd === 'grep') {
    const [pattern, ...gargs] = args
    if (!pattern) { print('usage: grep <pattern> [path-glob]'); return }
    const re = new RegExp(pattern, 'i')
    const files = await git.listFiles({ fs, dir: DIR })
    for (const f of files) {
      try {
        const txt = await pfs.readFile(`${DIR}/${f}`, 'utf8')
        txt.split('\n').forEach((line, i) => {
          if (re.test(line)) print(`${f}:${i + 1}: ${line}`)
        })
      } catch { /* binary or missing */ }
    }

  } else if (cmd === 'show') {
    const ref = args[0]
    if (!ref) { print('usage: show <ref>:<path> or show <oid>'); return }
    if (ref.includes(':')) {
      const colon = ref.indexOf(':')
      const refName = ref.slice(0, colon) || 'HEAD'
      const filepath = ref.slice(colon + 1)
      const oid = await git.resolveRef({ fs, dir: DIR, ref: refName })
      const { blob } = await git.readBlob({ fs, dir: DIR, oid, filepath })
      print(new TextDecoder().decode(blob))
    } else {
      const commit = await git.readCommit({ fs, dir: DIR, oid: ref })
      print(JSON.stringify(commit, null, 2))
    }

  } else if (cmd === 'status') {
    const matrix = await git.statusMatrix({ fs, dir: DIR })
    let clean = true
    for (const [filepath, head, workdir, stage] of matrix) {
      if (head !== 1 || workdir !== 1 || stage !== 1) {
        print(`${filepath}  ${head}${workdir}${stage}`)
        clean = false
      }
    }
    if (clean) print('nothing to commit, working tree clean')

  } else if (cmd === 'help' || cmd === '?') {
    print('commands:')
    print('  clone              clone plan1 from tangled remote')
    print('  pull / fetch       update local clone')
    print('  log [--oneline] [-nN]')
    print('  ls [path]          list directory')
    print('  ls-files           list all tracked files')
    print('  cat <path>         read a file')
    print('  show <ref>:<path>  show file at ref (e.g. HEAD:blog/foo.md)')
    print('  grep <pattern>     search all files')
    print('  status             working tree status')

  } else {
    print(`unknown: ${cmd} — type "help"`)
  }
}

$.draw(target => {
  const { lines } = $.learn()
  const escaped = lines.map(l =>
    l.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  ).join('\n')
  return `
    <div class="ge-shell">
      <div class="ge-header">git-elf — tangled:clowncode.bsky.social/plan1</div>
      <pre class="ge-output">${escaped}</pre>
      <div class="ge-prompt">
        <span class="ge-sigil">$ </span>
        <input class="ge-input" type="text" autocomplete="off" spellcheck="false" placeholder="help" />
      </div>
    </div>
  `
})

$.when('draw', tag, target => {
  const out = target.querySelector('.ge-output')
  if (out) out.scrollTop = out.scrollHeight
  const input = target.querySelector('.ge-input')
  if (input && document.activeElement !== input) input.focus()
})

$.when('keydown', `${tag} .ge-input`, async e => {
  if (e.key !== 'Enter') return
  const input = e.target
  const cmd = input.value.trim()
  input.value = ''
  if (!cmd) return
  print(`$ ${cmd}`)
  try {
    await runCmd(cmd)
  } catch (err) {
    print(`error: ${err.message || err}`)
  }
})

$.style(`
  ${tag} {
    display: block;
    height: 100%;
    overflow: hidden;
    font-family: 'Recursive', monospace;
    background: #1a1a1a;
    color: #d4d4d4;
  }
  ${tag} .ge-shell {
    display: flex;
    flex-direction: column;
    height: 100%;
  }
  ${tag} .ge-header {
    padding: 4px 8px;
    background: #2a2a2a;
    color: #888;
    font-size: 0.75rem;
    border-bottom: 1px solid #333;
    flex-shrink: 0;
  }
  ${tag} .ge-output {
    flex: 1;
    overflow-y: auto;
    margin: 0;
    padding: 8px;
    font-size: 0.8rem;
    line-height: 1.5;
    white-space: pre-wrap;
    word-break: break-all;
  }
  ${tag} .ge-prompt {
    display: flex;
    align-items: center;
    padding: 4px 8px;
    border-top: 1px solid #333;
    flex-shrink: 0;
  }
  ${tag} .ge-sigil {
    color: #7ec8e3;
    margin-right: 4px;
    flex-shrink: 0;
  }
  ${tag} .ge-input {
    flex: 1;
    background: transparent;
    border: none;
    outline: none;
    color: #d4d4d4;
    font-family: inherit;
    font-size: 0.8rem;
  }
`)
