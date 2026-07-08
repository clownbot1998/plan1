import { Self, True, False, Value, Text, Add, Subtract, Multiply, Divide, Modulo, Log, Bug } from '@plan98/types'

const tag = 'elf-jo'
const $ = Self(tag, { chapter: 1, continued: false, vibe: true, op: 'Add', a: 2, b: 3, bootLog: [] })

// Chapter 2: undefined. Chapter 3: null. Chapter 4: 0.
// elf-jo did not exist until this line ran. before it, it was undefined.
// Self(tag, ...) is the one act of definition a sovereign elf cannot skip --
// jo.saga says it best: "That computer before being defined was undefined."

// Chapter 7: function
function hello() {
  return 'Hello'
}

// Chapter 8: if/else
function socialHelper(vibe) {
  if (vibe) {
    return 'Hello'
  } else {
    return 'Goodbye'
  }
}

// Chapter 9: Math, using jo's own words from @plan98/types
const CALCULATOR = { Add, Subtract, Multiply, Divide, Modulo }

// Chapter 10: Errors
function bad(data) {
  return data.error
}

function validate(data) {
  if (!data) {
    throw new Error('No data!')
  }
  if (bad(data)) {
    throw new Error(data.error)
  }
  return data
}

// Chapter 11: Error Handling / Chapter 12: Main Street
function main(data) {
  return `main() received clean data: ${Text(JSON.stringify(data))}`
}

function security(data) {
  try {
    validate(data)
    return main(data)
  } catch (error) {
    Bug(error.message)
    return `caught: ${error.message}`
  }
}

function boot(data) {
  return security(data)
}

// Chapter 14: The Finite Reality -- elf-jo's own sovereign state, lifted
// verbatim from jo.saga. this is NOT plan98's store. it is jo's.
function reality(initialState = {}, callback = () => null) {
  let state = { ...initialState }
  const defaultMerge = (s, p) => ({ ...s, ...p })

  return {
    set: function (key, data, merge = defaultMerge) {
      const current = state[key] || {}
      const latest = merge(current, data)
      state = { ...state, [key]: latest }
      callback(key)
    },
    get: function (key) {
      return state[key]
    }
  }
}

// Chapter 15: Reactive Programming
const callbacks = []
function callback(key) {
  callbacks.forEach(cb => cb(key))
}

// elf-jo's sovereign reality. plan98 never touches this directly --
// it only hears about it through the one bridge below.
const fiction = reality({}, callback)

// the bridge: jo's reality talks, plan98's elf() listens and redraws.
// this is Chapter 16's connect() grown up -- $.teach/$.learn/$.draw
// already ARE link/model/view/controller. jo called it first.
callbacks.push(key => $.teach({ fictionKey: key, fictionValue: fiction.get(key) }))

