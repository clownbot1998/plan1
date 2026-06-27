#!/usr/bin/env -S deno run --allow-net --allow-read --allow-write --allow-env

/**
 * 9P2000 server for plan1.
 *
 * Backing store: local filesystem (PLAN1_ROOT), with writes propagated to WAS.
 * Eventually: reads can come from WAS too, completing the circus loop.
 *
 * Mount with:
 *   sudo mount -t 9p -o trans=tcp,port=7777,version=9p2000,uname=$USER 127.0.0.1 /mnt/plan1
 * Then:
 *   PLAN1_DIST=/mnt/plan1 deno task serve
 */

const ROOT = (() => {
  const r = Deno.env.get('PLAN1_ROOT')
  if (r) return r.replace(/\/$/, '')
  // default: two levels up from server/9p/ → plan1 root → client/public
  return new URL('../../client/public', import.meta.url).pathname.replace(/\/$/, '')
})()

const PORT   = Number(Deno.env.get('PLAN9_PORT')   || 7777)
const WAS    = Deno.env.get('PLAN98_WAS_HOST')     || 'http://localhost:1088'

// ── 9P2000 message type constants ────────────────────────────────────────────

const Tversion = 100, Rversion = 101
const Tattach  = 104, Rattach  = 105
const Rerror   = 107
const Twalk    = 110, Rwalk    = 111
const Topen    = 112, Ropen    = 113
const Tcreate  = 114, Rcreate  = 115
const Tread    = 116, Rread    = 117
const Twrite   = 118, Rwrite   = 119
const Tclunk   = 120, Rclunk   = 121
const Tremove  = 122, Rremove  = 123
const Tstat    = 124, Rstat    = 125
const Twstat   = 126, Rwstat   = 127

const NOTAG = 0xFFFF
const NOFID = 0xFFFFFFFF
const QTDIR = 0x80
const QTFILE = 0x00

// ── encode helpers ────────────────────────────────────────────────────────────

const enc = new TextEncoder()
const dec = new TextDecoder()

function encStr(s: string): Uint8Array {
  const b = enc.encode(s)
  const out = new Uint8Array(2 + b.length)
  new DataView(out.buffer).setUint16(0, b.length, true)
  out.set(b, 2)
  return out
}

function encQid(type: number, version: number, path: bigint): Uint8Array {
  const out = new Uint8Array(13)
  const dv = new DataView(out.buffer)
  out[0] = type
  dv.setUint32(1, version, true)
  dv.setBigUint64(5, path, true)
  return out
}

function encStat(
  name: string, isDir: boolean, size: number, qid: Uint8Array,
): Uint8Array {
  const nameBuf = encStr(name)
  const uid     = encStr('plan1')
  const gid     = encStr('plan1')
  const muid    = encStr('plan1')

  const mode = isDir ? (0x80000000 | 0o755) : 0o644
  const now  = Math.floor(Date.now() / 1000)

  // stat body (everything except the leading size[2])
  const bodyLen = 2 + 4 + 13 + 4 + 4 + 4 + 8
    + nameBuf.length + uid.length + gid.length + muid.length
  const body = new Uint8Array(bodyLen)
  const dv   = new DataView(body.buffer)
  let off = 0

  dv.setUint16(off, 0, true);                           off += 2   // type (kernel use)
  dv.setUint32(off, 0, true);                           off += 4   // dev  (kernel use)
  body.set(qid, off);                                   off += 13  // qid
  dv.setUint32(off, mode, true);                        off += 4   // mode
  dv.setUint32(off, now, true);                         off += 4   // atime
  dv.setUint32(off, now, true);                         off += 4   // mtime
  dv.setBigUint64(off, BigInt(isDir ? 0 : size), true); off += 8   // length
  body.set(nameBuf, off); off += nameBuf.length
  body.set(uid,     off); off += uid.length
  body.set(gid,     off); off += gid.length
  body.set(muid,    off); off += muid.length

  // prepend size[2] (does NOT count itself, per Plan 9 spec)
  const out = new Uint8Array(2 + bodyLen)
  new DataView(out.buffer).setUint16(0, bodyLen, true)
  out.set(body, 2)
  return out
}

function encMsg(type: number, tag: number, ...parts: Uint8Array[]): Uint8Array {
  const total = 4 + 1 + 2 + parts.reduce((n, p) => n + p.length, 0)
  const out   = new Uint8Array(total)
  const dv    = new DataView(out.buffer)
  dv.setUint32(0, total, true)
  out[4] = type
  dv.setUint16(5, tag, true)
  let off = 7
  for (const p of parts) { out.set(p, off); off += p.length }
  return out
}

