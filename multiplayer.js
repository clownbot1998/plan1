import geckos from '@geckos.io/server'
import http from 'http'
import express from 'express'
import { getQuickJS } from "quickjs-emscripten"
import Holesail from 'holesail'

import createStore from './storage.mjs'

// federation — bridges a geckos room to a peersky-hosted Holesail room of
// the same (elf, id), so a plan1 browser and a peersky Electron instance
// can share one live pot-luck. Deno can't load holesail's native addon
// (confirmed: valid prebuilt binary, plain Node loads it fine, Deno's
// require() shim fails on it regardless) — multiplayer.js already runs as
// a plain Node process for geckos, so it's the natural home for this
// instead of a Deno-side import.
//
// Scope: gated to pot-luck only for now, not every elf — unproven for
// anything else and not worth the risk of a silent behavior change
// elsewhere.
const FEDERATED_ELVES = new Set(['pot-luck'])
const holesailBridges = new Map() // room (`${elf}/${id}`) -> { role, holesail, docPort, doc }

function createFederationDocServer(room, elf, party) {
  const clients = new Set()

  const server = http.createServer((req, res) => {
    if (req.url === '/state' && req.method === 'GET') {
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(JSON.stringify(party.store.get(elf) || {}))
      return
    }

    if (req.url === '/upload' && req.method === 'POST') {
      let body = ''
      req.on('data', (chunk) => { body += chunk })
      req.on('end', () => {
        let payload
        try {
          payload = JSON.parse(body)
        } catch (e) {
          res.writeHead(400, { 'content-type': 'application/json' })
          res.end(JSON.stringify({ error: 'Invalid JSON' }))
          return
        }
        // a peersky peer pushed a patch — apply it to the SAME store geckos
        // peers read/write, then fan it out to both sides: local geckos
        // channels (stateDownload, exactly like a normal stateUpload) and
        // any other Holesail/peersky peers on this doc server.
        try {
          const merge = typeof payload.nuance === 'string' ? payload.nuance : payload.nuance
          party.store.set(elf, payload.knowledge, merge)
        } catch (e) {
          console.error('federation upload merge failed:', e)
        }
        party.channels.forEach((channel) => {
          if (channel) channel.emit('stateDownload', { elf, knowledge: payload.knowledge, serializedNuance: payload.nuance })
        })
        const message = `event: update\ndata: ${JSON.stringify(payload)}\n\n`
        clients.forEach((client) => client.write(message))
        res.writeHead(200, { 'content-type': 'application/json' })
        res.end(JSON.stringify({ ok: true }))
      })
      return
    }

    if (req.url === '/events' && req.method === 'GET') {
      res.writeHead(200, {
        'content-type': 'text/event-stream',
        'cache-control': 'no-cache',
        connection: 'keep-alive'
      })
      res.write(': connected\n\n')
      clients.add(res)
      const keepalive = setInterval(() => res.write(': ping\n\n'), 15000)
      req.on('close', () => {
        clients.delete(res)
        clearInterval(keepalive)
      })
      return
    }

    res.writeHead(404, { 'content-type': 'text/plain' })
    res.end('Not found')
  })

  return { server, clients }
}

function withTimeout(promise, ms, msg) {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error(msg)), ms))
  ])
}

// same deterministic-key derivation as peersky's silly-handler.js — same
// (elf, id) on either side always lands on the identical HyperDHT keypair,
// so whichever side reaches the room first becomes host, no coordination.
async function ensureFederationBridge(room, elf, id, party) {
  if (holesailBridges.has(room)) return holesailBridges.get(room)

  const holesailKey = `silly-room:${elf}:${id}`
  const doc = createFederationDocServer(room, elf, party)
  const docPort = await new Promise((resolve) => {
    doc.server.listen(0, '127.0.0.1', () => resolve(doc.server.address().port))
  })
  const clientTunnelPort = 20000 + Math.floor(Math.random() * 20000)

  let bridge
  try {
    const client = new Holesail({ client: true, secure: true, key: holesailKey, host: '127.0.0.1', port: clientTunnelPort, log: 0 })
    await client.ready()
    await withTimeout(fetch(`http://127.0.0.1:${clientTunnelPort}/state`), 4000, 'no host found')
    doc.server.close()
    bridge = { role: 'client', holesail: client, docPort: clientTunnelPort, doc: null, clients: null }
    console.log(`[federation] joined "${room}" as Holesail client`)
    listenForFederationUpdates(room, elf, party, clientTunnelPort)
  } catch (e) {
    try { await new Holesail({ client: true, secure: true, key: holesailKey, host: '127.0.0.1', port: clientTunnelPort, log: 0 }).close() } catch {}
    const server = new Holesail({ server: true, secure: true, key: holesailKey, host: '127.0.0.1', port: docPort, log: 0 })
    await server.ready()
    bridge = { role: 'server', holesail: server, docPort, doc, clients: doc.clients }
    console.log(`[federation] hosting "${room}" as Holesail server`)
  }

  holesailBridges.set(room, bridge)
  return bridge
}

