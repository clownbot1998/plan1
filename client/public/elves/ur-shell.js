import { Self } from '@plan98/types'
import { marked } from 'marked'
import { showModal, hideModal } from '@plan98/modal'
import $paperPocket, { sideEffects, systemMenu, getTheme, afterUpdateTheme } from './paper-pocket.js'

function decodeHtmlEntities(text) {
  const textarea = document.createElement("textarea");
  textarea.innerHTML = text;
  return textarea.value;
}

const renderer = new marked.Renderer();

renderer.codespan = (code) => {
  return `<code>${escapeHyperText(decodeHtmlEntities(code))}</code>`;
};

// Override code block rendering
renderer.code = (code, language) => {
  let decodedCode = decodeHtmlEntities(code); // First decode pass
  decodedCode = decodeHtmlEntities(decodedCode); // Second decode to fix double encoding

  const langClass = language ? ` class="language-${language}"` : "";
  return `<pre><code${langClass}>${escapeHyperText(decodedCode)}</code></pre>`;
};

marked.setOptions({
  renderer,
  gfm: true,        // Enable GitHub Flavored Markdown
  breaks: false,    // Keep standard line breaks
  smartypants: false, // Prevent automatic quote conversions
});


const paperPocketHelp = () => {
  const paperPocketPath = Object.keys(sideEffects)
    .filter(key => $paperPocket.learn().settings[key])
    .reduce((path, key) => {
      path[key] = sideEffects[key]
      return path
    }, {})

  return Object.keys(paperPocketPath).map(key => {
  const { label, description, options, value: _value } = $paperPocket.learn().settings[key]
  const value = $paperPocket.learn()[key]
  return `${key}

  ${label}: ${value}
  ${description}
  ${options.join(' ')}
`}).join('\n')
}

let fileSystem = null

// set theme before first paint so html:has(ur-shell) and body:has(ur-shell)
// don't flash the fallback color
;(function() {
  const t = getTheme()
  if (t) {
    document.documentElement.style.setProperty('--root-theme', t)
    document.body.style.setProperty('--root-theme', t)
  }
})()

const $ = Self('ur-shell', {
  messages: [],
  history: [],
  historyCursor: null,
  messageText: '',
  messageDraft: '',
  messageHeight: null,
  cwd: null,
})

export function sh(message) {
  $.teach({ messageText: message })
  hideModal()
}

export function update(message) {
  hideModal()
}

$.teach({ body: `<code>art</code> <code>music</code> <code>coding</code>`, author: 'assistant' }, mergeMessage)

fileSystem = {}
$.teach({ cwd: '/' })

function history(state, payload) {
  return {
    ...state,
    history: [
      ...state.history,
      payload
    ]
  }
}


function mergeMessage(state, payload) {
  return {
    ...state,
    messages: [
      ...state.messages,
      payload
    ]
  }
}

const killCommands = ['exit', 'quit', 'escape']

function kill(program) {
  return killCommands.includes(program.toLowerCase())
}

const killCommandHandlers = {}

for(const command of killCommands) {
  killCommandHandlers[command] = () => {
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', keyCode: 27, which: 27, bubbles: true }));
  }
}

function disableSecureMode() {
  $.teach({ secureEntry: false })
}

function enableSecureMode() {
  $.teach({ secureEntry: true })
}

function normalMode() {
  $.teach({ modality: null, secureEntry: false })
}

function partial(response) {
  $.teach({ thinkingFace: response })
}

function done(response) {
  $.teach({ thinkingFace: null, thinking: false })
  $.teach({ body: response, author: 'assistant' }, mergeMessage)
}

