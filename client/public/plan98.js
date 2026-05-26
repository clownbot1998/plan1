import diffHTML from 'diffhtml'
import { getQuickJS } from "quickjs-emscripten"
export let channel = null
let _peerReady = false
const _pendingSubs = []
const _elfRooms = {}

function _connect(fn) {
  if (_peerReady) { fn(); return }
  _pendingSubs.push(fn)
}

// Dynamic import keeps geckos off the critical module-load path —
// a failed import or init cannot break plan98.js firmware.
import('@geckos.io/client').then(({ default: geckos }) => {
  const _geckosConfig = plan98?.env?.PLAN98_REALTIME
    ? { url: plan98.env.PLAN98_REALTIME, port: 443 }
    : { port: 9208 }
  channel = geckos(_geckosConfig)
  channel.onConnect(error => {
    if (error) { console.warn('geckos:', error.message); return }
    _peerReady = true
    _pendingSubs.forEach(fn => fn())
    _pendingSubs.length = 0
    channel.on('stateCache', ({ elf, data }) => {
      if (data) store.set(elf, data, '(state, payload) => ({ ...state, ...payload })')
    })
    channel.on('stateDownload', (data) => {
      if (!data?.elf) return
      const { __plan98_sender_id, elf, knowledge, serializedNuance } = data
      if (__plan98_sender_id === PLAN98_NODE_ID) return
      const merge = typeof serializedNuance === 'object'
        ? _sandbox(serializedNuance)
        : serializedNuance
      if (merge) store.set(elf, knowledge, merge, { bypassSecurity: serializedNuance?.bypassSecurity })
    })
  })
}).catch(e => {
  console.warn('geckos unavailable, running without multiplayer:', e.message)
})

function _sandbox({ mergeHandler, parameters, bypassSecurity = false }) {
  const mergeHandlerStr = mergeHandler.toString()
  const paramsStr = JSON.stringify(parameters)
  const result = secureEval(`
    '(' + ${JSON.stringify(mergeHandlerStr)} + ')' +
      '.apply(null, ' + paramStr + ')';
  `, { paramStr: paramsStr }, { bypassSecurity })
  if (result.error) { console.error('sandbox:', result.error); return false }
  return result.data
}

function _udpUpload(elf, knowledge) {
  if (!_peerReady || !channel) return
  const id = _elfRooms[elf]
  if (!id) return
  channel.emit('stateUpload', {
    id,
    data: {
      __plan98_sender_id: PLAN98_NODE_ID,
      elf,
      knowledge: knowledge ?? store.get(elf),
      serializedNuance: '(state, payload) => ({ ...state, ...payload })',
    }
  })
}

const logs = {}
const store = createStore({}, notify)

// Pass an explicit knowledge slice to avoid syncing local-only UI state (whisper pattern).
export function broadcastElf(elf, knowledge) { _udpUpload(elf, knowledge) }

let QuickJS = null;
const queue = [];

getQuickJS().then(instance => {
  QuickJS = instance;
  queue.forEach(fn => fn());
  queue.length = 0;

  try {
    watch()
  } catch(e) {
    setTimeout(watch,1000)
  }
});

function secureEval(query, variables, options = {}) {
  const {
    bypassSecurity=false,
    saneWasher = (x) => x
  } = options

  if(bypassSecurity) {
    try {
      const paramNames = Object.keys(variables);
      const paramValues = Object.values(variables);
      const fn = new Function(...paramNames, `return (${query})`);
      const result = fn(...paramValues);
      const washedResult = saneWasher(result);
      return { error: null, data: washedResult };
    } catch (error) {
      return { error: error.message, data: null };
    }
  }

  let res
  const vm = QuickJS.newContext()

  for (const [key, value] of Object.entries(variables)) {
    const handle = vm.newString(value)
    vm.setProp(vm.global, key, handle)
    handle.dispose()
  }

  const evaluation = vm.evalCode(query)
  if(evaluation.error) {
    res = { error: vm.dump(evaluation.error), data: null }
    evaluation.error.dispose()
  } else {
    res = { error: null, data: saneWasher(vm.dump(evaluation.value)) }
    evaluation.value.dispose()
  }

  vm.dispose()
  return res
}

