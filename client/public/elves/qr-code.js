import elf from '@plan98/elf'
import QrCreator from 'qr-creator'

const $ = elf('qr-code')

$.draw(target => {
  const codes = $.learn()
  const href = target.getAttribute('src') || target.getAttribute('text')
  const lazyPrefix = target.getAttribute('lazy-prefix') === 'true'
  const code = lazyPrefix ? globalThis.location.origin + href : href
  const _target = target.getAttribute('target') || '_top'
  const noLink = target.getAttribute('no-link') === 'true'
  const { fg = 'black', bg = 'white' } = target.dataset
  const image = codes[code]

  generate(target, code, { fg, bg })

  if (!image) return ''
  return noLink
    ? `<div class="portal" style="--fg:${fg};--bg:${bg}">${image}</div>`
    : `<a href="${code}" target="${_target}" class="portal" style="--fg:${fg};--bg:${bg}">${image}</a>`
})

async function generate(target, code, { fg, bg }) {
  if (target.code === code) return
  target.code = code
  await new Promise(r => setTimeout(r, 1))
  const node = document.createElement('div')
  QrCreator.render({ text: code, radius: 0.5, ecLevel: 'L', fill: fg, background: bg, size: 1080 }, node)
  const dataURL = node.querySelector('canvas').toDataURL()
  $.teach({ [code]: `<img src="${dataURL}" alt="qr code" />` })
}

$.style(`
  & {
    display: block;
    max-height: 100%;
    max-width: 100%;
    width: 100%;
    aspect-ratio: 1;
    position: relative;
    margin: auto;
  }
  & .portal {
    display: flex;
    height: 100%;
    width: 100%;
    place-items: center;
    border: 0;
    background: transparent;
  }
  & img { max-height: 100%; }
`)