const modalities = {
  async agent(program) {
    if((program === 'exit' || program === 'quit')) {
      $.teach({ modality: null })
      return 'Have a good one or two!'
    }
    $.teach({ thinking: true })
    const message = await agent(program, {
      partial,
      done
    })
    $.teach({ thinking: false })
    return message
  },

  async auth(program) {
    const { secureEntry } = $.learn()
    if(!secureEntry && (program === 'exit' || program === 'quit')) {
      $.teach({ modality: null, secureEntry: false })
      return 'Authentication aborted.'
    }
    return await auth(program, {
      enableSecureMode,
      disableSecureMode,
      normalMode
    })
  },
  luau(program) {
    if(kill(program)) {
      $.teach({ modality: null })
      return 'Exiting Luau modality.'
    }
    if(imports.haveLuau) {
      const logs = imports.haveLuau(program)

      return logs.join('\n')
    }
  },
  async js(program) {
    if(program === 'exit' || program === 'quit') {
      $.teach({ modality: null })
    return 'Exiting JS modality.'
    }
    if(imports.runJs) {
      return JSON.stringify(await imports.runJs(program), '', 2)
    }
  }

}

const commands = {
  ...killCommandHandlers,

  'help': () => `
**clownbot shell**

**apps**
\`art\` — flip-book animation
\`music\` — paper-pocket sequencer
\`coding\` — lore-baby storytelling
\`js\` — quickjs repl
\`exit\` / \`quit\` — close current modal

**filesystem (unix basics)**
\`pwd\` — print working directory (where am I?)
\`ls\` — list contents of current directory
\`cd <path>\` — change directory (\`cd ..\` to go up)

**shell**
\`↑ / ↓\` — navigate command history
\`Tab\` — autocomplete command
\`Ctrl+C\` — interrupt / cancel

**tips**
Click any \`code\` snippet to run it.
Type \`<elf-name>\` to load a custom element.
`,

  'pwd': function() {
    const { cwd } = $.learn()
    return cwd || '/'
  },

  'ls': function() {
    const { cwd } = $.learn()
    const entries = Object.keys(fileSystem || {})
      .filter(k => {
        const rel = k.startsWith(cwd) ? k.slice(cwd.length) : null
        return rel && !rel.includes('/')
      })
    if (!entries.length) return `${cwd || '/'}\n(empty)`
    return entries.join('  ')
  },

  'cd': function(path) {
    if (!path || path === '~') {
      $.teach({ cwd: '/' })
      return '/'
    }
    const { cwd } = $.learn()
    let next
    if (path === '..') {
      const parts = (cwd || '/').replace(/\/$/, '').split('/')
      parts.pop()
      next = parts.join('/') || '/'
    } else if (path.startsWith('/')) {
      next = path
    } else {
      next = ((cwd || '/').replace(/\/$/, '') + '/' + path)
    }
    $.teach({ cwd: next })
    return next
  },

  'art': () => {
    loadPath('/app/flip-book')
    return 'opening flip-book...'
  },
  'music': () => {
    loadPath('/app/paper-pocket')
    return 'opening paper-pocket...'
  },
  'coding': () => {
    loadPath('/app/lore-baby')
    return 'opening lore-baby...'
  },
  'js': () => {
    import('./js-repl.js').then((module) => {
      imports.runJs = module.runJs
      $.teach({ modality: 'js' })
    }).catch(e => console.error(e))
    return `Entering JS modality. Type 'exit' to leave.`
  },
}



function mount(target) {
  if(target.mounted) return
  target.mounted = true
  const command = target.getAttribute('command')
  const message = target.getAttribute('message')
  const src = target.getAttribute('src')
  const rom = target.getAttribute('rom')
  if(command) {
    execute(command)
  } else if(src) {
    execute(src, { suppressBack: true })
  } else if(rom) {
    execute('<'+rom, { suppressBack: true })
  } else if(message) {
    sh(message)
  }
}

