import { Self } from '@plan98/types'

const tag = 'clown-board'
const $ = Self(tag, { selected: {}, blogFiles: [], memoryFiles: [] })

// gruvbox palette
const C = {
  bg:      '#1d2021',
  bg1:     '#282828',
  bg2:     '#3c3836',
  fg:      '#ebdbb2',
  dim:     '#7c6f64',
  orange:  '#fe8019',
  orangeD: '#d65d0e',
  green:   '#b8bb26',
  greenD:  '#98971a',
  yellow:  '#fabd2f',
  yellowD: '#d79921',
  blue:    '#83a598',
  blueD:   '#458588',
  aqua:    '#8ec07c',
  aquaD:   '#689d6a',
  purple:  '#d3869b',
  purpleD: '#b16286',
  red:     '#fb4934',
  redD:    '#cc241d',
}

const SECTIONS = [
  {
    label: '/',
    color: 'orange',
    files: [
      { path: '/plan98.js',        label: 'plan98'   },
      { path: '/main.js',          label: 'main'     },
      { path: '/types.js',         label: 'types'    },
      { path: '/saga.js',          label: 'saga'     },
      { path: '/as2.js',           label: 'as2'      },
      { path: '/cache.js',         label: 'cache'    },
      { path: '/plan98-shims.js',  label: 'shims'    },
      { path: '/index.html',       label: 'index'    },
    ]
  },
  {
    label: '/styles',
    color: 'yellow',
    files: [
      { path: '/styles/system.css', label: 'system'  },
    ]
  },
  {
    label: '/elves — shell',
    color: 'green',
    files: [
      { path: '/elves/my-computer.js',  label: 'my-computer'  },
      { path: '/elves/multi-task.js',   label: 'multi-task'   },
      { path: '/elves/ur-shell.js',     label: 'shell'        },
      { path: '/elves/sticky-menu.js',  label: 'sticky'       },
      { path: '/elves/lrud-elf.js',     label: 'lrud'         },
    ]
  },
  {
    label: '/elves — ai',
    color: 'green',
    files: [
      { path: '/elves/private-ai.js',     label: 'ai'      },
      { path: '/elves/open-clown.js',     label: 'clown'   },
      { path: '/elves/clownbot-brief.js', label: 'brief'   },
      { path: '/elves/elf-tools.js',      label: 'tools'   },
      { path: '/elves/was-code.js',       label: 'was'     },
    ]
  },
  {
    label: '/elves — editor',
    color: 'green',
    files: [
      { path: '/elves/squad-code.js',      label: 'squad'   },
      { path: '/elves/source-code.js',     label: 'source'  },
      { path: '/elves/js-repl.js',         label: 'repl'    },
      { path: '/elves/final-boss.js',      label: 'boss'    },
    ]
  },
  {
    label: '/elves — media',
    color: 'green',
    files: [
      { path: '/elves/flip-book.js',        label: 'flip'      },
      { path: '/elves/paper-pocket.js',     label: 'pocket'    },
      { path: '/elves/paper-nautiloids.js', label: 'nautiloids'},
      { path: '/elves/chroma-key.js',       label: 'chroma'    },
      { path: '/elves/dial-tone.js',        label: 'dial'      },
      { path: '/elves/clown-eyes.js',       label: 'eyes'      },
      { path: '/elves/debug-gamepads.js',   label: 'gamepads'  },
    ]
  },
  {
    label: '/elves — ui',
    color: 'green',
    files: [
      { path: '/elves/plan98-panel.js',   label: 'panel'   },
      { path: '/elves/plan98-toast.js',   label: 'toast'   },
      { path: '/elves/plan98-console.js', label: 'console' },
      { path: '/elves/plan98-modal.js',   label: 'modal'   },
      { path: '/elves/plan98-palette.js', label: 'palette' },
      { path: '/elves/plan98-wallet.js',  label: 'wallet'  },
      { path: '/elves/plan98-tree.js',    label: 'tree'    },
      { path: '/elves/qr-code.js',        label: 'qr'      },
      { path: '/elves/preview-gallery.js',label: 'gallery' },
      { path: '/elves/project-manager.js',label: 'projects'},
      { path: '/elves/blog-search.js',    label: 'search'  },
      { path: '/elves/lore-baby.js',      label: 'lore'    },
    ]
  },
  {
    label: '/elves — hypertext',
    color: 'green',
    files: [
      { path: '/elves/hypertext-action.js',       label: 'action'  },
      { path: '/elves/hypertext-address.js',      label: 'address' },
      { path: '/elves/hypertext-blankline.js',    label: 'blank'   },
      { path: '/elves/hypertext-comment.js',      label: 'comment' },
      { path: '/elves/hypertext-effect.js',       label: 'effect'  },
      { path: '/elves/hypertext-highlighter.js',  label: 'hi'      },
      { path: '/elves/hypertext-parenthetical.js',label: 'paren'   },
      { path: '/elves/hypertext-puppet.js',       label: 'puppet'  },
      { path: '/elves/hypertext-quote.js',        label: 'quote'   },
      { path: '/elves/hypertext-variable.js',     label: 'var'     },
      { path: '/elves/saga-highlighter.js',       label: 'saga-hi' },
      { path: '/elves/saga-pitch.js',             label: 'pitch'   },
      { path: '/elves/title-page.js',             label: 'title'   },
      { path: '/elves/typo-hero.js',              label: 'typo'    },
    ]
  },
  {
    label: '/sagas',
    color: 'aqua',
    files: [
      { path: '/sagas/plan1/the-story-so-far.saga', label: 'story'    },
      { path: '/sagas/sillyz.computer/about.saga',  label: 'about'    },
      { path: '/sagas/sillyz.computer/plan4.saga',  label: 'plan4'    },
    ]
  },
  {
    label: '/plan',
    color: 'purple',
    files: [
      { path: '/plan.md', label: 'plan.md' },
    ]
  },
]

