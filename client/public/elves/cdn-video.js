import { Self } from '@plan98/types'
import './hls-video.js'

const tag = 'cdn-video'
const $ = Self(tag)

$.draw(target => {
  if (target.innerHTML) return
  const cdn      = (typeof plan98 !== 'undefined' && plan98?.env?.HEAVY_ASSET_CDN_URL) || ''
  const src      = target.getAttribute('src') || ''
  const autoplay = target.getAttribute('autoplay') || 'false'
  const controls = target.getAttribute('controls') || 'false'
  const loop     = target.getAttribute('loop') || 'false'
  return `<hls-video
    id="${src}"
    src="${cdn}${src}"
    autoplay="${autoplay}"
    controls="${controls}"
    loop="${loop}"
  ></hls-video>`
})

$.style(`
  & {
    display: block;
    width: 100%;
    height: 100%;
    overflow: hidden;
  }
`)