$.draw((target) => {
  mount(target)
  const { secureEntry, messages, messageText, messageHeight, thinking, thinkingFace } = $.learn()

  const log = messages.map((message) => `
    <div class="message -${message.author}">${marked(message.body||'').trim()}</div>
  `).join('')

  return `
      <div class="scroll-back">
        <div class="messages">
          ${log}
          ${thinkingFace ? `
            <div class="message -assistant">
              ${marked(thinkingFace || '').trim()}
            </div>
          `:''}
        </div>
      </div>
      <form>
        ${thinking ? `
          <div class="loading">
            <flying-disk></flying-disk>
          </div>
        ` : ''}

        ${secureEntry ? `
          <input
            type="password"
            data-bind
            name="messageText"
            placeholder="help"
            value="${escapeHyperText(messageText)}">
        ` : `
          <textarea
            data-bind
            name="messageText"
            placeholder="help"
            ${messageHeight ? `style="height: ${messageHeight}px"`:''}
            value="${escapeHyperText(messageText)}"
          ></textarea>
        `}
      </form>
  `
}, {
  beforeUpdate,
  afterUpdate
})

function beforeUpdate(target) {
  { // convert a query string to new post
    const q = target.getAttribute('q')
    if(!target.initialized) {
      target.initialized = true

      if(q) {
        const message = decodeURIComponent(q)
        $.teach({ messageText: message })
      }
    }
  }

  //saveCursor(target)
}

function afterUpdate(target) {
  if (target.parentElement?.tagName === 'MAIN' && !target._scrollLocked) {
    target._scrollLocked = true

    document.addEventListener('touchstart', (e) => {
      const el = e.target.closest('.scroll-back')
      if (el) el._touchStartY = e.touches[0].clientY
    }, { passive: true })

    document.addEventListener('touchmove', (e) => {
      const el = e.target.closest('.scroll-back')
      if (!el) { e.preventDefault(); return }

      const dy = e.touches[0].clientY - (el._touchStartY || e.touches[0].clientY)
      const atTop    = el.scrollTop <= 0
      const atBottom = el.scrollTop + el.clientHeight >= el.scrollHeight - 1

      if ((dy > 0 && atTop) || (dy < 0 && atBottom)) e.preventDefault()
    }, { passive: false })
  }

  //replaceCursor(target)

  {
    const { messages } = $.learn()
    if(target.lastIndex !== messages.length -1) {
      target.lastIndex = messages.length - 1
      const scrollBack = target.querySelector('.scroll-back')
      if (scrollBack) scrollBack.scrollTop = scrollBack.scrollHeight
    }
  }

  {
    afterUpdateTheme($paperPocket, target)
  }
  {
    const theme = getTheme()
    if(target.theme !== theme) {
      target.theme = theme
      document.body.style.setProperty('--root-theme', theme)
      document.documentElement.style.setProperty('--root-theme', theme)
    }
  }

  {
    // only auto-focus on non-touch devices — on mobile this triggers the
    // keyboard on every render, fighting the viewport resize
    if (!window.matchMedia('(pointer: coarse)').matches) {
      const elem = document.querySelector('[name="messageText"]')
      if(elem) elem.focus()
    }
  }
}

let sel = []
const tags = ['TEXTAREA', 'INPUT']
function saveCursor(target) {
  if(target.contains(document.activeElement)) {
    target.dataset.field = document.activeElement.name
    if(tags.includes(document.activeElement.tagName)) {
      const textarea = document.activeElement
      sel = [textarea.selectionStart, textarea.selectionEnd];
    }
  }
}

function replaceCursor(target) {
  const field = target.querySelector(`[name="${target.dataset.field}"]`)
  
  if(field) {
    field.focus()

    if(tags.includes(field.tagName)) {
      field.selectionStart = sel[0];
      field.selectionEnd = sel[1];
    }
  }
}

function clearCursor(target) {
  target.dataset.field = null
  sel = []
}


$.when('keypress', 'form [name="messageText"]', (event) => {
  if (event.key === "Enter" && !event.shiftKey) {
    event.preventDefault();
    const message = event.target.value
    execute(message)
  }
})

$.when('submit', 'form', (event) => {
  event.preventDefault()
  const message = event.target.messageText.value
  execute(message)
})

const imports = {}