const CHAPTERS = [
  { n: 1, title: 'Jo', body: `Jo is a tiny elf that likes coding and coffee.\n\nEvery morning Jo wakes up with a cup of Joe writing jo.\n\nJo made a whole computer in jo. Jo wants to teach you jo.\n\nThis is the Book of Jo.` },
  { n: 2, title: 'undefined', body: `Before Jo built a computer, that computer did not exist.\n\nThat computer before being defined was undefined.\n\nThe first word Jo put into the computer was\n\nundefined\n\nAnd the undefined computer was defined and it was good.` },
  { n: 3, title: 'null', body: `While the computer was technically defined as undefined it was empty.\n\nJo defined this not undefined, but empty computer as\n\nnull\n\nThe computer exists, but it is empty.` },
  { n: 4, title: '0', body: `While Jo was building the tiny computer, it was clear that null was four bytes.\n\nJo found it a little silly that something that was nothing was 4.\n\nSo Jo created a system of integers and made 0 nothing, stored as 1 byte.` },
  { n: 5, title: 'false', body: `Everyone watching Jo build the computer said, "Everything is wrong!"\n\nAnd Jo said, "False!" because undefined, null, and 0 were not wrong.\n\nThey just evaluated to false.` },
  { n: 6, title: 'true', body: `Jo realized the power of a computer was in the facts. The truth.\n\nJo gave jo true to stand in stark opposition to undefined, null, 0, false, and the ilk.` },
  { n: 7, title: 'function', body: `Jo made a new word: function.\n\nThe function of the function is to function.\n\nfunction hello() {\n  return "Hello"\n}`, demo: 'hello' },
  { n: 8, title: 'if/else', body: `Jo wanted a program that would say "Hello" to positivity and "Goodbye" to negativity.\n\nfunction socialHelper(vibe) {\n  if(vibe) { return "Hello" } else { return "Goodbye" }\n}`, demo: 'social' },
  { n: 9, title: 'Math', body: `Jo wrote a file: calculator.js and exported the fundamental formulas.\n\nAdd, Subtract, Multiply, Divide, Modulo.`, demo: 'math' },
  { n: 10, title: 'Errors', body: `Not all programs would be perfect. Jo would throw.\n\nfunction validate(data) {\n  if(!data) throw new Error("No data!")\n  if(bad(data)) throw new Error(data.error)\n  return data\n}` },
  { n: 11, title: 'Error Handling', body: `function security(data) {\n  try {\n    validate(data)\n    main(data)\n  } catch(error) {\n    console.error(error)\n  }\n}`, demo: 'boot' },
  { n: 12, title: 'Main Street', body: `function main(data) {\n  // now in the main jo program, we can assume we have error-free data to play.\n}\n\nWith enough of the core concepts of jo established, jo is ready for you.` },
  { n: 13, title: 'The Infinite Reality', body: `Every program in all reality ever started as main().\n\nGaining fluency gains competency gains agency gains mastery.\n\nJo will not leave you there though. Continue with Jo into the great unknown?`, demo: 'choice' },
  { n: 14, title: 'The Finite Reality', body: `To define a reality, give it an initial state and a callback for updates.\n\nData can be read via get() and Jo can write data with set(), surgically.` },
  { n: 15, title: 'Reactive Programming', body: `Callbacks are what Jo used to take at the phone company.\n\nWhen someone wanted to buy, they just set their data in the fictional reality.`, demo: 'fiction' },
  { n: 16, title: 'Irreverant Systems', body: `link/model/view/controller. jo called it connect(). plan98 calls it elf().\n\nThey are the same shape.`, demo: 'declare' },
]