let PLAN98_NODE_ID
try {
  PLAN98_NODE_ID = self.crypto.randomUUID()
} catch(e) {
  PLAN98_NODE_ID = uuidv4()
}

export function insights() {
  return logs
}

function insight(name, elf) {
  if(!logs[`${name}:${elf}`]) {
    logs[`${name}:${elf}`] = 0
  }
  logs[`${name}:${elf}`] += 1
}

const CREATE_EVENT = 'create'
const observableEvents = [CREATE_EVENT]
const reactiveFunctions = {}

function react(elf) {
  if(!reactiveFunctions[elf]) return
  Object.keys(reactiveFunctions[elf])
    .map(id => reactiveFunctions[elf][id]())
}

const notifications = {
  [react.toString()]: react
}

function notify(elf) {
  Object.keys(notifications)
    .map(key => notifications[key](elf))
}

function update(elf, target, compositor, lifeCycle={}) {
  insight('plan98:update', elf)
  if(lifeCycle.beforeUpdate) lifeCycle.beforeUpdate.call(this, target)
  const html = compositor.call(this, target)
  if(html) diffHTML.innerHTML(target, html)
  if(lifeCycle.afterUpdate) lifeCycle.afterUpdate.call(this, target)
}

const middleware = []

function draw(elf, compositor, lifeCycle={}) {
  insight('plan98:draw', elf)
  if(!reactiveFunctions[elf]) reactiveFunctions[elf] = {}

  listen(CREATE_EVENT, elf, (event) => {
    if(lifeCycle.onCreate) lifeCycle.onCreate.call(this, event.target)
    middleware.forEach(x => x(elf, event.target))
    const draw = update.bind(this, elf, event.target, compositor, lifeCycle)
    reactiveFunctions[elf][event.target.id] = draw
    draw()
  })
}

function style(elf, stylesheet) {
  insight('plan98:style', elf)
  const styles = `
    <style type="text/css" data-elf="${elf}">
      ${stylesheet.replaceAll('&', elf)}
    </style>
  `;
  document.body.insertAdjacentHTML("beforeend", styles)
}

export function learn(elf) {
  insight('plan98:learn', elf)
  return store.get(elf) || {}
}

export function teach(elf, knowledge, nuance = (s, p) => ({...s,...p})) {
  insight('plan98:teach', elf)
  store.set(elf, knowledge, nuance)
}

export function when(elf, type, arg2, callback) {
  if(typeof arg2 === 'function') {
    insight('plan98:when:'+type, elf)
    return listen.call(this, type, elf, arg2)
  } else {
    const nested = `${elf} ${arg2}`
    insight('plan98:when:'+type, nested)
    return listen.call(this, type, nested, callback)
  }
}

export default function Self(elf, initialState = {}) {
  insight('plan98', elf)
  teach(elf, initialState)

  return {
    m: learn.bind(this, elf),
    v: draw.bind(this, elf),
    c: teach.bind(this, elf),
    e: when.bind(this, elf),
    s: style.bind(this, elf),

    link: elf, elf, table: elf, root: elf, tag: elf, selector: elf, body: elf,

    ear: learn.bind(this, elf),
    learn: learn.bind(this, elf),
    get: learn.bind(this, elf),
    read: learn.bind(this, elf),
    model: learn.bind(this, elf),
    object: learn.bind(this, elf),
    subject: learn.bind(this, elf),
    predicate: learn.bind(this, elf),

    head: draw.bind(this, elf),
    draw: draw.bind(this, elf),
    render: draw.bind(this, elf),
    view: draw.bind(this, elf),

    eye: style.bind(this, elf),
    style: style.bind(this, elf),
    flair: style.bind(this, elf),
    skin: style.bind(this, elf),
    fashion: style.bind(this, elf),

    hand: when.bind(this, elf),
    when: when.bind(this, elf),
    on: when.bind(this, elf),
    listen: when.bind(this, elf),

    mouth: teach.bind(this, elf),
    teach: teach.bind(this, elf),
    set: teach.bind(this, elf),
    write: teach.bind(this, elf),
    update: teach.bind(this, elf),
    put: teach.bind(this, elf),
    post: teach.bind(this, elf),
    patch: teach.bind(this, elf),
    delete: teach.bind(this, elf),
    controller: teach.bind(this, elf),

    whisper: teach.bind({ __PLAN98_OFFLINE_ONLY: true }, elf)
  }
}

