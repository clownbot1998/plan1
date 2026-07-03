import { Self } from '@plan98/types'

const tag = 'help-desk'
const $ = Self(tag)

const OPTIONS = [
  { label: 'Plan1: AI Assisted', href: '/app/bulletin-board?id=elf-map' },
  { label: 'Plan98: Human Stubborn', href: '/app/bulletin-board?id=plan98-map' },
]

$.draw(target => `
  <div class="hd-shell">
    <h1 class="hd-title">Help Desk</h1>
    <p class="hd-body">Thank you for trying our services. To best assist you, select an option below.</p>
    <div class="hd-options">
      ${OPTIONS.map(o => `<a class="hd-btn" href="${o.href}">${o.label}</a>`).join('')}
    </div>
  </div>
`)

$.style(`
  & {
    display: block;
    height: 100%;
    background: #f3f1ea;
    color: #1a1a1a;
    font-family: 'Recursive', system-ui, sans-serif;
    display: grid;
    place-items: center;
  }

  & .hd-shell {
    max-width: 40ch;
    text-align: center;
    padding: 2rem;
  }

  & .hd-title {
    margin: 0 0 .75rem;
    font-size: 1.6rem;
  }

  & .hd-body {
    margin: 0 0 1.5rem;
    opacity: .8;
    line-height: 1.5;
  }

  & .hd-options {
    display: flex;
    flex-direction: column;
    gap: .75rem;
  }

  & .hd-btn {
    display: block;
    padding: .8rem 1.2rem;
    background: #1a1a1a;
    color: #f3f1ea;
    text-decoration: none;
    border-radius: .3rem;
    font-weight: 700;
    transition: opacity .1s;
  }

  & .hd-btn:hover {
    opacity: .85;
  }
`)
