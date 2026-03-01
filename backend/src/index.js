'use strict';

const http     = require('http');
const express  = require('express');
const pty      = require('node-pty');
const { WebSocketServer } = require('ws');
const { URL }  = require('url');
const sandbox  = require('./sandbox/docker');
const sessions = require('./session/manager');

const app  = express();
const PORT = process.env.PORT || 3000;

// ── Middleware ────────────────────────────────────────────────────────────────
app.use(express.json());

app.use((req, _res, next) => {
  console.log(`${req.method} ${req.url}`);
  next();
});

// ── REST Routes ───────────────────────────────────────────────────────────────
app.use('/api/exercises', require('./routes/exercises'));
app.use('/api/session',   require('./routes/session'));
app.use('/api/setup',     require('./routes/setup'));
app.use('/api/reset',     require('./routes/reset'));
app.use('/api/check',     require('./routes/check'));

app.get('/healthz', (_req, res) => res.json({ ok: true }));

// ── HTTP Server ───────────────────────────────────────────────────────────────
const server = http.createServer(app);

// ── WebSocket Terminal ────────────────────────────────────────────────────────
const wss = new WebSocketServer({ noServer: true });

server.on('upgrade', (req, socket, head) => {
  const { pathname } = new URL(req.url, 'http://localhost');
  if (pathname === '/terminal') {
    wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req));
  } else {
    socket.destroy();
  }
});

wss.on('connection', (ws, req) => {
  const { searchParams } = new URL(req.url, 'http://localhost');
  const userId = searchParams.get('userId');
  const cols   = Math.max(40,  parseInt(searchParams.get('cols') ?? '220', 10) || 220);
  const rows   = Math.max(10,  parseInt(searchParams.get('rows') ?? '50',  10) || 50);

  if (!userId) {
    ws.close(1008, 'userId required');
    return;
  }

  const session = sessions.get(userId);
  if (!session || session.status !== 'ready') {
    ws.close(1011, 'Session not ready');
    return;
  }

  sessions.touch(userId);

  // ── Spawn bash via node-pty ───────────────────────────────────────────────
  // node-pty creates a real POSIX PTY pair on the host. docker exec -it sees
  // a proper TTY on its stdin, allocates a PTY inside the container, and bash
  // runs with full terminal support (arrow keys, vim, resize, etc.).
  let proc;
  try {
    proc = pty.spawn('docker', [
      'exec', '-it',
      '-e', 'TERM=xterm-256color',
      '-e', 'KUBECONFIG=/etc/rancher/k3s/k3s.yaml',
      '-e', 'HOME=/root',
      '-e', `COLUMNS=${cols}`,
      '-e', `LINES=${rows}`,
      '-w', '/root',
      `studycka-${userId}`,
      '/bin/bash', '--login',
    ], {
      name: 'xterm-256color',
      cols,
      rows,
      env: { TERM: 'xterm-256color', HOME: '/root' },
    });
  } catch (err) {
    console.error('[terminal] pty.spawn failed:', err.message);
    ws.close(1011, 'Failed to open terminal');
    return;
  }

  // ── PTY output → WebSocket (binary frames) ───────────────────────────────
  // node-pty gives a string; encode as binary Buffer to preserve every byte
  // value including sub-0x20 bytes inside escape sequences.
  proc.onData((data) => {
    if (ws.readyState === ws.OPEN) {
      ws.send(Buffer.from(data, 'binary'), { binary: true });
    }
  });

  proc.onExit(({ exitCode }) => {
    console.log('[terminal] pty exited, code:', exitCode);
    if (ws.readyState === ws.OPEN) ws.close(1000, 'Terminal closed');
  });

  // ── WebSocket → PTY ──────────────────────────────────────────────────────
  ws.on('message', (raw) => {
    try {
      const msg = JSON.parse(raw.toString());
      if (msg.type === 'input') {
        proc.write(msg.data);
      } else if (msg.type === 'resize') {
        proc.resize(Math.max(1, msg.data.cols), Math.max(1, msg.data.rows));
      }
    } catch (_) { /* ignore malformed messages */ }
  });

  ws.on('close', () => {
    try { proc.kill(); } catch (_) {}
  });

  ws.on('error', (err) => {
    console.error('[ws] error:', err.message);
    try { proc.kill(); } catch (_) {}
  });
});

// ── Idle session cleanup ──────────────────────────────────────────────────────
setInterval(async () => {
  const stale = sessions.staleUserIds();
  for (const userId of stale) {
    const session = sessions.get(userId);
    console.log(`[cleanup] removing idle session for ${userId}`);
    sessions.del(userId);
    if (session?.containerId) {
      await sandbox.removeSandbox(userId).catch((e) =>
        console.error(`[cleanup] remove failed for ${userId}:`, e.message));
    }
  }
}, 5 * 60 * 1000);

// ── Start ─────────────────────────────────────────────────────────────────────
server.listen(PORT, () => {
  console.log(`studycka backend listening on :${PORT}`);
});