// when we're the Holesail client (peersky is host), the remote side's
// updates only arrive over its /events SSE stream — Node has no native
// EventSource, so read the stream manually and parse the same `data:` lines.
async function listenForFederationUpdates(room, elf, party, tunnelPort) {
  try {
    const res = await fetch(`http://127.0.0.1:${tunnelPort}/events`)
    const reader = res.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ''
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      const messages = buffer.split('\n\n')
      buffer = messages.pop()
      for (const message of messages) {
        const dataLine = message.split('\n').find((l) => l.startsWith('data: '))
        if (!dataLine) continue
        try {
          const payload = JSON.parse(dataLine.slice('data: '.length))
          if (payload.senderId === 'plan1-relay') continue
          party.store.set(elf, payload.knowledge, payload.nuance)
          party.channels.forEach((channel) => {
            if (channel) channel.emit('stateDownload', { elf, knowledge: payload.knowledge, serializedNuance: payload.nuance })
          })
        } catch (e) {
          console.warn('federation event parse failed:', e.message)
        }
      }
    }
  } catch (e) {
    console.warn(`[federation] events stream for "${room}" ended:`, e.message)
  }
}

// pushes a local geckos-originated update out to any federated peersky peers.
function broadcastToFederation(room, elf, knowledge, serializedNuance) {
  const bridge = holesailBridges.get(room)
  if (!bridge) return
  const payload = { senderId: 'plan1-relay', knowledge, nuance: serializedNuance }
  if (bridge.role === 'server' && bridge.clients) {
    const message = `event: update\ndata: ${JSON.stringify(payload)}\n\n`
    bridge.clients.forEach((client) => client.write(message))
    return
  }
  fetch(`http://127.0.0.1:${bridge.docPort}/upload`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  }).catch((e) => console.warn('federation broadcast failed:', e.message))
}

const PORT = Number(process.env.PLAN1_GECKOS_PORT ?? 9208)

const QuickJS = await getQuickJS()

function secureEval(query, variables = {}) {
  let res
  const vm = QuickJS.newContext()

  for (const [key, value] of Object.entries(variables)) {
    const handle = vm.newString(value)
    vm.setProp(vm.global, key, handle)
    handle.dispose()
  }

  const evaluation = vm.evalCode(query)
  if(evaluation.error) {
    res = {
      error: vm.dump(evaluation.error),
      data: null
    }
    evaluation.error.dispose()
  } else {
    res = {
      error: null,
      data: vm.dump(evaluation.value)
    }
    evaluation.value.dispose()
  }

  vm.dispose()

  return res
}

function notify(namespace, state) {
  //console.log('updated:', { this: this, namespace, state: JSON.stringify(state) })
}

const shortCodes = {};
const rooms = {};
const parties = new Map()
const nicknames = {};
const elves = new Map()

const app = express()
const server = http.createServer(app)
const io = geckos()

function auth(req, res, next) {
  /*
  if (req.method == "PUT" || req.method == "POST" || req.method == "PATCH") {

    if (!req.headers.cookie?.split(/;/).map(x => x.trim()).some(x => x === 'fuzzydoodle')) {
        console.log("Blocked PUT:", { cookie: req.headers.cookie })
        res.statusCode = 401
        return res.end()
    }
  }
  */

  next()
}

app.use(auth)
app.use('/public', express.static('public'))

io.addServer(server)