async function execute(message, options={}) {
  if(!message) return

  const { secureEntry } = $.learn()

  if(!secureEntry) {
    $.teach(message, history)
    $.teach({ body: message, author: 'human' }, mergeMessage)
  }

  $.teach({ historyCursor: null, messageHeight: null, messageText: '', messageDraft: '' })

  if(message.startsWith('<')) {
    $.teach({ body: 'load module', author: 'assistant' }, mergeMessage)
    loadModule(message, options)
    return
  }

  if(message.startsWith('/')) {
    $.teach({ body: 'load path', author: 'assistant' }, mergeMessage)
    loadPath(message, options)
    return
  }

  const { modality } = $.learn()

  if(modalities[modality]) {
    const result = await modalities[modality](message)
    if(result) {
      $.teach({ body: result, author: 'assistant' }, mergeMessage)
    }
    return
  }

  const [command, ...args] = message.split(' ')
  const program = commands[command] || commands[command.toLowerCase()]
  if(program) {
    try {
      const result = await program.apply($, args)
      if(result) {
        $.teach({ body: result || 'Success!', author: 'assistant' }, mergeMessage)
      }
    } catch(e) {
      $.teach({ body: `Error. Inspect Logs.<br><a href="${window.location.origin + window.location.pathname}?q=${message}&debug=true">Reload in debug mode</a>`, author: 'assistant' }, mergeMessage)
      console.error(e)
    }
    return
  } else {
    const body = 'Command not recognized. Ask for `help` if needed.'
    $.teach({ body, author: 'assistant' }, mergeMessage)
  }
}

export function loadPath(message, options = {}) {
  const tag = message.replace('/app/', '').split('?')[0]
  let html = `
    <div style="display: grid; height: 100%; width: 100%; grid-template-rows: auto 1fr;">
      <div style="background: black;">
        <button data-modal-close class="branded-button">Back</button>
      </div>
      <${tag}></${tag}>
    </div>
  `

  if(options.suppressBack) {
    html = `<${tag}></${tag}>`
  }

  // add some hype to our scene
  showModal(html, {
    blockExit: true,
    onHide: () => $.teach({ popped: false })
  })

  $.teach({ popped: true })
}

const elements = "a,abbr,address,area,article,aside,audio,b,base,bdi,bdo,blockquote,body,br,button,canvas,caption,cite,code,col,colgroup,data,datalist,dd,del,details,dfn,dialog,div,dl,dt,em,embed,fieldset,figcaption,figure,footer,form,h1,h2,h3,h4,h5,h6,head,header,hgroup,hr,html,i,iframe,img,input,ins,kbd,label,legend,li,link,main,map,mark,menu,meta,meter,nav,noscript,object,ol,optgroup,option,output,p,param,picture,pre,progress,q,rp,rt,ruby,s,samp,script,section,select,slot,small,source,span,strong,style,sub,summary,sup,table,tbody,td,template,textarea,tfoot,th,thead,time,title,tr,track,u,ul,var,video,wbr"


export async function loadModule(message, options = {}) {
  const [firstLine, ...lines] = message.split('\n')

  const elf = firstLine.slice(1)
  const url = `/public/elves/${elf}.js`
  const exists = (await fetch(url, { method: 'HEAD' })).ok
  if(!exists && !elements.includes(elf)) {
    $.teach({ body: 'ELF not found, ask "help" for assistance', author: 'assistant' }, mergeMessage)
    return
  }

  const properties = {}

  try {
    // loop over our lines one at a time
    for (const line of lines) {
      // where in the line is our break
      const index = line.indexOf(':')
      // before then is the attribute
      const key = line.substring(0, index)
      // after then is the data
      const value = line.substring(index+1)

      // no data?
      if(!key) {
        return
      }

      properties[key.trim()] = value.trim()
    }
    // collect the properties from our actor
    let innerHTML = ''
    let innerText = ''

    // convert them into hype attributes
    const attributes = Object.keys(properties)
      .map(x => {
        if(x === 'html') {
          innerHTML = properties[x]
          return ''
        }
        if(x === 'text') {
          innerText = properties[x]
          return ''
        }

        return `${x}="${properties[x]}" `
      }).join('')

    const elvish = `<${elf} ${attributes}>${innerHTML || innerText}</${elf}>`


    let html = `
      <div style="display: grid; height: 100%; width: 100%; grid-template-rows: auto 1fr;">
        <div style="background: black;">
          <button data-modal-close class="branded-button">Back</button>
        </div>
        ${elvish}
      </div>
    `

    if(options.suppressBack) {
      html = `
        <div style="width: 100%; height: 100%;">
          ${elvish}
        </div>
      `
    }

    showModal(html, {
      blockExit: true,
      onHide: () => $.teach({ popped: false })
    })

    $.teach({ popped: true })
  } catch(e) {
    console.error(e)
    $.teach({ body: 'ELF load failed, ask "help" for assistance', author: 'assistant' }, mergeMessage)
  }
}

