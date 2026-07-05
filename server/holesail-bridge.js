// holesail-bridge.js — plan1 joins a peersky-hosted Holesail room as a
// client, and proxies that tunnel's HTTP/SSE API back to the browser at
// /holesail/<app>/*. peersky stays the host; plan1 is just another peer.

import Holesail from 'npm:holesail@^2.4.1';

const sessions = new Map(); // app name -> { key, client, port }

async function joinRoom(app, key) {
  const existing = sessions.get(app);
  if (existing && existing.key === key) return existing;
  if (existing) {
    try { await existing.client.close() } catch {}
    sessions.delete(app);
  }
  const client = new Holesail({ client: true, key, host: '127.0.0.1', log: 1 });
  await client.ready();
  const port = client.info?.port;
  const session = { key, client, port };
  sessions.set(app, session);
  return session;
}

async function closeRoom(app) {
  const session = sessions.get(app);
  if (!session) return false;
  try { await session.client.close() } catch {}
  sessions.delete(app);
  return true;
}

// GET/POST proxy — mirrors the request straight through to the tunnel's
// local HTTP server (127.0.0.1:<port>), which is peersky's pot-luck-handler.js
// doc server on the other end of the DHT hole-punch.
async function proxy(session, subpath, request) {
  const target = `http://127.0.0.1:${session.port}${subpath}`;
  const init = { method: request.method, headers: {} };
  const contentType = request.headers.get('content-type');
  if (contentType) init.headers['content-type'] = contentType;
  if (request.method === 'POST') init.body = await request.text();
  return fetch(target, init);
}

// SSE proxy — streams the tunnel's /events response straight through so
// EventSource on the browser side sees the same live updates peersky peers do.
async function proxyEvents(session) {
  const upstream = await fetch(`http://127.0.0.1:${session.port}/events`);
  return new Response(upstream.body, {
    status: upstream.status,
    headers: {
      'content-type': 'text/event-stream',
      'cache-control': 'no-cache',
      connection: 'keep-alive',
    },
  });
}

// Handles /holesail/<app>/* — join, close, and proxied doc/events.
// Returns null if the path isn't ours, so server.js can fall through.
export async function handleHolesailBridge(request, path) {
  if (!path.startsWith('/holesail/')) return null;
  const parts = path.slice('/holesail/'.length).split('/');
  const app = parts[0];
  const rest = '/' + parts.slice(1).join('/');
  if (!app) return new Response('Missing app name', { status: 400 });

  if (rest === '/join' && request.method === 'POST') {
    try {
      const { key } = await request.json();
      if (!key) return new Response(JSON.stringify({ error: 'Missing key' }), { status: 400, headers: { 'content-type': 'application/json' } });
      const session = await joinRoom(app, key);
      return new Response(JSON.stringify({ ok: true, key: session.key }), { headers: { 'content-type': 'application/json' } });
    } catch (err) {
      return new Response(JSON.stringify({ error: String(err.message || err) }), { status: 500, headers: { 'content-type': 'application/json' } });
    }
  }

  if (rest === '/close' && request.method === 'POST') {
    const ok = await closeRoom(app);
    return new Response(JSON.stringify({ ok }), { headers: { 'content-type': 'application/json' } });
  }

  const session = sessions.get(app);
  if (!session) return new Response(JSON.stringify({ error: 'Not joined to a room for this app yet' }), { status: 409, headers: { 'content-type': 'application/json' } });

  if (rest === '/events' && request.method === 'GET') {
    return proxyEvents(session);
  }

  if (rest === '/doc') {
    return proxy(session, '/doc', request);
  }

  return new Response('Not found', { status: 404 });
}
