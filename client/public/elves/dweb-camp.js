import { Self } from '@plan98/types'
const tag = 'dweb-camp'
const $ = Self(tag)

$.draw(target => `
  <saga-pitch
    src="/sagas/dwebcamp.org/en-us/berlin-2026.saga"
    mode="media"
    style="display:block;width:100%;height:100%;"
  ></saga-pitch>
`)

$.skin(`
  & {
    display: block;
    width: 100%;
    height: 100%;
    background: black;
  }
`)