function u16(n: number): Uint8Array {
  const b = new Uint8Array(2)
  new DataView(b.buffer).setUint16(0, n, true)
  return b
}

function u32(n: number): Uint8Array {
  const b = new Uint8Array(4)
  new DataView(b.buffer).setUint32(0, n, true)
  return b
}

function u64(n: bigint): Uint8Array {
  const b = new Uint8Array(8)
  new DataView(b.buffer).setBigUint64(0, n, true)
  return b
}

function rerror(tag: number, msg: string): Uint8Array {
  return encMsg(Rerror, tag, encStr(msg))
}

// ── decode helper ─────────────────────────────────────────────────────────────

class Reader {
  private dv: DataView
  private off: number

  constructor(buf: Uint8Array, start = 0) {
    this.dv  = new DataView(buf.buffer, buf.byteOffset, buf.byteLength)
    this.off = start
  }

  u8()  { return this.dv.getUint8(this.off++) }
  u16() { const v = this.dv.getUint16(this.off, true); this.off += 2; return v }
  u32() { const v = this.dv.getUint32(this.off, true); this.off += 4; return v }
  u64() { const v = this.dv.getBigUint64(this.off, true); this.off += 8; return v }

  str() {
    const n = this.u16()
    const s = dec.decode(new Uint8Array(this.dv.buffer, this.dv.byteOffset + this.off, n))
    this.off += n
    return s
  }

  bytes(n: number) {
    const b = new Uint8Array(this.dv.buffer, this.dv.byteOffset + this.off, n)
    this.off += n
    return b
  }
}

// ── path helpers ──────────────────────────────────────────────────────────────

function pathHash(p: string): bigint {
  let h = 0n
  for (const c of p) h = (h * 31n + BigInt(c.charCodeAt(0))) & 0xFFFFFFFFFFFFFFFFn
  return h
}

function realPath(logical: string): string {
  // strip leading slash, collapse .., prevent traversal
  const safe = logical
    .split('/')
    .filter(Boolean)
    .reduce((acc: string[], seg) => {
      if (seg === '..') acc.pop()
      else if (seg !== '.') acc.push(seg)
      return acc
    }, [])
    .join('/')
  return ROOT + '/' + safe
}

async function statLogical(logical: string): Promise<{ isDir: boolean; size: number } | null> {
  try {
    const info = await Deno.stat(realPath(logical))
    return { isDir: info.isDirectory, size: info.size ?? 0 }
  } catch {
    return null
  }
}

// ── WAS propagation ───────────────────────────────────────────────────────────

async function wasPut(logical: string, data: Uint8Array): Promise<void> {
  // fire-and-forget: if WAS is down, the write still lands on disk
  const url = `${WAS}${logical.startsWith('/') ? logical : '/' + logical}`
  fetch(url, { method: 'PUT', body: data }).catch(() => {})
}

// ── per-connection state ──────────────────────────────────────────────────────

interface Fid {
  path:   string
  isDir:  boolean
  opened: boolean
}

// ── protocol dispatch ─────────────────────────────────────────────────────────

