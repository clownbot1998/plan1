import elf from '@plan98/elf'
import lunr from 'lunr'
import { render as renderSaga } from '@sillonious/saga'

const $ = elf('blog-search', {
  query: '',
  focused: false,
  noseVisible: false,
  closeNoseVisible: false,
})

let docs = []
let idx = null

fetch('/search-manifest.json')
  .then(r => r.json())
  .then(all => {
    docs = all.filter(d => d.type === 'html' || d.type === 'saga')
    idx = lunr(function() {
      this.ref('ref')
      this.field('name', { boost: 10 })
      this.field('keywords')
      docs.forEach(d => this.add(d))
    })
    $.teach({})
  })

function scheduleNose() {
  setTimeout(() => {
    $.teach({ noseVisible: true })
    setTimeout(() => { $.teach({ noseVisible: false }); scheduleNose() }, 2000)
  }, (5 + Math.random() * 55) * 1000)
}

function scheduleCloseNose() {
  setTimeout(() => {
    $.teach({ closeNoseVisible: true })
    setTimeout(() => { $.teach({ closeNoseVisible: false }); scheduleCloseNose() }, 2000)
  }, (5 + Math.random() * 55) * 1000)
}

scheduleNose()
scheduleCloseNose()

function results(query) {
  if (!query.trim()) return []
  if (!idx) return docs.filter(d => d.name.toLowerCase().includes(query.toLowerCase()))
  try {
    return idx.search(query + '~1').map(h => docs.find(d => d.ref === h.ref)).filter(Boolean)
  } catch(e) {
    return docs.filter(d => d.name.toLowerCase().includes(query.toLowerCase()))
  }
}

function searchIcon(noseVisible) {
  return `<svg class="bs-icon" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
    <circle cx="11" cy="11" r="7" stroke="currentColor" stroke-width="1.5"/>
    <line x1="16.5" y1="16.5" x2="21" y2="21" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
    ${noseVisible ? `<circle cx="11" cy="13" r="3" fill="firebrick"/>` : ''}
  </svg>`
}

function closeIcon(closeNoseVisible) {
  return `<button class="bs-close-btn" aria-label="Close search">
    <svg class="bs-icon" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <line x1="5" y1="5" x2="19" y2="19" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
      <line x1="19" y1="5" x2="5" y2="19" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
      ${closeNoseVisible ? `<circle cx="12" cy="19" r="3" fill="firebrick"/>` : ''}
    </svg>
  </button>`
}

function resultsList(hits) {
  if (!hits.length) return ''
  return `<ul class="bs-list">
    ${hits.map(d => `
      <li>
        <button class="bs-result" data-ref="${d.ref}" data-type="${d.type}">
          <span class="bs-type">${d.type}</span>${d.name}
        </button>
      </li>
    `).join('')}
  </ul>`
}

let needsFocus = false

$.draw(target => {
  const { query, focused, noseVisible, closeNoseVisible } = $.learn()
  const hits = results(query)

  if (needsFocus) {
    needsFocus = false
    requestAnimationFrame(() => {
      const el = target.querySelector('.bs-overlay-input')
      if (el) el.focus()
    })
  }

  return `
    <div class="bs-bar${focused ? ' bs-bar--hidden' : ''}">
      ${searchIcon(noseVisible)}
      <input class="bs-input bs-trigger-input" type="text" placeholder="clownbot"
        value="${query}" autocomplete="off" spellcheck="false" />
    </div>
    ${focused ? `
      <div class="bs-overlay">
        <div class="bs-overlay-inner">
          <div class="bs-bar">
            ${searchIcon(noseVisible)}
            <input class="bs-input bs-overlay-input" type="text" placeholder="clownbot"
              value="${query}" autocomplete="off" spellcheck="false" />
            ${closeIcon(closeNoseVisible)}
          </div>
          ${resultsList(hits)}
        </div>
      </div>
    ` : ''}
  `
})

$.when('focus', '.bs-trigger-input', () => {
  needsFocus = true
  $.teach({ focused: true })
})

