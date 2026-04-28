import module from '@silly/tag'
import { toast } from './plan98-toast.js'
import { vim, Vim } from "@replit/codemirror-vim"
import { javascript } from "@codemirror/lang-javascript";
import { html } from "@codemirror/lang-html";
import { css } from "@codemirror/lang-css";
import { gruvboxDark } from '@uiw/codemirror-theme-gruvbox-dark';
import { EditorView } from '@codemirror/view'
import { EditorState } from '@codemirror/state'
import { consoleShow } from './plan98-console.js'
import { basicSetup } from "codemirror"
import * as braid from 'braid-http'
import { simpleton_client } from '/cdn/braid.org/simpleton-client.js'
import { diff_main } from '/cdn/braid.org/myers-diff1.js'

self.braid_fetch = braid.fetch

const $ = module('squad-code')

function getSrc(target) {
  return target.closest('[src]')?.getAttribute('src') || '/public' + window.location.pathname
}

function braidUrl(src) {
  return '/braid' + src
}

async function persistSave(src) {
  const { file } = $.learn()[src] || {}
  if (file === undefined) return
  const res = await fetch('/save' + src, {
    method: 'PUT',
    headers: { 'content-type': 'text/plain' },
    body: file,
  })
  if (!res.ok) toast('Save failed: ' + res.status, { type: 'error' })
}

function mount(target) {
  if (target.initialized) return
  target.initialized = true

  const src = getSrc(target)

  fetch(src).then(r => r.text()).then(file => {
    $.teach({ src, [src]: { file, src } })
    connectSimpleton(target, src, file)
  }).catch(() => {
    $.teach({ src, [src]: { file: '', src } })
    connectSimpleton(target, src, '')
  })
}

function connectSimpleton(target, src, initialText) {
  if (target.simpleton) target.simpleton.stop?.()

  // `acked` = what the server has confirmed. Only updated in apply_remote_update.
  // generate_local_diff_update diffs `acked` (prev) against the live editor — never
  // mutates `acked` itself, so the server echo re-applies to the pre-edit baseline.
  let acked = initialText ?? ''

  console.log(`[squad-code] subscribing to ${braidUrl(src)}`)

  target.simpleton = simpleton_client(braidUrl(src), {
    apply_remote_update({ state, patches }) {
      if (state !== undefined) {
        console.log(`[squad-code] apply full state len=${state.length}`)
        acked = state
        target._remote_changes = null
      } else {
        console.log(`[squad-code] apply ${patches?.length} patch(es)`, patches?.map(p => String(p.range)))
        const changes = []
        for (const p of patches ?? []) {
          const nums = String(p.range).match(/\d+/g)
          if (nums?.length >= 2) {
            const s = +nums[0], e = +nums[1]
            acked = acked.slice(0, s) + (p.content_text ?? '') + acked.slice(e)
            changes.push({ from: s, to: e, insert: p.content_text ?? '' })
          }
        }
        target._remote_changes = changes.length ? changes : null
      }
      const editorText = target.view?.state.doc.toString()
      target._remote_state = acked
      // only teach (trigger re-render) when content differs from what editor has
      if (acked !== editorText) $.teach({ [src]: { file: acked, src } })
      return acked
    },
    generate_local_diff_update(prev) {
      // prev === acked at call time; diff against live editor content
      const editorText = target.view?.state.doc.toString() ?? ''
      const patches = diff(prev, editorText)
      if (!patches.length) return null
      return { patches, new_state: editorText }
    },
  })
}

function diff(before, after) {
  const d = diff_main(before, after, null)
  const patches = []
  let offset = 0
  for (const [op, text] of d) {
    if (op === 1) {
      patches.push({ unit: 'text', range: [offset, offset], content: text })
    } else if (op === -1) {
      patches.push({ unit: 'text', range: [offset, offset + text.length], content: '' })
      offset += text.length
    } else {
      offset += text.length
    }
  }
  return patches
}

$.when('click', '.preview', (event) => {
  const src = getSrc(event.target.closest($.link))
  self.open(src, '_blank')
})

$.when('click', '.launch', (event) => {
  self.top.location.href = event.target.dataset.src
})

$.when('click', '.debug', () => {
  let console = document.body.querySelector('plan98-console')
  if (!console) {
    document.body.insertAdjacentHTML('beforeend', '<plan98-console></plan98-console>')
    console = document.body.querySelector('plan98-console')
  } else {
    console.classList.toggle('hidden')
  }
  consoleShow()
})

Vim.defineEx('write', 'w', () => {
  const root = document.querySelector($.link)
  const src = getSrc(root)
  persistSave(src).then(() => toast('Saved!', { type: 'success' }))
})

Vim.defineEx('quit', 'q', () => { window.location.href = '/app/tiniest-violin' })

$.when('click', '.publish', (event) => {
  const root = event.target.closest($.link)
  const src = getSrc(root)
  persistSave(src).then(() => toast('Saved!', { type: 'success' }))
})

