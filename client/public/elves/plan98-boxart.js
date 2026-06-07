import elf from '@plan98/elf'

const $ = elf('plan98-boxart')

function countdown(target) {
  if (target.countdown) return
  target.countdown = true
  if (target.getAttribute('diffused') === 'true') {
    $.teach({ diffused: true })
    return
  }
  $.teach({ timer: 15 })
  requestIdleCallback(readyCountdown)
}

function readyCountdown() {
  const { timer } = $.learn()
  const nextTime = timer - 1
  if (nextTime < 0) {
    done()
    return
  }
  setTimeout(() => {
    const { diffused } = $.learn()
    if (diffused) return
    $.teach({ timer: nextTime })
    readyCountdown()
  }, 1000)
}

function done() {
  // signal sticky-menu (or any parent) to close us
  window.parent.postMessage({ type: 'sticky-menu:done' }, '*')
  window.dispatchEvent(new CustomEvent('sticky-menu:done'))
}

$.draw((target) => {
  countdown(target)
  const title    = target.getAttribute('title')    || 'plan1'
  const subtitle = target.getAttribute('subtitle') || 'REBOOT YOUR*ELF'

  if (target.innerHTML) return

  return `
    <div style="display: grid; height: 100%; position: relative;">
      <div name="square">
        <section class="layout">
          <div class="horizon"></div>
          <div class="land">
            <div class="elements"></div>
          </div>
        </section>
        <div class="skybox active">
          <div class="a"></div>
          <div class="c"></div>
          <div class="b"></div>
          <div class="d"></div>
          <div class="e"></div>
          <div class="f">
            <div class="sillyz-avatar">
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 317.296 305.523">
                <g style="transform: translateY(5px)">
                  <g id="ba-keyboard"><path style="fill:var(--wheel-10-3);stroke:var(--wheel-0-4);stroke-width:1px" d="M171.04 333.789s-23.713 47.426-24.264 54.044c-.551 6.618 91.544 18.75 93.75 17.096 2.206-1.655-9.375-67.28-9.375-67.28s-45.22-7.169-60.11-3.86z" transform="translate(-61.285 -131.304)"/><path style="fill:var(--wheel-10-3);stroke:var(--wheel-0-4);stroke-width:1px" d="m241.077 405.48 2.758 8.272s-88.235-3.86-90.993-7.72c-2.757-3.86-9.375-17.647-4.963-17.647s93.198 17.095 93.198 17.095z" transform="translate(-61.285 -131.304)"/></g>
                  <g id="ba-shoes"><path style="fill:rgba(0,0,0,.5);stroke:rgba(0,0,0,.5)" d="M228.022 383.611s-7.799 6.337-21.35 5.85c-13.55-.488-22.129-5.46-22.811-7.41-.683-1.95 4.582-8.676 13.94-14.72 9.36-6.044 11.406-11.211 12.576-14.038s3.217-5.265 5.752-4.972c2.535.292 15.305 0 17.548 2.73 2.242 2.73 3.607 7.214 2.924 14.233-.682 7.019 4.095 7.896-8.579 18.327zM181.131 353.098s10.041-4.68 14.623-5.557c4.582-.877 13.063.341 15.793-3.607 2.73-3.948 2.925-25.25 2.145-26.03-.78-.779-13.843-3.509-18.523-.779s-9.456 11.114-15.5 15.5c-6.044 4.387-15.696 11.796-12.868 16.476 2.827 4.68 13.404 4.68 14.33 3.997z" transform="translate(-61.285 -131.304)"/></g>
                  <g id="ba-pants"><path style="fill:var(--wheel-8-2);stroke:var(--wheel-8-1)" d="M204.43 318.002s-11.015 2.243-13.16-.585c-2.145-2.827-22.325-30.805-25.542-37.045-3.217-6.239-3.607-19.205 8.579-25.151 12.186-5.947 55.958-19.4 55.958-19.4l34.218.39-15.208 31.878s-29.636 9.944-36.168 10.821c-6.532.877-14.72 1.755-14.72 1.755s22.616 19.205 23.201 22.227c.585 3.022.585 9.164-3.217 10.821s-13.94 4.29-13.94 4.29z" transform="translate(-61.285 -131.304)"/><path style="fill:var(--wheel-8-2);stroke:var(--wheel-8-1)" d="m214.719 354.252-4.972-3.022s-2.924-63.27-2.145-73.798c.78-10.529 3.997-17.938 25.542-27.296 21.545-9.36 21.057-8.774 21.057-8.774s15.5-7.702 18.133-11.601c2.632-3.9 18.62-9.164 20.375-8.58 1.755.586 2.144 11.7 3.704 14.04 1.56 2.339 6.044 8.578 3.802 16.182-2.242 7.604-3.607 16.378-16.573 22.714-12.965 6.337-40.944 13.746-40.944 13.746s1.56 53.13.292 56.348c-1.267 3.217-1.754 4.192-7.799 7.701-6.044 3.51-20.472 2.34-20.472 2.34z" transform="translate(-61.285 -131.304)"/></g>
                  <g id="ba-shirt"><path style="fill:var(--wheel-1-3);stroke:var(--wheel-1-1)" d="M170.261 224.96s20.543 18.889 23.99 20.405c3.446 1.517 11.167 7.307 19.715 7.307 8.547 0 17.233-6.204 26.47-8.134 9.237-1.93 26.884-5.101 35.984-3.584 9.099 1.516 21.231 10.202 23.437 8.685 2.206-1.516-1.379-9.375-2.895-14.752-1.517-5.376-3.309-12.546-3.309-12.546s52.803-4.825 55.699-8.272c2.895-3.446 1.93-12.546 4.273-14.476 2.344-1.93 7.445-4.274 7.445-4.274s-46.737-12.408-61.35-12.821c-14.615-.414-28.677.965-40.12-1.241-11.443-2.206-53.217-11.719-63.144-9.513-9.926 2.206-19.439 15.028-35.707 18.888-16.269 3.86-36.26 7.858-44.67 7.583-8.41-.276-27.16 5.928-27.71 9.512-.552 3.585-1.517 11.581-.552 12.408.965.828 11.856 7.445 18.474 8.135 6.618.689 55.01 1.24 63.97-3.31z" transform="translate(-61.285 -131.304)"/></g>
                  <g id="ba-hands"><path style="fill:rgba(255,255,255,.25);stroke:lemonchiffon" d="M353.906 209.972s.414-6.341 3.447-4.687 7.17 6.342 7.17 7.169.275 5.101 0 5.653c-.277.551 2.205 1.654 2.894.275.69-1.378 1.655-2.895 1.655-2.895s0 1.517.827 1.24c.827-.275 3.033-3.721 3.033-3.721l-.69-1.93s.69.827 1.517.827 2.068-3.31 2.068-3.31l2.206-2.205s-1.654-7.445-5.377-8.548c-3.722-1.103-9.65-3.17-13.51-1.379-3.861 1.793-6.343 6.618-7.308 9.513-.965 2.895-.69 8.548.552 9.927 1.24 1.378 2.757 4.825 4.411 4.963 1.655.138 6.756-.276 6.342-1.517-.413-1.24-4.55-1.93-5.928-3.584-1.379-1.655-4.136-2.068-3.309-5.79zM87.684 218.658l1.379-11.443s0 2.206-3.585-.276c-3.585-2.481-12.408-10.753-14.476-11.167-2.068-.414-5.377-.138-5.377-.138l12.96 8.272-12.96-8.685s-4.825-1.655-3.585.827c1.241 2.481 13.236 9.65 13.236 9.65s-9.651-7.306-11.168-5.928c-1.516 1.379-3.722-.69-1.102 2.758 2.619 3.446 9.926 10.891 14.89 13.235 4.962 2.344 9.788 2.895 9.788 2.895z" transform="translate(-61.285 -131.304)"/></g>
                  <g id="ba-hatlid"><path style="fill:var(--wheel-5-3);stroke:var(--wheel-5-1)" d="M147.303 190.002s8.969 1.95 12.186-.878c3.217-2.827 11.698-16.475 11.698-16.475l-8.383-5.752-5.947 9.067-5.85 6.141s-3.801 6.24-3.704 7.897z" transform="translate(-61.285 -131.304)"/></g>
                  <g id="ba-ears"><path style="fill:rgba(255,255,255,.25);stroke:lemonchiffon" d="M168.75 174.209s-2.827-6.337-4.777-5.167c-1.95 1.17-3.704 4.874-2.73 8.091.976 3.218 1.756 9.457 3.413 9.262 1.657-.195 3.704-4.485 3.704-6.142s0-4.777.39-6.044zM207.648 178.01s2.827-5.653 3.022-6.433c.195-.78 1.657-4.485 3.12-3.51 1.462.975 3.996 5.557 2.047 8.677-1.95 3.12-3.315 7.798-4.29 8.091-.975.292-3.997-1.17-3.802-3.12.195-1.95-.097-3.704-.097-3.704z" transform="translate(-61.285 -131.304)"/></g>
                  <g id="ba-head"><path style="fill:rgba(255,255,255,.25);stroke:lemonchiffon" d="M184.348 210.084c-6.239-2.827-11.698-9.164-15.305-17.45-3.607-8.286-6.044-38.897-4.777-42.504 1.267-3.607 10.333-13.649 17.645-14.819 7.312-1.17 18.133.39 26.127 8.19 7.994 7.798 1.462 44.259.682 45.818-.78 1.56-8.384 22.422-24.372 20.765z" transform="translate(-61.285 -131.304)"/></g>
                  <g id="ba-hat"><path style="fill:var(--wheel-5-3);stroke:var(--wheel-5-1)" d="M148.278 188.832s.877-3.997 4.192-7.312c3.314-3.314 10.431-11.99 13.258-15.11 2.827-3.12 4.192-9.651 12.673-12.089 8.482-2.437 9.164-2.827 13.161-2.827s19.79 2.73 19.79 2.73-3.217-18.035-12.283-20.96c-9.067-2.924-20.57-1.072-26.224 2.535-5.655 3.607-13.064 15.5-12.771 18.328.292 2.827.682 9.65-.195 11.6-.877 1.95-1.852 8.677-3.705 10.042-1.852 1.364-7.506 6.921-8.286 9.26-.78 2.34-2.632 7.702.39 3.803z" transform="translate(-60.285 -131.304)"/></g>
                </g>
              </svg>
            </div>
            <div id="foreground">
              <div id="logo">
                <hypertext-variable id="vt1" monospace="0" slant="-15" casual="1" cursive="1" weight="800">
                  ${title}
                </hypertext-variable>
                <hypertext-variable id="vt3" weight="800" monospace="1" slant="0" casual="0" cursive="0">
                  ${subtitle}
                </hypertext-variable>
              </div>
              <div class="game-modes">
                <button class="cta spinning-border" data-start>
                  <span class="cta-inner">Boot</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  `
}, {
  afterUpdate(target) {
    const { timer, diffused } = $.learn()
    const start = target.querySelector('[data-start] .cta-inner')
    if (start) start.innerText = diffused ? 'Boot' : `Boot (${timer})`
  }
})