export function subscribe(fun) {
  notifications[fun.toString] = fun
}

export function unsubscribe(fun) {
  if(notifications[fun.toString]) delete notifications[fun.toString]
}

export function listen(type, elf, handler = () => null) {
  const callback = (event) => {
    if(event.target && event.target.matches && event.target.matches(elf)) {
      insight('plan98:listen:'+type, elf)
      handler.call(this, event);
    }
  };

  const options = { capture: true, passive: false }
  document.addEventListener(type, callback, options);

  if(observableEvents.includes(type)) observe(elf);

  return function unlisten() {
    if(type === CREATE_EVENT) disregard(elf);
    document.removeEventListener(type, callback, options);
  }
}

let elves = []

function observe(elf) {
  if (!QuickJS) {
    queue.push(() => observe(elf));
    return;
  }
  elves = [...new Set([...elves, elf])];
  maybeCreateReactive([...document.querySelectorAll(elf)])
}

function disregard(elf) {
  const index = elves.indexOf(elf);
  if(index >= 0) elves = [...elves.slice(0, index), ...elves.slice(index + 1)];
}

function maybeCreateReactive(targets) {
  targets.filter(x => !x.reactive).forEach(dispatchCreate)
}

function getSubscribers({ target }) {
  if(elves.length > 0)
    return [...target.querySelectorAll(elves.join(', '))];
  else
    return []
}

function dispatchCreate(target) {
  insight('plan98:create', target.localName)
  try {
    if(!target.id) target.id = self.crypto.randomUUID()
  } catch(e) {
    if(!target.id) target.id = uuidv4()
  }
  target.dispatchEvent(new Event(CREATE_EVENT))
  target.reactive = true
}

function watch() {
  new MutationObserver((mutationsList) => {
    const targets = [...mutationsList]
      .map(getSubscribers)
      .flatMap(x => x)
    maybeCreateReactive(targets)
  }).observe(document.body, { childList: true, subtree: true });
}

function createStore(initialState = {}, broadcast = () => null) {
  let state = { ...initialState };

  return {
    set: function(elf, knowledge, nuance, options={ bypassSecurity: false }) {
      if (!QuickJS) {
        if (typeof nuance === 'function') {
          state = { ...state, [elf]: nuance(state[elf] || {}, knowledge) }
          broadcast(elf)
        } else {
          queue.push(() => this.set(elf, knowledge, nuance, options));
        }
        return;
      }

      let mergeStr;
      if (typeof nuance === 'function') {
        mergeStr = nuance.toString();
      } else if (typeof nuance === 'string') {
        mergeStr = nuance;
      } else {
        console.error('object merge not supported in offline mode');
        return;
      }

      const wisdom = secureEval(`
        const localState = JSON.parse(stateStr);
        const knowledge = JSON.parse(knowledgeStr);
        const merge = (0, ${mergeStr});
        const output = merge(localState || {}, knowledge);
        JSON.stringify({ output });
      `, {
        stateStr: JSON.stringify(state[elf] || {}),
        knowledgeStr: JSON.stringify(knowledge),
      }, {
        bypassSecurity: options.bypassSecurity
      });

      if (wisdom.error) {
        throw new Error(`Sandboxed execution failed: ${JSON.stringify(wisdom.error)}`);
      } else {
        state = { ...state, [elf]: JSON.parse(wisdom.data).output };
        broadcast(elf);
      }
    },

    get: function(elf) {
      return state[elf];
    }
  }
}

export function linkState(elf, id) {
  _elfRooms[elf] = id
  if (!channel) return
  _connect(() => {
    channel.emit('linkState', { elf, id, data: store.get(elf) })
  })
}

function uuidv4() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
    const r = Math.random() * 16 | 0;
    const v = c === 'x' ? r : (r & 0x3 | 0x8);
    return v.toString(16);
  });
}
