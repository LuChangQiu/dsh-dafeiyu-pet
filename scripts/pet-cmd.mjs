// pet-cmd.mjs — send one protocol line to the patched pet's named pipe.
// Usage: node pet-cmd.mjs "<line>" [--read-reply]
// Exit codes: 0 ok (including normal server-side disconnect after write), 2 usage, 3 timeout, 4 connect error.
import net from 'node:net'

const PIPE = '\\\\.\\pipe\\dafeiyu-pet-whale-single-instance'
const line = process.argv[2]
const readReply = process.argv.includes('--read-reply')
if (!line) {
  console.error('usage: node pet-cmd.mjs <line> [--read-reply]')
  process.exit(2)
}

const sock = net.connect(PIPE)
let out = ''
let written = false
let finished = false
const finish = (code, payload) => {
  if (finished) return
  finished = true
  clearTimeout(timer)
  try {
    sock.destroy()
  } catch {}
  console.log(JSON.stringify(payload))
  process.exit(code)
}
const timer = setTimeout(() => finish(3, { ok: false, error: 'timeout', line }), 3000)

sock.on('connect', () => {
  sock.write(line + '\n', () => {
    written = true
  })
})
sock.on('data', (d) => {
  out += d.toString()
})
sock.on('end', () => finish(0, { ok: true, line, written, reply: out.trim() || null }))
sock.on('close', () => finish(0, { ok: true, line, written, reply: out.trim() || null }))
sock.on('error', (e) => {
  // The pet intentionally disconnects right after dispatch; EPIPE after a successful
  // write is the normal path, not a failure.
  if (written || e.code === 'EPIPE') {
    finish(0, { ok: true, line, written, note: 'disconnected-after-write', reply: out.trim() || null })
  } else {
    finish(4, { ok: false, error: e.code || e.message, line })
  }
})
if (!readReply) setTimeout(() => finish(0, { ok: true, line, written, reply: out.trim() || null }), 300)