async function dispatch(
  type: number, tag: number, r: Reader,
  fids: Map<number, Fid>,
  getMsize: () => number,
  setMsize: (n: number) => void,
): Promise<Uint8Array> {

  switch (type) {

    // ── version ───────────────────────────────────────────────────────────────
    case Tversion: {
      const clientMsize = r.u32()
      const clientVer   = r.str()
      const agreed = Math.min(clientMsize, 65536)
      setMsize(agreed)
      // accept any 9P2000 variant (including 9P2000.L from Linux)
      const ver = clientVer.startsWith('9P2000') ? '9P2000' : 'unknown'
      return encMsg(Rversion, NOTAG, u32(agreed), encStr(ver))
    }

    // ── attach ────────────────────────────────────────────────────────────────
    case Tattach: {
      const fid   = r.u32()
      /* afid */    r.u32()
      /* uname */   r.str()
      /* aname */   r.str()

      fids.set(fid, { path: '/', isDir: true, opened: false })
      const qid = encQid(QTDIR, 0, pathHash('/'))
      return encMsg(Rattach, tag, qid)
    }

    // ── walk ──────────────────────────────────────────────────────────────────
    case Twalk: {
      const fid    = r.u32()
      const newfid = r.u32()
      const nwname = r.u16()
      const names: string[] = []
      for (let i = 0; i < nwname; i++) names.push(r.str())

      const base = fids.get(fid)
      if (!base) return rerror(tag, 'bad fid')

      if (nwname === 0) {
        // clone fid
        fids.set(newfid, { ...base })
        const qid  = encQid(base.isDir ? QTDIR : QTFILE, 0, pathHash(base.path))
        const body = new Uint8Array(2 + 13)
        new DataView(body.buffer).setUint16(0, 1, true)
        body.set(qid, 2)
        return encMsg(Rwalk, tag, body)
      }

      const qids: Uint8Array[] = []
      let cur = base.path

      for (const name of names) {
        if (name === '.') {
          // stay
        } else if (name === '..') {
          const segs = cur.replace(/\/$/, '').split('/')
          segs.pop()
          cur = segs.join('/') || '/'
        } else {
          cur = (cur === '/' ? '' : cur) + '/' + name
        }

        const info = await statLogical(cur)
        if (!info) break
        qids.push(encQid(info.isDir ? QTDIR : QTFILE, 0, pathHash(cur)))
      }

      if (qids.length === names.length) {
        const last = await statLogical(cur)
        fids.set(newfid, { path: cur, isDir: last?.isDir ?? false, opened: false })
      }

      const body = new Uint8Array(2 + qids.length * 13)
      new DataView(body.buffer).setUint16(0, qids.length, true)
      let off = 2
      for (const q of qids) { body.set(q, off); off += 13 }
      return encMsg(Rwalk, tag, body)
    }

    // ── open ──────────────────────────────────────────────────────────────────
    case Topen: {
      const fid  = r.u32()
      /* mode */   r.u8()
      const f = fids.get(fid)
      if (!f) return rerror(tag, 'bad fid')

      const info = await statLogical(f.path)
      if (!info) return rerror(tag, 'file not found')

      f.opened = true
      f.isDir  = info.isDir
      const qt  = info.isDir ? QTDIR : QTFILE
      const qid = encQid(qt, 0, pathHash(f.path))
      const iounit = getMsize() - 24
      return encMsg(Ropen, tag, qid, u32(iounit))
    }

    // ── create ────────────────────────────────────────────────────────────────
    case Tcreate: {
      const fid  = r.u32()
      const name = r.str()
      const perm = r.u32()
      /* mode */   r.u8()

      const f = fids.get(fid)
      if (!f) return rerror(tag, 'bad fid')

      const newPath = (f.path === '/' ? '' : f.path) + '/' + name
      const isDir   = !!(perm & 0x80000000)

      if (isDir) {
        await Deno.mkdir(realPath(newPath), { recursive: true })
      } else {
        const rp = realPath(newPath)
        await Deno.mkdir(rp.slice(0, rp.lastIndexOf('/')), { recursive: true })
        await Deno.writeFile(rp, new Uint8Array(0))
      }

      fids.set(fid, { path: newPath, isDir, opened: true })
      const qt  = isDir ? QTDIR : QTFILE
      const qid = encQid(qt, 0, pathHash(newPath))
      return encMsg(Rcreate, tag, qid, u32(getMsize() - 24))
    }

    // ── read ──────────────────────────────────────────────────────────────────
    case Tread: {
      const fid    = r.u32()
      const offset = r.u64()
      const count  = r.u32()

      const f = fids.get(fid)
      if (!f) return rerror(tag, 'bad fid')

      if (f.isDir) {
        // directory: only serve from offset 0 (9P2000 requirement)
        if (offset > 0n) return encMsg(Rread, tag, u32(0), new Uint8Array(0))

        const rp = realPath(f.path)
        const chunks: Uint8Array[] = []
        let total = 0

        for await (const entry of Deno.readDir(rp)) {
          const childPath = (f.path === '/' ? '' : f.path) + '/' + entry.name
          const info = await statLogical(childPath)
          if (!info) continue
          const qt   = info.isDir ? QTDIR : QTFILE
          const qid  = encQid(qt, 0, pathHash(childPath))
          const stat = encStat(entry.name, info.isDir, info.size, qid)
          if (total + stat.length > count) break
          chunks.push(stat)
          total += stat.length
        }

        const data = new Uint8Array(total)
        let off2 = 0
        for (const c of chunks) { data.set(c, off2); off2 += c.length }
        return encMsg(Rread, tag, u32(data.length), data)

      } else {
        try {
          const data  = await Deno.readFile(realPath(f.path))
          const start = Number(offset)
          const end   = Math.min(start + count, data.length)
          const slice = data.subarray(start, end)
          return encMsg(Rread, tag, u32(slice.length), slice)
        } catch {
          return rerror(tag, 'read error')
        }
      }
    }

    // ── write ─────────────────────────────────────────────────────────────────
    case Twrite: {
      const fid    = r.u32()
      const offset = r.u64()
      const count  = r.u32()
      const data   = r.bytes(count)

      const f = fids.get(fid)
      if (!f) return rerror(tag, 'bad fid')

      const rp  = realPath(f.path)
      const old = await Deno.readFile(rp).catch(() => new Uint8Array(0))
      const end = Number(offset) + count
      const buf = new Uint8Array(Math.max(old.length, end))
      buf.set(old)
      buf.set(data, Number(offset))

      await Deno.writeFile(rp, buf)
      wasPut(f.path, buf)   // fire-and-forget propagation to WAS

      return encMsg(Rwrite, tag, u32(count))
    }

    // ── clunk ─────────────────────────────────────────────────────────────────
    case Tclunk: {
      fids.delete(r.u32())
      return encMsg(Rclunk, tag)
    }

    // ── remove ────────────────────────────────────────────────────────────────
    case Tremove: {
      const fid = r.u32()
      const f   = fids.get(fid)
      if (f) {
        await Deno.remove(realPath(f.path), { recursive: true }).catch(() => {})
        fids.delete(fid)
      }
      return encMsg(Rremove, tag)
    }

    // ── stat ──────────────────────────────────────────────────────────────────
    case Tstat: {
      const fid = r.u32()
      const f   = fids.get(fid)
      if (!f) return rerror(tag, 'bad fid')

      const info = await statLogical(f.path)
      if (!info) return rerror(tag, 'not found')

      const name  = f.path === '/' ? '/' : f.path.split('/').pop()!
      const qt    = info.isDir ? QTDIR : QTFILE
      const qid   = encQid(qt, 0, pathHash(f.path))
      const stat  = encStat(name, info.isDir, info.size, qid)

      // Rstat: nstat[2] stat[nstat]
      const wrap = new Uint8Array(2 + stat.length)
      new DataView(wrap.buffer).setUint16(0, stat.length, true)
      wrap.set(stat, 2)
      return encMsg(Rstat, tag, wrap)
    }

    // ── wstat (ignore) ────────────────────────────────────────────────────────
    case Twstat: {
      r.u32() // fid
      return encMsg(Rwstat, tag)
    }

    default:
      return rerror(tag, `unhandled message type ${type}`)
  }
}

