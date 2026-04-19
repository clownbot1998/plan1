import { showModal, isVisible, hideModal } from './elves/plan98-modal.js'

self.plan98 ||= { env: {} }

const parameters = new URLSearchParams(window.location.search)

self.plan98 = {
  ...self.plan98,
  parameters,
  registry: {}
}

if(parameters.get('debug') === 'true') {
  document.body.insertAdjacentHTML('beforeend', `<plan98-console></plan98-console>`)
  import('./elves/plan98-console.js').catch(console.error)
}

let isRoot = false

function normalMode() {
  isRoot = false
}

self.addEventListener('message', function handleMessage(event) {
  if(event.data.whisper === 'synthia-escape') {
    handleEscapePropagation()
  } else { console.log(event) }
});

window.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') {
    event.preventDefault()
    handleEscapePropagation()
  }
});

function handleEscapePropagation() {
  if(self.self !== self.top) {
    self.parent.postMessage({ whisper: 'synthia-escape' }, "*");
    return
  }

  if(isRoot) return
  if(!isVisible()) {
    isRoot = true
    showModal(`
      <div style="width: 100%; height: 100%; overflow: hidden;">
        <source-code></source-code>
      </div>
    `, { centered: true, onHide: normalMode, blockExit: false })
  } else {
    isRoot = false
    hideModal()
  }
}