io.onConnection(channel => {
  let currentRoom = null;
  let currentParty = null;

  channel.on('chat message', data => {
    console.log(`got ${data} from "chat message"`)
    io.room(channel.roomId).emit('chat message', data)
  })

  channel.on('joinRoom', ({ roomName, nickname }) => {
    if (currentRoom) {
      channel.leave(currentRoom);
      if (rooms[currentRoom]) {
        rooms[currentRoom].users = rooms[currentRoom].users.filter(user => user.id !== channel.id);
      }
    }

    currentRoom = roomName;
    channel.join(roomName);

    if (!rooms[roomName]) {
      rooms[roomName] = { messages: [], users: [{
        id: channel.id,
        nickname
      }] };
    } else {
      rooms[roomName].users.push({
        id: channel.id,
        nickname
      });
    }

    if (rooms[roomName].messages) {
      rooms[roomName].messages.forEach(message => {
        channel.emit('chatMessage', message);
      });
    }

    io.room(roomName).emit('userList', rooms[roomName].users);
  });

  channel.on('chatMessage', message => {
    console.log(message, currentRoom, rooms[currentRoom])
    if (currentRoom && rooms[currentRoom]) {
      rooms[currentRoom].messages.push(message);
      io.room(currentRoom).emit('chatMessage', message);
    }
  });

  channel.on('changeNickname', ({oldNickname, newNickname, password }) => {
    if (!nicknames[nickname]) {
      channel.emit('setNickSuccess', {
        nickname: nickname,
        password: crypto.randomUUID()
      });
    }
  });

  channel.on('setNick', nickname => {
    if (!nicknames[nickname]) {
      channel.emit('setNickSuccess', {
        nickname: nickname,
        password: crypto.randomUUID()
      });
    } else {
      channel.emit('setNickError', "Nickname taken");
    }
  });

  /* couch-coop */

  channel.on('joinParty', ({ partyId, slot }) => {
    if (currentParty) {
      channel.leave(currentParty);
      if (parties[currentParty]) {
        parties[currentParty].players = parties[currentParty].players.filter(user => user.id !== channel.id);
      }
    }

    currentParty = partyId;
    channel.join(currentParty);

    if (!parties.has(partyId)) {
      parties.set(partyId, {
        host: null,
        players: new Array(4).fill(null),
        channels: new Array(4).fill(null),
      })
    }

    const party = parties.get(partyId)

    if (slot === 'host') {
      channel.isHost = true
      party.host = channel
    } else {
      channel.slot = slot
      party.players[slot] = {
        id: channel.id,
        gamepad: {}
      }
      party.channels[slot] = channel
    }

    if (party.host) {
      party.host.emit('playerList', party.players)
    }
  });

  channel.on('gamestateUpload', (data) => {
    if(currentParty && parties.has(currentParty)) {
      const party = parties.get(currentParty)
      party.channels.forEach(channel => {
        if(channel) {
          channel.emit('gamestateDownload', data)
        }
      })
    }
  });

  channel.on('gamepadSnapshot', ({ gamepad, slot }) => {
    if(currentParty && parties.has(currentParty)) {
      const party = parties.get(currentParty)
      if (party.host) {
        party.host.emit('gamepadUpdate', { gamepad, slot, id: channel.id })
      }
    }
  });

  channel.on('noteAttack', ({ slot, midiNote }) => {
    if(currentParty && parties.has(currentParty)) {
      const party = parties.get(currentParty)
      if (party.host) {
        party.host.emit('noteAttack', { slot, midiNote })
      }
    }
  });

  channel.on('linkState', ({ elf, id, data }) => {
    const room = `${elf}/${id}`
    channel.join(room);

    if (!elves.has(room)) {
      elves.set(room, {
        channels: [],
        store: createStore(data || {}, notify.bind(room), secureEval)
      })
      if (FEDERATED_ELVES.has(elf)) {
        ensureFederationBridge(room, elf, id, elves.get(room)).catch((e) => console.warn(`[federation] bridge failed for "${room}":`, e.message))
      }
    }

    const party = elves.get(room)

    party.channels.push(channel)

    channel.emit('stateCache', {
      elf,
      id,
      data: party.store.get(elf)
    })
  });

  channel.on('stateUpload', ({ id, data }) => {
    const { elf, knowledge, serializedNuance } = data

    const room = `${elf}/${id}`
    if(elves.has(room)) {
      const party = elves.get(room)
      party.channels.forEach(channel => {
        if(channel) {
          channel.emit('stateDownload', data)
        }
      })

      try {
        const merge = typeof serializedNuance === 'object'
          ? sandbox(serializedNuance, secureEval)
          : serializedNuance

        party.store.set(elf, knowledge, merge)
        if (FEDERATED_ELVES.has(elf)) broadcastToFederation(room, elf, knowledge, serializedNuance)
      } catch(e) {
        console.error('Error processing stateUpload:', e)
      }
    }
  });

  channel.on('disconnect', () => {
    if (currentRoom && rooms[currentRoom]) {
      rooms[currentRoom].users = rooms[currentRoom].users.filter(user => user.id !== channel.id);
      io.room(currentRoom).emit('userList', rooms[currentRoom].users);
    }

    if(currentParty && parties.has(currentParty)) {
      const { isHost, slot } = channel
      const party = parties.get(currentParty)

      if (isHost) {
        party.host = null
      } else {
        party.players[slot] = null
        party.channels[slot] = null
      }

      if (party.host) {
        party.host.emit('playerList', party.players)
      }

      if (!party.host && party.players.every(p => p === null)) {
        parties.delete(currentParty)
      }
    }
  });
});

function sandbox({ mergeHandler, parameters }, secureEval) {
  const mergeHandlerStr = mergeHandler.toString();
  const paramsStr = JSON.stringify(parameters);

  const result = secureEval(`
    '(function(prev, payload) {' +
      ' return (' + ${JSON.stringify(mergeHandlerStr)} + ')' +
      ' .apply(null, ' + paramStr + ')' +
      ' (prev, payload);' +
    '})';
  `, {
    paramStr: paramsStr,
  });

  if (result.error) {
    console.error('Failed to create merge function:', result.error);
    console.error('Handler:', mergeHandlerStr);
    console.error('Params:', parameters);
    return false;
  }

  console.log('Server generated merge function:', result.data);
  return result.data;
}

console.log(`multiplayer relay :${PORT}`)
server.listen(PORT)
