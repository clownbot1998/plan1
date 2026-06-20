import elf from '@silly/elf'
import { get } from './plan98-wallet.js'

const tag = 'was-video'

const $ = elf(tag)

const blobCache = {}

function draw() {}

$.style(`
  & {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 100%;
    height: 100%;
    min-width: 0;
    min-height: 0;
    font-size: 0;
    line-height: 0;
    container-type: size;
  }

  & video {
    display: block;
    max-width: 100%;
    height: 100cqmin;
    width: auto;
    object-fit: contain;
    margin: auto;
  }
`)

class SecureVideo extends HTMLElement {
  constructor() {
    super()
    $.draw(draw)
  }

  connectedCallback() {
    if (this.initialized) return
    this.initialized = true

    this.innerHTML = '<video></video>'
    const video = this.querySelector('video')

    video.controls = !this.hasAttribute('nocontrols')
    video.autoplay = this.hasAttribute('autoplay')
    video.muted = this.hasAttribute('muted')
    video.loop = this.hasAttribute('loop')

    const src = this.getAttribute('src')
    if (!src) return

    if (blobCache[src]) { video.src = blobCache[src]; return }

    get(src).then(blob => {
      const url = URL.createObjectURL(blob)
      blobCache[src] = url
      video.src = url
    })
  }

  disconnectedCallback() {
    const video = this.querySelector('video')
    if (video && video.srcObject) {
      video.pause();
      video.srcObject.getTracks().forEach(track => track.stop());
      video.srcObject = null;
    }
  }
}

customElements.define(tag, SecureVideo);
