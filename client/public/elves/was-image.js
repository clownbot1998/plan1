import elf from '@silly/elf'
import { get } from './plan98-wallet.js'
import heic2any from 'heic2any'
import makeCache from '@silly/cache'

const tag = 'was-image'
const $ = elf(tag)

const blobCache = {}
const blobStore = makeCache('was-image-blobs')

async function fetchAndConvert(src) {
  const cached = await blobStore.get(src)
  if (cached) return new Blob([cached.data], { type: cached.type })

  const raw = await get(src)
  const mime = raw.type.toLowerCase()
  const isHeic = mime === 'image/heic' || mime === 'image/heif' || /\.(heic|heif)$/i.test(src)

  let blob
  if (isHeic) {
    try {
      const converted = await heic2any({ blob: raw, toType: 'image/jpeg', quality: 0.85 })
      blob = Array.isArray(converted) ? converted[0] : converted
    } catch (_) {
      blob = new Blob([raw], { type: raw.type })
    }
  } else {
    blob = new Blob([raw], { type: raw.type })
  }

  blobStore.put(src, await blob.arrayBuffer(), blob.type).catch(() => {})
  return blob
}

const _warmQueue = []
let _inFlight = 0
const WARM_CONCURRENCY = 3

function drainWarm() {
  while (_inFlight < WARM_CONCURRENCY && _warmQueue.length) {
    const src = _warmQueue.shift()
    _inFlight++
    fetchAndConvert(src)
      .then(blob => { blobCache[src] = URL.createObjectURL(blob) })
      .catch(() => {})
      .finally(() => { _inFlight--; drainWarm() })
  }
}

export function warm(src) {
  if (blobCache[src] || _warmQueue.includes(src)) return
  _warmQueue.push(src)
  drainWarm()
}

function draw(target) {
  if(target && target.innerHTML) return
  target.innerHTML = `<img />`
}

$.style(`
  & {
    display: block;
    width: 100%;
    height: 100%;
    min-width: 0;
    min-height: 0;
    overflow: hidden;
    line-height: 0;
    container-type: size;
  }
  & img {
    display: block;
    max-width: 100%;
    height: 100cqmin;
    width: auto;
    object-fit: contain;
  }
`)

function beforeUpdate(target) {
}

function afterUpdate(target) {
  if(!target.initialized) {
    target.initialized = true
    const src = target.getAttribute('src')
    if(!src) return

    const image = target.querySelector('img')

    // Cache hit — instant
    if (blobCache[src]) {
      image.src = blobCache[src]
      return
    }

    fetchAndConvert(src).then(blob => {
      const url = URL.createObjectURL(blob)
      blobCache[src] = url
      image.src = url
    })
  }
}

class SecureImage extends HTMLElement {
  constructor() {
    super();
    // Initialize your component here
    $.draw(draw, { beforeUpdate, afterUpdate })
  }
}

customElements.define(tag, SecureImage);