// ── connection handler ────────────────────────────────────────────────────────

async function handleConn(conn: Deno.TcpConn): Promise<void> {
  const fids     = new Map<number, Fid>()
  let   msize    = 8192
  let   pending  = new Uint8Array(0)

  const getMsize = () => msize
  const setMsize = (n: number) => { msize = n }

  try {
    const tmp = new Uint8Array(65536)
    while (true) {
      const n = await conn.read(tmp)
      if (n === null) break

      const next = new Uint8Array(pending.length + n)
      next.set(pending)
      next.set(tmp.subarray(0, n), pending.length)
      pending = next

      while (pending.length >= 4) {
        const msgLen = new DataView(pending.buffer).getUint32(0, true)
        if (pending.length < msgLen) break

        const msg = pending.subarray(0, msgLen)
        pending   = pending.slice(msgLen)

        const r    = new Reader(msg, 4)
        const type = r.u8()
        const tag  = r.u16()

        let reply: Uint8Array
        try {
          reply = await dispatch(type, tag, r, fids, getMsize, setMsize)
        } catch (e) {
          reply = rerror(tag, String(e))
        }

        await conn.write(reply)
      }
    }
  } catch { /* closed */ }
  finally  { try { conn.close() } catch { /* already gone */ } }
}

// ── main ──────────────────────────────────────────────────────────────────────

const listener = Deno.listen({ port: PORT, transport: 'tcp' })

console.log(`9P server  :${PORT}`)
console.log(`root       ${ROOT}`)
console.log(`WAS        ${WAS}`)
console.log()
console.log(`mount:`)
console.log(`  sudo mount -t 9p -o trans=tcp,port=${PORT},version=9p2000,uname=$USER 127.0.0.1 /mnt/plan1`)
console.log()

for await (const conn of listener) {
  handleConn(conn as Deno.TcpConn)
}