$.style(`
  html:has(&),
  body:has(&) {
    position: fixed;
    inset: 0;
    overflow: hidden;
    overscroll-behavior: none;
    background: linear-gradient(335deg, rgba(0,0,0,.8), rgba(0,0,0,.9)), var(--root-theme, mediumseagreen);
  }

  main > & {
    position: fixed;
    inset: 0;
  }

  & {
    display: grid;
    grid-template-rows: 1fr auto;
    height: 100%;
    overflow: hidden;
    background: linear-gradient(335deg, rgba(0,0,0,.8), rgba(0,0,0,.9)), var(--root-theme, mediumseagreen);
  }

  /* scanlines */
  &::after {
    content: " ";
    display: block;
    position: fixed;
    top: 0;
    left: 0;
    bottom: 0;
    right: 0;
    background: rgba(18, 16, 16, 0.05);
    opacity: 0;
    z-index: 2;
    pointer-events: none;
  }
  &::before {
    content: " ";
    display: block;
    position: fixed;
    top: 0;
    left: 0;
    bottom: 0;
    right: 0;
    background: linear-gradient(rgba(255, 255, 255, .05) 50%, rgba(0, 0, 0, 0) 50%), linear-gradient(90deg, rgba(255, 0, 0, 0.06), rgba(0, 255, 0, 0.02), rgba(0, 0, 255, 0.06));
    z-index: 2;
    background-size: 100% 2px, 3px 100%;
    pointer-events: none;
  }

  & form input,
  & form textarea {
    width: 100%;
    display: block;
    border: none;
    border-radius: 0;
    padding: 8px;
    font-size: 1rem;
    background: linear-gradient(155deg, rgba(0,0,0,.7), rgba(0,0,0,.8)), var(--root-theme, mediumseagreen);
    color: rgba(255,255,255,.75);
  }

  & form textarea {
    resize: none;
    max-height: 35vh;
  }

  & textarea:focus,
  & input:focus {
    outline-offset: -2px;
    outline-color: transparent;
    caret-color: var(--root-theme, mediumseagreen);
  }

  & .scroll-back {
    height: 100%;
    overflow-y: auto;
    overflow-x: hidden;
    overscroll-behavior: contain;
    -webkit-overflow-scrolling: touch;
  }

  & .messages {
    padding: .5rem;
    display: flex;
    flex-direction: column;
    justify-content: end;
    min-height: 100%;
  }
  & .message {
    overflow: auto;
    position: relative;
    margin: 0;
    opacity: .85;
    overflow-wrap: break-word;
    word-wrap: break-word;
    max-width: 100%;
  }

  & .message pre, & .message code {
    white-space: pre-wrap;
  }

  & .message.-human {
    color: rgba(255,255,255,.95);
  }

  & .message a:link,
  & .message a:visited {
    background: linear-gradient(180deg, rgba(255,255,255,.5), var(--root-theme, mediumseagreen), rgba(0,0,0,.5)), var(--root-theme, mediumseagreen);
    -webkit-background-clip: text;
    -webkit-text-fill-color: transparent;
    text-decoration: none;
    border-bottom: 1px solid var(--root-theme, mediumseagreen);
  }
  & .message a:hover,
  & .message a:focus {
    background: linear-gradient(180deg, rgba(255,255,255,.3), rgba(255,255,255,.7)), var(--root-theme, mediumseagreen);
    -webkit-background-clip: text;
    -webkit-text-fill-color: transparent;
  }

  & .message.-assistant {
    background: linear-gradient(135deg, rgba(255,255,255,.25), rgba(255,255,255,.65)), var(--root-theme, mediumseagreen);
    -webkit-background-clip: text;
    -webkit-text-fill-color: transparent;
  }

  & .message.-assistant pre,
  & .message.-assistant code {
    -webkit-background-clip: initial;
    -webkit-text-fill-color: initial;
  }

  & code {
    cursor: pointer;
  }

  & .ur-title {
    color: var(--root-theme, #E83FB8);
    font-size: 2rem;
    font-family: 'Recursive';
    font-variation-settings: "MONO" 0, "CASL" 0, "wght" 800, "slnt" 0, "CRSV" 0;
  }

  & .message p {
    margin: 0;
  }
`)

