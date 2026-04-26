import { Self } from '@plan98/types'

const tag = 'clown-eyes'
const $ = Self(tag)

$.draw(target => {
  const { url, loading, img, error } = $.learn()
  const src = target.getAttribute('src')
  const inputUrl = url ?? src ?? ''

  if (src && !img && !loading && !error) {
    setTimeout(() => shoot(src), 0)
  }

  if (src) return `
    <div class="letterbox">
      ${loading ? `<div class="status">rendering...</div>` : ''}
      ${error   ? `<div class="status error">${error}</div>` : ''}
      ${img && !loading ? `<img class="shot" src="${img}" alt="screenshot" />` : ''}
    </div>
  `

  return `
    <div class="shell">
      <form class="bar">
        <input class="url-input" type="text" value="${inputUrl}" placeholder="http://localhost:1998/app/..." />
        <button type="submit">${loading ? 'shooting...' : 'shoot'}</button>
      </form>
      <div class="letterbox">
        ${loading ? `<div class="status">rendering...</div>` : ''}
        ${error   ? `<div class="status error">${error}</div>` : ''}
        ${img && !loading ? `<img class="shot" src="${img}" alt="screenshot" />` : ''}
      </div>
    </div>
  `
})

$.when('submit', 'form.bar', event => {
  event.preventDefault()
  const input = event.target.querySelector('.url-input')
  const url = input.value.trim()
  if (!url) return
  $.teach({ url })
  shoot(url)
})

async function shoot(url) {
  $.teach({ loading: true, error: null, img: null })
  try {
    const res = await fetch(`/eyes?url=${encodeURIComponent(url)}`)
    if (!res.ok) throw new Error(await res.text())
    const blob = await res.blob()
    const img = URL.createObjectURL(blob)
    $.teach({ loading: false, img })
  } catch(e) {
    $.teach({ loading: false, error: e.message })
  }
}

$.style(`
  & {
    display: block;
    height: 100%;
    background: #000;
    color: #fff;
    font-family: 'Recursive', monospace;
  }
  & .shell {
    display: grid;
    grid-template-rows: auto 1fr;
    height: 100%;
  }
  & .bar {
    display: flex;
    gap: .5rem;
    padding: .5rem;
    background: #111;
    border-bottom: 1px solid #333;
  }
  & .url-input {
    flex: 1;
    background: #222;
    color: #fff;
    border: 1px solid #444;
    padding: .25rem .5rem;
    font-family: inherit;
    font-size: .9rem;
  }
  & button {
    background: #333;
    color: #fff;
    border: 1px solid #555;
    padding: .25rem .75rem;
    cursor: pointer;
    font-family: inherit;
  }
  & button:hover { background: #444; }
  & .letterbox {
    background: #000;
    display: flex;
    align-items: center;
    justify-content: center;
    overflow: hidden;
    min-height: 0;
    height: 100%;
  }
  & .shot {
    width: 100%;
    height: 100%;
    object-fit: contain;
    display: block;
  }
  & .status {
    color: #888;
    font-size: .9rem;
  }
  & .status.error { color: #f66; }
`)