$.draw(target => {
  mount(target)
  const { activeMenu } = $.learn()
  const src = getSrc(target)
  const { file } = $.learn()[src] || {}

  if (!target.innerHTML) {
    const amp = `
      <div class="menu-item">
        <button data-menu-target="file" class="${activeMenu === 'file' ? 'active' : ''}">File</button>
        <div class="menu-actions" data-menu="file">
          <button class="publish">Sync</button>
        </div>
      </div>
      <div class="menu-item">
        <button data-menu-target="view" class="${activeMenu === 'view' ? 'active' : ''}">View</button>
        <div class="menu-actions" data-menu="view">
          <button class="preview" data-src="${src}">Source</button>
          <button class="debug" data-src="${src}">Debugger</button>
        </div>
      </div>
      <div class="menu-item">
        <button data-menu-target="launch" class="${activeMenu === 'launch' ? 'active' : ''}">Launch</button>
        <div class="menu-actions" data-menu="launch">
          <button class="launch" data-src="/app/ur-shell">Shell</button>
          <button class="launch" data-src="/app/plan98-wallet">Wallet</button>
          <button class="launch" data-src="/app/multi-task">Desktop</button>
        </div>
      </div>
    `

    target.innerHTML = `
      <div class="actions">${amp}</div>
      <div class="editor"></div>
    `
  }

  if (file !== undefined && !target.view) {
    const vimKeymap = vim({ status: true })

    const preventKeyPropagation = EditorView.domEventHandlers({
      keydown: (event) => { event.stopPropagation(); return false }
    })

    const recursiveTheme = EditorView.theme({
      '.cm-scroller': {
        fontFamily: '"Recursive", monospace',
        fontVariationSettings: '"MONO" 1, "CASL" 1, "wght" 400, "slnt" -15, "CRSV" 1',
      }
    })

    target.editorState = EditorState.create({
      doc: file,
      extensions: [
        basicSetup,
        EditorView.lineWrapping,
        gruvboxDark,
        recursiveTheme,
        javascript(),
        html(),
        css(),
        vimKeymap,
        EditorView.updateListener.of(update => {
          if (!update.docChanged || target._applyingRemote) return
          const src = getSrc(target)
          const file = update.view.state.doc.toString()
          $.teach({ [src]: { file, src } })
          target.simpleton?.changed()
        }),
        preventKeyPropagation,
      ]
    })

    target.view = new EditorView({
      parent: target.querySelector('.editor'),
      state: target.editorState
    })
  }
}, {
  afterUpdate(target) {
    if (target.view && target._remote_state !== undefined && target._remote_state !== target._last_applied) {
      target._last_applied = target._remote_state
      // skip dispatch if editor already has this content (e.g. own echo from server)
      if (target._remote_state === target.view.state.doc.toString()) return
      target._applyingRemote = true
      if (target._remote_changes) {
        // apply precise patch positions — CodeMirror maps selection through the change
        target.view.dispatch({ changes: target._remote_changes })
      } else {
        // full state replace (initial load or reconnect)
        target.view.dispatch({
          changes: { from: 0, to: target.view.state.doc.length, insert: target._remote_state }
        })
      }
      target._applyingRemote = false
    }
  }
})

$.style(`
  & {
    display: block;
    overflow: hidden;
    height: 100%;
    max-height: 100%;
    position: relative;
    padding-top: 2rem;
    max-width: 100%;
    width: 100%;
  }

  & .editor {
    height: 100%;
    overflow: auto;
    font-size: 1rem;
  }

  & .cm-editor {
    height: 100%;
    overflow: auto;
  }

  & .actions {
    z-index: 10;
    background: #1d2021;
    border-bottom: 1px solid #504945;
    position: absolute;
    top: 0;
    left: 0;
    right: 0;
    display: flex;
    padding-right: 2rem;
  }

  & .actions button {
    background: #1d2021;
    color: #83a598;
    border: none;
    height: 2rem;
    font-size: 1rem;
    font-family: "Recursive";
    font-variation-settings: "MONO" 1, "CASL" 0, "wght" 400, "slnt" 0, "CRSV" 0;
    transition: background 200ms;
  }

  & .actions button:hover,
  & .actions button:focus {
    background: #504945;
    color: #ebdbb2;
  }

  & .menu-item {
    position: relative;
  }

  & .menu-actions {
    display: none;
    position: absolute;
    left: 0;
    bottom: 0;
    transform: translateY(100%);
    z-index: 20;
  }

  & [data-menu-target].active + .menu-actions {
    display: block;
  }

  & .menu-actions button {
    width: 100%;
    text-align: left;
  }

  .cm-vim-panel input {
    color: white;
  }
`)

$.when('click', '[data-menu-target]', (event) => {
  const active = event.target.closest($.link).querySelector('[data-menu-target].active')
  if (active) active.classList.remove('active')
  event.target.classList.add('active')
  event.stopImmediatePropagation()
})

$.when('click', '*', (event) => {
  $.teach({ activeMenu: null })
  const active = event.target.closest($.link)?.querySelector('[data-menu-target].active')
  if (active) active.classList.remove('active')
})
