import elf from '@plan98/elf'
import * as Tone from 'tone@next'
import { SampleLibrary } from '/cdn/attentionandlearninglab.com/Tonejs-Instruments.js'
import './lrud-elf.js'
import { checkButton } from './debug-gamepads.js'

const $ = elf('dial-tone', { root: 60, meander: true })

// v-log intervals: j=root, k=+7, l=+2, h=+9, u=+4, i=+11, y=+6, o=+13
const NOTE_BTNS = [
  { btn: 0, interval: 0  },  // j
  { btn: 1, interval: 7  },  // k
  { btn: 3, interval: 2  },  // l
  { btn: 2, interval: 9  },  // h
  { btn: 4, interval: 4  },  // u
  { btn: 5, interval: 11 },  // i
  { btn: 6, interval: 6  },  // y
  { btn: 7, interval: 13 },  // o
]

const keyHeld = {}

function releaseAll() {
  for (const note in keyHeld) {
    try { current?.triggerRelease(Tone.Frequency(parseInt(note), "midi").toNote()) } catch(e) {}
    delete keyHeld[note]
  }
}

function gameLoop() {
  const { root } = $.learn()
  for (const { btn, interval } of NOTE_BTNS) {
    const note = root + interval
    const pressed = checkButton(0, btn)
    if (pressed && !keyHeld[note]) {
      try { current?.triggerAttack(Tone.Frequency(note, "midi").toNote()) } catch(e) {}
      keyHeld[note] = true
    } else if (!pressed && keyHeld[note]) {
      try { current?.triggerRelease(Tone.Frequency(note, "midi").toNote()) } catch(e) {}
      delete keyHeld[note]
    }
  }
  requestAnimationFrame(gameLoop)
}

requestAnimationFrame(gameLoop)

// directional nav: left/right = fourth (±5), up/down = fifth (±7)
// release held notes before moving root so nothing sticks
window.addEventListener('lrud:press', e => {
  const { root } = $.learn()
  const delta = { up: 7, down: -7, right: 5, left: -5 }[e.detail.button]
  if (delta !== undefined) {
    releaseAll()
    $.teach({ root: Math.max(0, Math.min(127, root + delta)) })
  }
})

let current

const instruments = ['piano','bass-electric','bassoon','cello','clarinet','contrabass','flute','french-horn','guitar-acoustic','guitar-electric','guitar-nylon','harmonium','harp','organ','saxophone','trombone','trumpet','tuba','violin','xylophone']

function load(instrument) {
  current = SampleLibrary.load({
    instruments: instrument,
    baseUrl: (self.plan98?.env?.HEAVY_ASSET_CDN_URL || '') + "/cdn/attentionandlearninglab.com/samples/"
  })
  Tone.loaded().then(function() {
    current.release = .5
    current.toDestination()
  }).catch(function() {
    try { current.release = .5; current.toDestination() } catch(e) {}
  })
}

load('piano')

$.when('change', '.samples', event => load(instruments[event.target.value]))
$.when('change', '.notes', event => $.teach({ root: parseInt(event.target.value) }))

const midiCodes = [...new Array(116)].map((_, i) => i)

$.draw(() => {
  const { root } = $.learn()

  const list = instruments.map((name, i) => `<option value="${i}">${name}</option>`).join('')
  const notes = midiCodes.map(n => `<option ${root === n ? 'selected' : ''}>${n}</option>`).join('')

  return `
    <div class="controls">
      <select class="samples">${list}</select>
      <select class="notes">${notes}</select>
      <button data-meander>Unlock</button>
    </div>
    <div class="the-compass">
      <button class="note root"   data-note="${root}">${root}</button>
      <button class="note minus-7" data-note="${root - 7}">${root - 7}</button>
      <button class="note plus-7"  data-note="${root + 7}">${root + 7}</button>
      <button class="note plus-2"  data-note="${root + 2}">${root + 2}</button>
      <button class="note plus-5"  data-note="${root + 5}">${root + 5}</button>
      <button class="note minus-5" data-note="${root - 5}">${root - 5}</button>
      <button class="note minus-2" data-note="${root - 2}">${root - 2}</button>
    </div>
  `
})

$.when('click', '[data-meander]', () => $.teach({ meander: !$.learn().meander }))

const attacking = {}

$.when('pointerdown', '.note', event => {
  event.preventDefault()
  const note = event.target.dataset.note
  if (!current || attacking[note]) return
  try { current.triggerAttack(Tone.Frequency(note, "midi").toNote()) } catch(e) {}
  attacking[note] = true
})

$.when('pointerup', '.note', event => {
  const note = event.target.dataset.note
  if (attacking[note]) delete attacking[note]
  if (!current) return
  try { current.triggerRelease(Tone.Frequency(note, "midi").toNote()) } catch(e) {}
  if ($.learn().meander) $.teach({ root: parseInt(note) })
})

$.style(`
  & {
    display: block;
    height: 100%;
    background: black;
    position: relative;
    padding: 2rem;
  }

  & .the-compass {
    display: grid;
    grid-template-columns: repeat(6, calc(100% / 6));
    grid-template-rows: repeat(6, calc(100% / 6));
    aspect-ratio: 1;
    margin: auto;
    max-height: 100%;
    top: 50%;
    position: relative;
    transform: translateY(-50%);
  }

  & .the-compass button {
    touch-action: manipulation;
    border: none;
    border-radius: 100%;
    color: white;
    background-image: radial-gradient(rgba(0,0,0,1), rgba(0,0,0,1) 25%, rgba(0,0,0,.75) 25%);
  }

  & .the-compass button:hover {
    background-image: radial-gradient(rgba(0,0,0,.5), rgba(0,0,0,.5) 25%, rgba(0,0,0,0) 25%);
  }

  & .the-compass .plus-2  { grid-row: 3/5; grid-column: 5/7; background-color: var(--green); }
  & .the-compass .minus-2 { grid-row: 3/5; grid-column: 1/3; background-color: var(--yellow); }
  & .the-compass .minus-7 { grid-row: 1/3; grid-column: 2/4; background-color: var(--red);    transform: translateY(13%); }
  & .the-compass .plus-7  { grid-row: 1/3; grid-column: 4/6; background-color: var(--orange); transform: translateY(13%); }
  & .the-compass .minus-5 { grid-row: 5/7; grid-column: 2/4; background-color: var(--blue);   transform: translateY(-13%); }
  & .the-compass .plus-5  { grid-row: 5/7; grid-column: 4/6; background-color: var(--purple);  transform: translateY(-13%); }
  & .the-compass .root    { grid-row: 3/5; grid-column: 3/5; background-color: white; color: black; }

  & .controls {
    display: grid;
    grid-template-columns: 1fr auto auto;
    position: absolute;
    gap: .5rem;
    padding: 4px;
    top: 0; left: 0; right: 0;
    z-index: 1;
    height: 2rem;
  }
`)