$.when('click', '[data-start]', done)

// clicking anywhere else stops the countdown
const unbind = $.when('click', '*', () => {
  $.teach({ diffused: true })
  unbind()
})

window.addEventListener('keydown', e => {
  if (e.key === 'Escape') { e.preventDefault(); done() }
})

$.style(`
  & {
    display: block;
    margin: auto;
    height: 100%;
    position: relative;
    overflow: auto;
  }

  & .game-modes {
    display: flex;
    gap: 2rem;
    justify-content: center;
  }

  & .spinning-border {
    position: relative;
    background-color: rgba(0,0,0,.5);
    backdrop-filter: blur(8px);
    -webkit-backdrop-filter: blur(8px);
    border-radius: 10px;
    overflow: hidden;
  }

  & .spinning-border::before {
    content: "";
    position: absolute;
    inset: -100%;
    border-radius: inherit;
    padding: 3px;
    background-clip: content-box;
    mask: linear-gradient(#fff 0 0) content-box, linear-gradient(#fff 0 0);
    -webkit-mask: linear-gradient(#fff 0 0) content-box, linear-gradient(#fff 0 0);
    mask-composite: exclude;
    -webkit-mask-composite: xor;
    pointer-events: none;
  }

  & .spinning-border::after {
    content: "";
    position: absolute;
    inset: -100%;
    background: conic-gradient(
      firebrick, darkorange, gold, mediumseagreen,
      dodgerblue, slateblue, mediumpurple, firebrick
    );
    animation: spin 10000ms linear infinite;
    z-index: -1;
    pointer-events: none;
  }

  @keyframes spin {
    from { transform: rotate(0deg); }
    to   { transform: rotate(360deg); }
  }

  & .cta * { pointer-events: none; }
  & .cta {
    box-shadow: var(--shadow);
    background: linear-gradient(335deg, rgba(0,0,0,.75), rgba(0,0,0,.55));
    color: white;
    border: none;
    border-radius: .5rem;
    gap: .5rem;
    display: inline-grid;
    place-items: center;
    font-weight: bold;
    padding: 4px;
    cursor: pointer;
  }
  & .cta span {
    background: linear-gradient(rgba(0,0,0,.85), rgba(0,0,0,.5));
    border-radius: .5rem;
    font-size: 1.5rem;
    padding: 1rem 1.5rem;
  }

  & [name="square"] {
    margin: auto;
    transform-style: preserve-3d;
    width: 100%;
    aspect-ratio: 1;
    max-width: 100cqmin;
    max-height: 100cqmin;
    place-self: center;
    overflow: hidden;
  }

  & .skybox {
    display: grid;
    grid-template-areas: 'skybox';
    height: 100%;
    margin: 0 auto;
    perspective-origin: center;
    perspective: 1000px;
    position: relative;
    overflow: hidden;
    transform-style: preserve-3d;
    width: 100%;
    z-index: 100;
  }

  & .a, & .b, & .c, & .d, & .e, & .f {
    grid-area: skybox;
    opacity: 0;
    transform: translate(0,0) rotateX(0) rotateY(0) scale(1);
    transition: opacity 200ms;
    overflow: auto;
  }

  & .skybox.active .a { animation: pulse ease-in-out 5000ms alternate infinite; background: linear-gradient(rgba(255,255,255,.45), rgba(0,0,0,.65)), lemonchiffon; transform-origin: top; transform: rotateX(-60deg); opacity: 1; }
  & .skybox.active .b { animation: pulse ease-in-out 5000ms alternate infinite; background: lemonchiffon; box-shadow: 0 0 10px 1px rgba(0,0,0,.25) inset; transform-origin: right; transform: rotateY(-60deg); opacity: 1; }
  & .skybox.active .c { animation: pulse ease-in-out 5000ms alternate infinite; background: linear-gradient(rgba(0,0,0,.15), rgba(0,0,0,.25)), lemonchiffon; transform-origin: bottom; transform: rotateX(60deg); opacity: 1; }
  & .skybox.active .d { animation: pulse ease-in-out 5000ms alternate infinite; background: lemonchiffon; box-shadow: 0 0 10px 1px rgba(0,0,0,.25) inset; transform-origin: left; transform: rotateY(60deg); opacity: 1; }
  & .skybox.active .e { animation: e-scale-out-in ease-in-out 5000ms alternate 1, pulse ease-in-out 5000ms alternate infinite; background: transparent; transform: translateZ(-100vmin) scale(1); opacity: 1; }

  & .f {
    opacity: 1;
    display: grid;
    grid-template-areas: "stack";
    overflow: hidden;
  }
  & .f > * { grid-area: stack; }

  @keyframes e-scale-out-in {
    0%   { opacity: 1;   transform: translateZ(-100vmin) scale(1); }
    50%  { opacity: .25; transform: translateZ(-80vmin) scale(.5); }
    100% { opacity: 1;   transform: translateZ(-100vmin) scale(1); }
  }

  @keyframes pulse {
    0%   { opacity: 1; filter: blur(0px); }
    100% { opacity: 0; filter: blur(10px); }
  }

  & .layout {
    display: grid;
    grid-template-columns: repeat(48, 1fr);
    grid-template-rows: repeat(48, 1fr);
    height: 100%;
    width: 100%;
    position: absolute;
    top: 0; left: 0;
  }

  & .horizon { grid-area: 1 / 1 / -1 / -1; background-size: cover; position: relative; z-index: 1; }

  & .elements {
    background: url('/cdn/tychi.me/photos/james-franklin-hyde.png');
    background-size: contain;
    width: 100%; height: 100%;
    transform: rotateX(60deg) scale(3);
    transform-origin: center;
    position: absolute;
    opacity: .5; inset: 0;
    background-repeat: no-repeat;
    background-position: center;
  }

  & .land {
    grid-area: 30 / 1 / -1 / -1;
    background:
      radial-gradient(var(--wheel-7-1, lemonchiffon) 0%, transparent 100%),
      linear-gradient(var(--wheel-6-2, gold) 0%, var(--wheel-7-3, goldenrod) 10%, var(--wheel-0-3, lemonchiffon) 25%, var(--wheel-1-4, lightyellow) 100%);
    overflow: hidden;
    perspective: 1000px;
    position: relative;
    z-index: 1;
  }

  & .sillyz-avatar {
    grid-area: stack;
    opacity: 0;
    transform: scale(.1);
    animation: fade-in 500ms 1000ms ease-in forwards, fly-in 1000ms 1000ms ease-out forwards;
    width: 75%; height: 75%;
    place-self: center;
  }
  & .sillyz-avatar svg { display: block; width: 100%; height: 100%; }
  & #ba-head, & #ba-hat, & #ba-hatlid, & #ba-ears {
    animation: bob-head 3000ms ease-in-out infinite;
  }
  & #ba-hands, & #ba-shirt, & #ba-pants, & #ba-shoes, & #ba-keyboard {
    animation: bob-body 3000ms ease-in-out infinite;
  }
  @keyframes bob-head {
    0%   { transform: translateY(-5px); }
    50%  { transform: translateY(5px); }
    100% { transform: translateY(-5px); }
  }
  @keyframes bob-body {
    0%   { transform: translateY(-2px); }
    50%  { transform: translateY(2px); }
    100% { transform: translateY(-2px); }
  }

  & #foreground {
    grid-area: stack;
    place-self: center;
    z-index: 1;
    line-height: 1;
    text-align: center;
    transform: scale(.1);
    opacity: 0;
    animation: fade-in 500ms 500ms ease-in forwards, fly-in 1000ms 500ms ease-out forwards;
    color: white;
    text-shadow: 3px 3px black, -1px -1px rgba(0,0,0,.25);
    width: 100%;
  }

  & #logo #vt1 { display: block; font-size: clamp(1rem, 700%, 20vmin); }
  & #logo #vt3 { display: block; font-size: clamp(1rem, 300%, 10vmin); line-height: 1.5; margin: 0 0 1rem 0; }

  @keyframes fade-in {
    0%   { opacity: 0; }
    100% { opacity: 1; }
  }
  @keyframes fly-in {
    0%   { transform: scale(.1) translateY(50vh); }
    100% { transform: scale(1) translateY(0); }
  }
`)