function escapeHyperText(text = '') {
  return text.replace(/[&<>'"]/g, 
    actor => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      "'": '&#39;',
      '"': '&quot;'
    }[actor])
  )
}

$.when('input', '[data-bind]', event => {
  const { name, value } = event.target;
  $.teach({ [name]: value })
})

$.when('focus', '[name="messageText"]', (event) => {
  $.teach({ messageHeight: event.target.scrollHeight })
});

$.when('keydown', '[name="messageText"]', (event) => {
  $.teach({ messageHeight: event.target.scrollHeight })
});


$.when('input', '[name="messageText"]', (event) => {
  const { value } = event.target;
  $.teach({ messageDraft: value, messageHeight: event.target.scrollHeight })
});

$.when('click', 'code', (event) => {
  const value = event.target.innerText;
  execute(value)
});



$.when('keydown', '[name="messageText"]', event => {
  const { history, historyCursor, messageText, messageDraft } = $.learn()
  if(event.key === 'Tab') {
    event.preventDefault()
    const command = Object.keys(commands).find(x => x.startsWith(messageText))
    if(command) {
      $.teach({ messageText: command })
    }

    return
  }

  if(event.key === 'ArrowDown') {
    if(!isLastLine(event.target)) return
    if(historyCursor === null) return
    event.preventDefault()
    const cursor = historyCursor + 1
    if(cursor >= history.length) {
      $.teach({ historyCursor: null, messageText: messageDraft })
    } else {
      $.teach({ historyCursor: cursor, messageText: history[cursor] })
    }
    return
  }

  if(event.key === 'ArrowUp') {
    if(!isFirstLine(event.target)) return
    event.preventDefault()
    const cursor = (historyCursor === null) ? history.length - 1 : historyCursor - 1
    if(cursor < 0) return
    $.teach({ historyCursor: cursor, messageText: history[cursor] })
    return
  }
})

function isFirstLine(textarea) {
  const cursorPosition = textarea.selectionStart;
  const fullText = textarea.value;
  const textBeforeCursor = fullText.substring(0, cursorPosition);
  return !textBeforeCursor.includes('\n');
}

function isLastLine(textarea) {
  const cursorPosition = textarea.selectionStart;
  const fullText = textarea.value;
  const textAfterCursor = fullText.substring(cursorPosition);
  return !textAfterCursor.includes('\n');
}

function interrupt() {
  normalMode()
  $.teach({ secureEntry: false, messageHeight: null, messageText: '', messageDraft: '' })
  $.teach({ body: 'Girl, interrupted.', author: 'assistant' }, mergeMessage)
}

const hotkeys = {}

$.when('keydown', '[name="messageText"]', (event) => {
  hotkeys[event.key] = true

  if(hotkeys['Control'] && (event.key === 'c' || event.key === 'C')) {
    interrupt()
  }
})

$.when('keyup', '[name="messageText"]', (event) => {
  hotkeys[event.key] = false
})
