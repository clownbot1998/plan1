// lrud-elf.js — gamepad + keyboard → window CustomEvents
// Import for side-effects. Listen: window.addEventListener('lrud:press', e => e.detail.button)
// Buttons: up, down, left, right, a, b

const BUTTON_CODES = { up: 12, down: 13, left: 14, right: 15, a: 0, b: 1 }

const controllers = {}
const prev = {}
for (const b of Object.keys(BUTTON_CODES)) prev[b] = 0

function press(button) {
  window.dispatchEvent(new CustomEvent('lrud:press', { detail: { button } }))
}

function getGamepads() {
  return navigator.getGamepads?.() ?? []
}

let running = false

function loop() {
  const live = getGamepads()
  for (const gp of live) {
    if (gp && gp.index in controllers) controllers[gp.index] = gp
  }

  for (const [name, code] of Object.entries(BUTTON_CODES)) {
    let pressed = 0
    for (const gp of Object.values(controllers)) {
      const btn = gp.buttons[code]
      const val = typeof btn === 'object' ? btn.value : (btn ?? 0)
      if (val > 0.5) { pressed = 1; break }
    }
    if (pressed && !prev[name]) press(name)
    prev[name] = pressed
  }

  requestAnimationFrame(loop)
}

window.addEventListener('gamepadconnected', e => {
  controllers[e.gamepad.index] = e.gamepad
  if (!running) { running = true; requestAnimationFrame(loop) }
})

window.addEventListener('gamepaddisconnected', e => {
  delete controllers[e.gamepad.index]
})

const KEY_BUTTONS = {
  ArrowUp: 'up', w: 'up', W: 'up',
  ArrowDown: 'down', s: 'down', S: 'down',
  ArrowLeft: 'left', a: 'left', A: 'left',
  ArrowRight: 'right', d: 'right', D: 'right',
  j: 'a', J: 'a', Enter: 'a',
  k: 'b', K: 'b', Escape: 'b',
}

const isEditable = el =>
  el.tagName === 'INPUT' ||
  el.tagName === 'TEXTAREA' ||
  el.isContentEditable

window.addEventListener('keydown', e => {
  if (e.repeat) return
  if (isEditable(e.target)) return
  const b = KEY_BUTTONS[e.key]
  if (b) press(b)
})