$.when('input', '.bs-trigger-input', e => {
  $.teach({ query: e.target.value })
})

$.when('input', '.bs-overlay-input', e => {
  $.teach({ query: e.target.value })
})

$.when('keydown', '.bs-overlay-input', e => {
  if (e.key === 'Escape') $.teach({ focused: false, query: '' })
})

$.when('click', '.bs-close-btn', e => {
  e.stopPropagation()
  $.teach({ focused: false, query: '' })
})

$.when('click', '.bs-result', e => {
  const { ref, type } = e.target.closest('.bs-result').dataset
  $.teach({ focused: false, query: '' })
  if (type === 'saga') {
    openPrintDialog(ref)
  } else {
    window.location.href = ref
  }
})

document.addEventListener('click', e => {
  if (!e.target.closest('blog-search')) {
    $.teach({ focused: false, query: '' })
  }
})

function openPrintDialog(ref) {
  fetch(ref)
    .then(r => r.text())
    .then(text => {
      const html = renderSaga(text)
      const existing = document.getElementById('__print_dialog__')
      if (existing) existing.remove()

      const dialog = document.createElement('dialog')
      dialog.id = '__print_dialog__'
      dialog.innerHTML = `
        <div class="screenplay">${html}</div>
        <div class="print-banner">
          <button id="__print_cancel__">Close</button>
          <button id="__print_go__">Print</button>
        </div>
        <style>
          #__print_dialog__ {
            position: fixed;
            inset: 0;
            width: 100%;
            height: 100%;
            max-width: 100%;
            max-height: 100%;
            margin: 0;
            padding: 0;
            border: none;
            overflow-y: auto;
            background: white;
            z-index: 9000;
          }
          #__print_dialog__::backdrop { display: none; }
          .print-banner {
            position: fixed;
            bottom: 0; left: 0; right: 0;
            padding: .75rem 1rem;
            display: flex;
            gap: 1rem;
            justify-content: flex-end;
            background: white;
            border-top: 1px solid #e8e8e8;
            z-index: 9001;
          }
          .print-banner button {
            background: none;
            border: none;
            cursor: pointer;
            color: dodgerblue;
            font-family: 'BerkeleyMono', monospace;
            font-size: 1rem;
            padding: 0;
            text-decoration: underline;
          }
          .print-banner button:hover { color: #184f76; }
          .screenplay,
          .screenplay * {
            font-family: Courier, monospace !important;
          }
          .screenplay {
            background: white;
            margin: auto;
            color: rgba(0,0,0,.85);
            font-size: 12pt;
            padding: 1in 1rem 2in;
            position: relative;
            min-height: 100%;
            box-sizing: border-box;
          }
          @media (min-width: 768px) {
            .screenplay { max-width: 8.5in; padding: 1in 1in 2in 1.5in; }
          }
          hypertext-puppet {
            display: block;
            text-transform: uppercase;
            margin: 1rem auto;
            text-align: center;
            max-width: 6in;
          }
          hypertext-address {
            display: block;
            text-transform: uppercase;
            margin: 1rem auto;
            max-width: 6in;
          }
          hypertext-quote {
            display: block;
            padding: 0 4rem;
            margin: 1rem auto;
            max-width: calc(4in + 8rem);
          }
          hypertext-action {
            display: block;
            margin: 1rem auto;
            max-width: 6in;
          }
          hypertext-effect {
            display: block;
            margin: 1rem auto;
            text-align: right;
            max-width: 6in;
          }
          hypertext-parenthetical {
            display: block;
            text-align: center;
            margin: -1rem auto;
            max-width: 6in;
          }
          hypertext-blankline { display: block; margin: 1rem 0; }
          hypertext-comment { display: none; }
          @page { size: letter portrait; margin: 1in; }
          @media print {
            .print-banner { display: none; }
            .screenplay { padding-top: 0; }
          }
        </style>
      `
      document.body.appendChild(dialog)
      dialog.showModal()

      const beforePrint = () => {
        const screenplay = dialog.querySelector('.screenplay')
        Array.from(document.body.children).forEach(el => {
          if (el !== dialog) { el.dataset.printHidden = el.style.display; el.style.display = 'none' }
        })
        dialog.style.display = 'none'
        document.body.appendChild(screenplay)
        screenplay.style.cssText = `display:block!important;height:auto!important;max-height:none!important;overflow:visible!important;position:static!important;`
        document.body.style.cssText = 'margin:0;padding:0;background:white;overflow:visible;height:auto;'
      }
      const afterPrint = () => {
        Array.from(document.body.children).forEach(el => {
          if ('printHidden' in el.dataset) { el.style.display = el.dataset.printHidden; delete el.dataset.printHidden }
        })
        const screenplay = document.body.querySelector('.screenplay')
        if (screenplay) dialog.insertAdjacentElement('afterbegin', screenplay)
        dialog.style.display = ''
        document.body.style.cssText = ''
      }

      window.addEventListener('beforeprint', beforePrint)
      window.addEventListener('afterprint', afterPrint)
      document.getElementById('__print_go__').onclick = () => window.print()
      document.getElementById('__print_cancel__').onclick = () => {
        window.removeEventListener('beforeprint', beforePrint)
        window.removeEventListener('afterprint', afterPrint)
        dialog.close()
        dialog.remove()
      }
    })
}

