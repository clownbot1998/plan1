import { Self } from '@plan98/types'
import { toast } from './plan98-toast.js'

const tag = 'join-cta'
const $ = Self(tag)

$.draw(target => {
  const url = target.getAttribute('url') || location.href
  const title = target.getAttribute('title') || ''
  const description = target.getAttribute('description') || ''
  const safe = url.replace(/&/g, '&amp;').replace(/"/g, '&quot;')

  return `
    <div class="join-grid">
      <div class="join-left">
        <div class="join-qr"><qr-code src="${safe}"></qr-code></div>
        <input class="join-url standard-input" readonly value="${safe}">
        <div class="join-actions">
          <button class="standard-button bias-generic" data-copy>copy</button>
          <button class="standard-button bias-generic" data-share>share</button>
          <button class="standard-button bias-generic" data-import>import</button>
          <button class="standard-button bias-generic" data-export>export</button>
        </div>
      </div>
      <div class="join-right">
        ${title ? `<h1>${title}</h1>` : ''}
        ${description ? `<p>${description}</p>` : ''}
      </div>
    </div>
  `
})

$.when('click', '[data-copy]', async e => {
  const host = e.target.closest(tag)
  const input = host?.querySelector('.join-url')
  if (!input) return
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(input.value)
    } else {
      input.select()
      document.execCommand('copy')
    }
    toast('copied to clipboard')
  } catch { toast('copy failed') }
})

$.when('click', '[data-share]', async e => {
  const host = e.target.closest(tag)
  const url = host?.getAttribute('url') || location.href
  const title = host?.getAttribute('title') || ''
  if (navigator.share) {
    try { await navigator.share({ url, title }) } catch (_) {}
  }
})

$.when('click', '[data-import]', e => {
  e.target.closest(tag)?.dispatchEvent(new CustomEvent('cta-import', { bubbles: true }))
})

$.when('click', '[data-export]', e => {
  e.target.closest(tag)?.dispatchEvent(new CustomEvent('cta-export', { bubbles: true }))
})

$.style(`
  & {
    display: block;
    font-family: 'Recursive', monospace;
  }
  & .join-grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 2rem;
    align-items: center;
  }
  & .join-left {
    display: flex;
    flex-direction: column;
    gap: 1rem;
  }
  & .join-qr {
    background: white;
    padding: .75rem;
    border-radius: 8px;
    max-width: 300px;
    margin: 0 auto;
  }
  & .join-qr qr-code { display: block; max-width: 100%; }
  & .join-url {
    width: 100%;
    box-sizing: border-box;
  }
  & .join-actions {
    display: flex;
    gap: .5rem;
  }
  & .join-right h1 {
    font-size: 2rem;
    margin: 0 0 1rem;
    font-weight: 700;
  }
  & .join-right p {
    font-size: 1rem;
    line-height: 1.6;
    margin: 0 0 .75rem;
  }
  @media (max-width: 767px) {
    & .join-grid {
      grid-template-columns: 1fr;
    }
    & .join-right { order: -1; }
  }
`)