function escape(str) {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

function renderDemo(demo, state) {
  if (demo === 'hello') {
    return `<div class="demo"><button type="button" class="run" data-run="hello">hello()</button><span class="out">${escape(hello())}</span></div>`
  }
  if (demo === 'social') {
    return `<div class="demo">
      <label><input type="checkbox" class="vibe-toggle" ${state.vibe ? 'checked' : ''}/> vibe</label>
      <span class="out">socialHelper(${state.vibe}) &rarr; ${escape(socialHelper(state.vibe))}</span>
    </div>`
  }
  if (demo === 'math') {
    const fn = CALCULATOR[state.op] || Add
    const result = fn(Number(state.a), Number(state.b))
    return `<div class="demo math">
      <input class="num a" type="number" value="${state.a}" />
      <select class="op">
        ${Object.keys(CALCULATOR).map(k => `<option value="${k}" ${state.op === k ? 'selected' : ''}>${k}</option>`).join('')}
      </select>
      <input class="num b" type="number" value="${state.b}" />
      <span class="out">= ${escape(Text(result))}</span>
    </div>`
  }
  if (demo === 'boot') {
    return `<div class="demo">
      <button type="button" class="run" data-run="boot-ok">boot({ok:true})</button>
      <button type="button" class="run" data-run="boot-bad">boot({})</button>
      <div class="bootlog">${state.bootLog.map(l => `<div>${escape(l)}</div>`).join('') || '<div class="muted">no boots yet</div>'}</div>
    </div>`
  }
  if (demo === 'choice') {
    return `<div class="demo choice">
      <button type="button" class="run" data-run="yes">[yes]</button>
      <button type="button" class="run" data-run="no">[no]</button>
      ${state.continued ? '<div class="out">continuing into the great unknown...</div>' : ''}
    </div>`
  }
  if (demo === 'fiction') {
    return `<div class="demo">
      ${['test', 'type', 'name', 'beverage', 'language'].map(k => `<button type="button" class="run" data-run="fiction-${k}">fiction.set('test', {${k}})</button>`).join('')}
      <div class="out">fiction.get('test') &rarr; ${escape(Text(JSON.stringify(fiction.get('test') || {})))}</div>
    </div>`
  }
  if (demo === 'declare') {
    return `<div class="demo declare">
      <div class="out">elf-jo is sovereign: it runs on its own reality(), reachable through nothing plan98 owns.</div>
      <div class="out">elf-jo is not sovereign: it exists only because Self('elf-jo') defined it, same as jo.saga chapter 2.</div>
      <div class="out muted">both are true. jo said so first.</div>
    </div>`
  }
  return ''
}

$.draw(target => {
  const state = $.learn()
  const chapter = CHAPTERS.find(c => c.n === state.chapter) || CHAPTERS[0]
  const locked = chapter.n > 13 && !state.continued

  return `
    <div class="book">
      <header>
        <span class="brand">elf-jo</span>
        <span class="progress">Chapter ${chapter.n} / ${CHAPTERS.length}</span>
      </header>
      <main>
        <h1>${chapter.n}. ${escape(chapter.title)}</h1>
        ${locked
          ? `<p class="muted">Jo is waiting for an answer to Chapter 13 before continuing.</p>`
          : `<pre class="prose">${escape(chapter.body)}</pre>${chapter.demo ? renderDemo(chapter.demo, state) : ''}`
        }
      </main>
      <footer>
        <button type="button" class="nav prev" ${chapter.n <= 1 ? 'disabled' : ''}>&larr; prev</button>
        <button type="button" class="nav next" ${chapter.n >= CHAPTERS.length || locked || (chapter.n === 13 && !state.continued) ? 'disabled' : ''}>next &rarr;</button>
      </footer>
    </div>
  `
})

$.when('click', '.nav.prev', () => {
  const { chapter } = $.learn()
  $.teach({ chapter: Math.max(1, chapter - 1) })
})

$.when('click', '.nav.next', () => {
  const { chapter } = $.learn()
  $.teach({ chapter: Math.min(CHAPTERS.length, chapter + 1) })
})

$.when('click', '[data-run="hello"]', () => {
  Log(hello())
})

$.when('click', '.vibe-toggle', event => {
  $.teach({ vibe: event.target.checked })
})

$.when('input', '.num.a', event => $.teach({ a: event.target.value }))
$.when('input', '.num.b', event => $.teach({ b: event.target.value }))
$.when('change', '.op', event => $.teach({ op: event.target.value }))

$.when('click', '[data-run="boot-ok"]', () => {
  const result = boot({ ok: True() })
  const { bootLog } = $.learn()
  $.teach({ bootLog: [...bootLog, result] })
})

$.when('click', '[data-run="boot-bad"]', () => {
  const result = boot(False() ? {} : undefined)
  const { bootLog } = $.learn()
  $.teach({ bootLog: [...bootLog, result] })
})

$.when('click', '[data-run="yes"]', () => {
  $.teach({ continued: true, chapter: 14 })
})

$.when('click', '[data-run="no"]', () => {
  $.teach({ continued: false })
})

;['test', 'type', 'name', 'beverage', 'language'].forEach(key => {
  $.when('click', `[data-run="fiction-${key}"]`, () => {
    // this write goes to jo's reality, not plan98's. the bridge callback
    // above is what makes it show up on screen at all.
    fiction.set('test', { [key]: Value('jo') })
  })
})

$.style(`
  & {
    display: block;
    height: 100%;
    overflow-y: auto;
    background: #0c0c0c;
    color: #eee;
    font-family: 'Recursive', monospace;
  }
  & .book {
    display: grid;
    grid-template-rows: auto 1fr auto;
    height: 100%;
  }
  & header {
    display: flex;
    justify-content: space-between;
    padding: 0.75rem 1rem;
    border-bottom: 1px solid #333;
    font-size: 0.85rem;
    opacity: 0.8;
  }
  & main {
    padding: 1.25rem;
    overflow-y: auto;
  }
  & h1 {
    margin: 0 0 0.75rem;
    font-size: 1.1rem;
  }
  & .prose {
    white-space: pre-wrap;
    font-family: inherit;
    line-height: 1.5;
    margin: 0 0 1rem;
  }
  & .demo {
    display: flex;
    flex-wrap: wrap;
    gap: 0.5rem;
    align-items: center;
    padding: 0.75rem;
    border: 1px dashed #444;
    border-radius: 6px;
  }
  & .demo.declare, & .demo .out { flex-basis: 100%; }
  & .num { width: 4rem; }
  & .out { opacity: 0.9; }
  & .muted { opacity: 0.5; }
  & .bootlog { flex-basis: 100%; font-size: 0.85rem; }
  & button {
    background: #1a1a1a;
    color: #eee;
    border: 1px solid #444;
    border-radius: 4px;
    padding: 0.35rem 0.6rem;
    cursor: pointer;
  }
  & button:disabled { opacity: 0.3; cursor: default; }
  & footer {
    display: flex;
    justify-content: space-between;
    padding: 0.75rem 1rem;
    border-top: 1px solid #333;
  }
`)