$.style(`
  & {
    display: block;
    width: 100%;
    max-width: 320px;
    margin: 0 auto;
    position: relative;
    padding-top: 1rem;
    line-height: 1;
    font-family: 'BerkeleyMono', monospace;
  }

  & .bs-bar {
    display: flex;
    align-items: center;
    gap: .5rem;
    line-height: 1;
    border-bottom: 1px solid #e8e8e8;
    padding-bottom: 1rem;
  }

  & .bs-bar--hidden {
    visibility: hidden;
  }

  & .bs-icon {
    width: 1.6rem;
    height: 1.6rem;
    color: #bbb;
    flex-shrink: 0;
  }

  & .bs-input {
    border: none;
    outline: none;
    background: transparent;
    font-size: 1.6rem;
    font-family: 'BerkeleyMono', monospace;
    color: dodgerblue;
    width: 100%;
    padding: 0;
    caret-color: dodgerblue;
  }

  & .bs-input::placeholder {
    color: #bbb;
  }

  & .bs-overlay {
    position: fixed;
    inset: 0;
    background: white;
    z-index: 9000;
    overflow-y: auto;
    display: flex;
    flex-direction: column;
    align-items: center;
  }

  & .bs-overlay-inner {
    width: 100%;
    max-width: 640px;
    padding: 2rem 1.5rem;
    box-sizing: border-box;
  }

  & .bs-overlay-inner .bs-bar {
    max-width: 320px;
    margin: 0 auto 2rem;
    border-bottom: 1px solid #e8e8e8;
    padding-bottom: 1rem;
    line-height: 1;
  }

  & .bs-close-btn {
    background: none;
    border: none;
    padding: 0;
    cursor: pointer;
    flex-shrink: 0;
    color: #bbb;
    display: flex;
    align-items: center;
  }

  & .bs-close-btn:hover { color: #888; }
  & .bs-close-btn * { pointer-events: none; }
  & .bs-result * { pointer-events: none; }

  & .bs-list {
    list-style: none;
    margin: 0;
    padding: 0;
  }

  & .bs-list li { margin: 0; }

  & .bs-result {
    display: flex;
    align-items: baseline;
    gap: .6rem;
    width: 100%;
    border: none;
    background: transparent;
    color: dodgerblue;
    font-size: 1.4rem;
    text-align: left;
    padding: .6rem .5rem;
    cursor: pointer;
    font-family: 'BerkeleyMono', monospace;
  }

  & .bs-result:hover,
  & .bs-result:focus {
    background: #f0f6ff;
    outline: none;
  }

  & .bs-type {
    font-size: .9rem;
    color: #bbb;
    min-width: 3rem;
    text-transform: uppercase;
    letter-spacing: .04em;
    flex-shrink: 0;
  }
`)
