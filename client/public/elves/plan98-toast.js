import elf from '@silly/elf'

const $ = elf('plan98-toast', { order: [] })

export default $

// action callbacks keyed by toast id — not stored in elf state (functions aren't serializable)
const _callbacks = new Map()

$.draw((target) => {
  const { order } = $.learn()
  if (!order.length) { target.innerHTML = ''; return }

  return order.map((id) => {
    const t = $.learn()[id]
    if (!t) return ''

    if (t.actionLabels?.length) {
      return `
        <div class="toast-message with-actions ${t.type || ''}" data-toast-id="${id}">
          <span class="toast-body">${t.body}</span>
          <div class="toast-actions">
            ${t.actionLabels.map((label, i) =>
              `<button class="toast-action-btn" data-toast-id="${id}" data-action-idx="${i}">${label}</button>`
            ).join('')}
            <button class="toast-dismiss-btn" data-close="${id}">dismiss</button>
          </div>
        </div>
      `
    }

    return `
      <button class="toast-message standard-button -soft ${t.type || ''}" key="${id}" data-close="${id}">
        ${t.body}
      </button>
    `
  }).join('')
}, {afterUpdate})

function afterUpdate(target) {
  [...target.querySelectorAll('sl-icon')].forEach(ogIcon => {
    const icon = document.createElement('sl-icon')
    icon.name = ogIcon.name
    ogIcon.parentNode.replaceChild(icon, ogIcon)
  })
  target.scrollTop = target.scrollHeight
}

$.when('click', '[data-close]', (event) => {
  const id = event.target.closest('[data-close]')?.dataset.close
  if (id) { untoast(id); _callbacks.delete(id) }
})

$.when('click', '[data-action-idx]', (event) => {
  const btn = event.target.closest('[data-action-idx]')
  if (!btn) return
  const { toastId, actionIdx } = btn.dataset
  const cbs = _callbacks.get(toastId)
  if (cbs?.[parseInt(actionIdx)]) cbs[parseInt(actionIdx)]()
  untoast(toastId)
  _callbacks.delete(toastId)
})

const toastContainer = document.createElement('plan98-toast')
document.body.appendChild(toastContainer)

export function toast(body, options = {}) {
  const id = self.crypto.randomUUID()
  const { actions, type } = options

  if (actions?.length) {
    _callbacks.set(id, actions.map(a => a.callback))
  }

  $.teach({
    id,
    [id]: {
      body,
      type: type || '',
      actionLabels: actions?.map(a => a.label) || [],
    }
  }, (state, payload) => ({
    ...state,
    order: [...state.order, payload.id],
    [payload.id]: payload[payload.id]
  }))

  setTimeout(() => { untoast(id); _callbacks.delete(id) }, 10000)
  return id
}

export function untoast(id) {
  $.teach({ id }, (state, p) => {
    const next = { ...state }
    next.order = next.order.filter(x => x !== p.id)
    delete next[p.id]
    return next
  })
}

$.style(`
  & {
    position: fixed;
    top: 4px;
    left: 0; right: 0;
    width: 300px;
    max-width: calc(100vw - 2rem);
    margin: auto;
    z-index: 9000;
    overflow: auto;
    max-height: 100vh;
    display: flex;
    flex-direction: column-reverse;
    gap: .5rem;
    pointer-events: none;
  }

  & .toast-message { pointer-events: all; }

  & .toast-message.standard-button {
    border-radius: 0;
    width: 100%;
  }

  & .toast-message.success { --toast-color: mediumseagreen; --root-theme: mediumseagreen; }
  & .toast-message.error   { --toast-color: firebrick;      --root-theme: firebrick; }
  & .toast-message.warn    { --toast-color: gold;           --root-theme: gold; }
  & .toast-message.info    { --toast-color: dodgerblue;     --root-theme: dodgerblue; }

  & .toast-message.with-actions {
    display: flex; flex-direction: column;
    padding: .55rem .65rem;
    border-radius: 4px;
    background: #1d2021;
    border: 1px solid #3c3836;
    box-shadow: 0 2px 12px rgba(0,0,0,.5);
  }
  & .toast-message.with-actions.success { border-left: 3px solid mediumseagreen; }
  & .toast-message.with-actions.error   { border-left: 3px solid firebrick; }
  & .toast-message.with-actions.warn    { border-left: 3px solid gold; }
  & .toast-message.with-actions.info    { border-left: 3px solid dodgerblue; }

  & .toast-body {
    font-size: .7rem; color: #ebdbb2;
    font-family: 'Recursive', sans-serif;
    line-height: 1.4;
  }

  & .toast-actions {
    display: flex; gap: .35rem; margin-top: .45rem;
  }

  & .toast-action-btn {
    background: rgba(215,153,33,.12); border: 1px solid #d79921; color: #fabd2f;
    font-family: 'Recursive', sans-serif; font-size: .6rem;
    padding: .2rem .55rem; border-radius: 2px; cursor: pointer;
    transition: background 80ms;
  }
  & .toast-action-btn:hover { background: rgba(215,153,33,.28); }

  & .toast-dismiss-btn {
    background: transparent; border: 1px solid #504945; color: #665c54;
    font-family: 'Recursive', sans-serif; font-size: .6rem;
    padding: .2rem .55rem; border-radius: 2px; cursor: pointer;
    transition: all 80ms;
  }
  & .toast-dismiss-btn:hover { color: #a89984; border-color: #928374; }
`)