const ON  = { orange: C.orange,  green: C.green,  yellow: C.yellow,  blue: C.blue,  aqua: C.aqua,  purple: C.purple,  red: C.red  }
const DIM = { orange: C.orangeD, green: C.greenD, yellow: C.yellowD, blue: C.blueD, aqua: C.aquaD, purple: C.purpleD, red: C.redD }

async function loadDynamicFiles() {
  const [blogRes, memRes] = await Promise.allSettled([
    fetch('/blog-src/').then(r => r.ok ? r.json() : []),
    fetch('/memory/').then(r => r.ok ? r.json() : []),
  ])
  $.teach({
    blogFiles: blogRes.status === 'fulfilled' ? blogRes.value : [],
    memoryFiles: memRes.status === 'fulfilled' ? memRes.value : [],
  })
}

loadDynamicFiles()

$.draw(() => {
  const { selected, blogFiles, memoryFiles } = $.learn()

  const dynamicSections = []
  if (blogFiles.length) {
    dynamicSections.push({
      label: '/blog',
      color: 'blue',
      files: blogFiles.map(f => ({
        path: `/blog-src/${f}`,
        label: f.replace(/^\d{4}-\d{2}-\d{2}-/, '').replace(/\.md$/, ''),
      }))
    })
  }
  if (memoryFiles.length) {
    dynamicSections.push({
      label: '/memory',
      color: 'purple',
      files: memoryFiles.map(f => ({
        path: `/memory/${f}`,
        label: f.replace(/\.md$/, ''),
      }))
    })
  }

  const allSections = [...SECTIONS, ...dynamicSections]
  const sections = allSections.map(sec => {
    const onColor  = ON[sec.color]
    const dimColor = DIM[sec.color]

    const buttons = sec.files.map(f => {
      const on = !!selected[f.path]
      return `<button
        class="pad ${on ? 'on' : 'off'}"
        data-path="${f.path}"
        data-color="${sec.color}"
        style="
          --on:${onColor};
          --dim:${dimColor};
        "
        title="${f.path}"
      >${f.label}</button>`
    }).join('')

    return `
      <div class="section">
        <div class="section-label">${sec.label}</div>
        <div class="pads">${buttons}</div>
      </div>
    `
  }).join('')

  const count = Object.values(selected).filter(Boolean).length

  return `
    <style>
      ${tag} {
        display: block;
        background: ${C.bg};
        color: ${C.fg};
        font-family: 'Recursive', monospace;
        font-variation-settings: 'MONO' 1;
        height: 100%;
        overflow-y: auto;
        padding: 1.6rem;
        box-sizing: border-box;
      }
      ${tag} .header {
        display: flex;
        align-items: baseline;
        gap: 1.6rem;
        margin-bottom: 1.6rem;
      }
      ${tag} h2 {
        color: ${C.yellowD};
        font-size: 1.2rem;
        letter-spacing: .15em;
        text-transform: uppercase;
        margin: 0;
      }
      ${tag} .count {
        color: ${C.dim};
        font-size: 1.1rem;
      }
      ${tag} .clear {
        background: transparent;
        border: 1px solid ${C.bg2};
        color: ${C.dim};
        font-family: 'Recursive', monospace;
        font-size: 1.1rem;
        padding: .2rem .8rem;
        cursor: pointer;
        border-radius: 3px;
        margin-left: auto;
      }
      ${tag} .clear:hover { border-color: ${C.orange}; color: ${C.orange}; }
      ${tag} .section {
        margin-bottom: 1.2rem;
      }
      ${tag} .section-label {
        color: ${C.dim};
        font-size: 1rem;
        letter-spacing: .1em;
        text-transform: uppercase;
        margin-bottom: .5rem;
        padding-bottom: .3rem;
        border-bottom: 1px solid ${C.bg2};
      }
      ${tag} .pads {
        display: grid;
        grid-template-columns: repeat(auto-fill, minmax(9rem, 1fr));
        gap: .4rem;
      }
      ${tag} .pad {
        height: 64px;
        border: none;
        border-radius: 4px;
        font-family: 'Recursive', monospace;
        font-variation-settings: 'MONO' 1;
        font-size: 1rem;
        cursor: pointer;
        transition: background .1s, color .1s;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        padding: 0 .6rem;
      }
      ${tag} .pad.off {
        background: ${C.bg1};
        color: var(--dim);
        border-bottom: 3px solid var(--dim);
      }
      ${tag} .pad.off:hover {
        background: ${C.bg2};
        color: var(--on);
        border-bottom-color: var(--on);
      }
      ${tag} .pad.on {
        background: var(--on);
        color: ${C.bg};
        border-bottom: 3px solid ${C.bg};
        font-weight: 700;
      }
      ${tag} .pad.on:hover {
        filter: brightness(1.1);
      }
    </style>

    <div class="header">
      <h2>clown board</h2>
      <span class="count">${count} selected</span>
      ${count ? `<button class="clear" data-clear>clear</button>` : ''}
    </div>

    ${sections}
  `
})

$.when('click', '[data-path]', e => {
  const path = e.target.closest('[data-path]').dataset.path
  const { selected } = $.learn()
  const next = { ...selected, [path]: !selected[path] }
  $.teach({ selected: next })
  document.dispatchEvent(new CustomEvent('clown-board:change', {
    detail: { selected: Object.keys(next).filter(k => next[k]) }
  }))
})

$.when('click', '[data-clear]', () => {
  $.teach({ selected: {} })
  document.dispatchEvent(new CustomEvent('clown-board:change', { detail: { selected: [] } }))
})
