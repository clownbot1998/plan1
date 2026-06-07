import { Self } from '@plan98/types'
import Hls from 'hls.js'

const tag = 'hls-video'
const $ = Self(tag)

$.draw(target => {
  if (target.innerHTML) return
  const loop     = target.getAttribute('loop')     === 'true'
  const autoplay = target.getAttribute('autoplay') === 'true'
  const controls = target.getAttribute('controls') === 'true'
  return `<video playsinline disablepictureinpicture
    ${loop     ? 'loop'          : ''}
    ${autoplay ? 'autoplay'      : ''}
    ${controls ? 'controls'      : ''}
  ></video>`
}, {
  afterUpdate(target) {
    if (target._hlsWired) return
    const video = target.querySelector('video')
    if (!video) return
    target._hlsWired = true

    const src = target.getAttribute('src')
    if (!src) return

    if (Hls.isSupported()) {
      const hls = new Hls()
      target._hls = hls
      hls.loadSource(src)
      hls.attachMedia(video)
      hls.on(Hls.Events.MANIFEST_PARSED, () => {
        if (target.getAttribute('autoplay') === 'true') video.play().catch(() => {})
      })
    } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
      // Safari native HLS
      video.src = src
      if (target.getAttribute('autoplay') === 'true') video.play().catch(() => {})
    }
  }
})

$.style(`
  & {
    display: block;
    background: black;
    height: 100%;
  }
  & video {
    margin: auto;
    width: 100%;
    height: 100%;
    object-fit: contain;
  }
`)

customElements.define(tag, class HlsVideo extends HTMLElement {
  disconnectedCallback() {
    this.querySelector('video')?.pause()
    this._hls?.stopLoad()
    this._hls?.destroy()
    this._hls = null
    this._hlsWired = false
  }
})
