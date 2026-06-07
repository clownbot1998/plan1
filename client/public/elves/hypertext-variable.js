import elf from '@plan98/elf'

const defaults = {
  monospace: '0',
  casual: '.5',
  weight: '400',
  slant: '0',
  cursive: '.5',
}
const $ = elf('hypertext-variable')

const variables = ['size', 'height', 'monospace', 'casual', 'weight', 'slant', 'cursive']

$.draw((target) => {
  if (!target.initialized) {
    mount(target, variables)
    target.initialized = true
  }

  const {
    monospace,
    casual,
    weight,
    slant,
    cursive,
    size,
    height
  } = $.learn()[target.id] || defaults

  target.style = `
    --v-font-mono: ${monospace};
    --v-font-casl: ${casual};
    --v-font-wght: ${weight};
    --v-font-slnt: ${slant};
    --v-font-crsv: ${cursive};
    font-variation-settings:
      "MONO" var(--v-font-mono),
      "CASL" var(--v-font-casl),
      "wght" var(--v-font-wght),
      "slnt" var(--v-font-slnt),
      "CRSV" var(--v-font-crsv);
    font-family: 'Recursive';
    ${size   ? `font-size: ${size};`     : ''}
    ${height ? `line-height: ${height};` : ''}
  `

  return target.getAttribute('text')
})

function mount(target, values) {
  requestIdleCallback(() => {
    values.forEach(key => {
      // embed id + key in payload so the reducer is sandbox-safe (no closed-over vars)
      $.teach(
        { _hvId: target.id, _hvKey: key, _hvVal: target.getAttribute(key) || defaults[key] },
        (state, { _hvId, _hvKey, _hvVal }) => ({
          ...state,
          [_hvId]: { ...state[_hvId], [_hvKey]: _hvVal }
        })
      )
    })
  })
}
