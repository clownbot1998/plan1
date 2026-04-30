import { Self } from '@plan98/types'

const tag = 'tty-elf'
const $ = Self(tag)

$.draw(target => {
  const { src = '/shell/' } = $.learn()
  return `
    <style>
      ${tag} {
        display: block;
        width: 100%;
        height: 100%;
      }
      ${tag} iframe {
        width: 100%;
        height: 100%;
        border: none;
        background: #000;
      }
    </style>
    <iframe src="${src}" allow="clipboard-read; clipboard-write"></iframe>
  `
})
