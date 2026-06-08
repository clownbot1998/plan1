import { Self, Saga } from '@plan98/types'
import { showModal } from './plan98-modal.js'

const tag = 'saga-crawler'
const $ = Self(tag)

const DEFAULT_SRC = '/cdn/sillyz.computer/en-us/saga-crawler.saga'

function crawlerTemplate(html) {
  return `
    <div style="display: grid; height: 100%; position: relative;">
      <div name="square">
        <div class="skybox active">
          <div class="c scroller-area">
            ${html}
          </div>
          <div class="f">
            <div>
              <button data-edit class="branded-button">edit</button>
            </div>
          </div>
        </div>
      </div>

      <button data-skip class="branded-button">
        Skip Intro
      </button>
    </div>
  `
}

$.draw(() => null, {
  beforeUpdate(target) {
    if(target.initialized) return
    target.initialized = true
    const src = target.getAttribute('src') || DEFAULT_SRC
    const encodedData = target.getAttribute('data')
    const next = target.getAttribute('next') || '/'

    requestIdleCallback(() => {
      if(encodedData) {
        const file = atob(decodeURIComponent(encodedData))
        const screenplay = Saga(file)
        if(typeof screenplay === 'string') {
          target.innerHTML = crawlerTemplate(screenplay)
        }
      } else {
        let file = ''
        fetch(src).then(async res => {
          if(res.status === 404) {
            file = 'untitled'
          } else {
            file = await res.text()
          }
        }).catch((error) => {
          console.error(error)
        }).finally(() => {
          try {
            const screenplay = Saga(file)
            if(typeof screenplay === 'string') {
              target.innerHTML = crawlerTemplate(screenplay)
            }
          } catch(e) {
            target.innerHTML = e.message
          }
        })
      }
    })
  }
})

function go(event) {
  const next = event.target.closest(tag).getAttribute('next') || '/'
  window.top.location.href = next
}

$.when('click', '[data-skip]', go)
$.when('animationend', 'xml-html', go)

$.when('click', '[data-edit]', event => {
  const src = event.target.closest(tag).getAttribute('src') || DEFAULT_SRC
  showModal(`<div style="background:black;padding-top:2rem;height:100%;box-sizing:border-box;"><lore-baby src="${src}" style="display:block;width:100%;height:100%;"></lore-baby></div>`, {
    blockExit: false
  })
})

$.style(`
  & xml-html {
    display: flex;
    flex-direction: column;
    gap: 1rem;

    animation: &-crawler 30000ms linear forwards;
  }

  @keyframes &-crawler {
    0% {
      transform: translateY(100%);
    }

    100% {
      transform: translateY(0%);
    }
  }

  & xml-html > * {
    width: 100%;
  }
  & {
    display: block;
    margin: auto;
    height: 100%;
    position: relative;
    overflow: auto;
  }

  &:not([data-started="true"])::before {
    content: '';
    background-image: linear-gradient(-25deg, rgba(0,0,0,1), rgba(0,0,0,.85));
    position: absolute;
    inset: 0;
  }

  & .scroller-area {
    font-size: 2rem;
  }

  & .skybox.active .a,
  & .skybox.active .b,
  & .skybox.active .c,
  & .skybox.active .d,
  & .skybox.active .e {
   opacity: 1;
  }

  & .skybox.active .a > *,
  & .skybox.active .b > *,
  & .skybox.active .c > *,
  & .skybox.active .d > *,
  & .skybox.active .e > * {
    position: absolute;
    inset: 0;
  }

 & .skybox {
   display: grid;
   grid-area: letterbox;
   grid-template-areas: 'skybox';
   height: 100%;
   margin: 0 auto;
   perspective-origin: center;
   perspective: 500px;
   position: relative;
   transform-style: preserve-3d;
   width: 100%;
   z-index: 100;
   color: gold;
   font-weight: 600;
 }

 & .a, & .b, & .c, & .d, & .e, & .f {
   grid-area: skybox;
   opacity: 0;
   transform: translate(0, 0) rotateX(0) rotateY(0) scale(1);
   transition: opacity 200ms;
   overflow: auto;
 }

 & .skybox.active .a {
   animation: pulse ease-in-out 5000ms alternate infinite;
   background: linear-gradient(rgba(255,255,255,.45), rgba(0,0,0,.65)), lemonchiffon;
   transform-origin: top;
   transform: rotateX(-60deg) translate(0, 0);
 }

 & .skybox.active .b {
   animation: pulse ease-in-out 5000ms alternate infinite;
   background: lemonchiffon;
   box-shadow: 0 0 10px 1px rgba(0,0,0,.25) inset;
   transform-origin: right;
   transform: rotateY(-60deg) translate(0, 0);
 }

 & .skybox.active .c {
   animation: pulse ease-in-out 5000ms alternate infinite;
   transform-origin: bottom;
   transform: rotateX(60deg) translate(0, 0);
 }

 & .skybox.active .d {
   animation: pulse ease-in-out 5000ms alternate infinite;
   background: lemonchiffon;
   box-shadow: 0 0 10px 1px rgba(0,0,0,.25) inset;
   transform-origin: left;
   transform: rotateY(60deg) translate(0, 0);
 }

 & .skybox.active .e {
   animation:
    e-scale-out-in ease-in-out 5000ms alternate 1,
    pulse ease-in-out 5000ms alternate infinite;
   background: transparent;
   transform: translateZ(-100vmin) scale(1);
   opacity: 1;
 }

 & .f {
   opacity: 1;
   display: grid;
   grid-template-areas: "stack";
   overflow: hidden;
   pointer-events: none;
 }

 & .f > * {
  grid-area: stack;
 }

  & [data-edit] {
    pointer-events: all;
    align-self: start;
    justify-self: start;
    animation: &-fade-up 1000ms forwards 2000ms;
    opacity: 0;
    transform: translateY(100%);
  }

  & [data-skip] {
    animation: &-fade-up 1000ms forwards 2000ms;
    position: absolute;
    bottom: 2rem;
    right: 2rem;
    z-index: 200;
    opacity: 0;
    transform: translateY(100%);
  }

  @keyframes &-fade-up {
    0% {
      opacity: 0;
      transform: translateY(100%);
    }

    100% {
      opacity: 1;
      transform: translateY(0);
    }
  }
`)
