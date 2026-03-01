'use strict';

const http     = require('http');
const express  = require('express');
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
  const { pathname } = new URL(req.url, `http://localhost`);
  if (pathname === '/terminal') {
    wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req));
  } else {
    socket.destroy();
  }
});

wss.on('connection', async (ws, req) => {
  const { searchParams } = new URL(req.url, `http://localhost`);
  const userId = searchParams.get('userId');
  const cols   = Math.max(40, parseInt(searchParams.get('cols') ?? '220', 10) || 220);
  const rows   = Math.max(10, parseInt(searchParams.get('rows') ?? '50',  10) || 50);

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

  let exec, stream;

  try {
    ({ exec, stream } = await sandbox.openTerminal(session.containerId, cols, rows));
  } catch (err) {
    console.error('[terminal] openTerminal failed:', err.message);
    ws.close(1011, 'Failed to open terminal');
    return;
  }

  // Docker TTY stream → browser (binary frames)
  stream.on('data', (chunk) => {
    if (ws.readyState === ws.OPEN) ws.send(chunk);
  });

  stream.on('end', () => {
    if (ws.readyState === ws.OPEN) ws.close(1000, 'Terminal closed');
  });

  stream.on('error', (err) => {
    console.error('[terminal] stream error:', err.message);
    ws.close(1011, 'Stream error');
  });

  // Browser → Docker PTY
  ws.on('message', (data) => {
    try {
      const msg = JSON.parse(data.toString());
      if (msg.type === 'input' && stream.writable) {
        stream.write(msg.data);
      } else if (msg.type === 'resize' && exec) {
        exec.resize({ h: msg.data.rows, w: msg.data.cols }).catch(() => {});
      }
    } catch (_) { /* ignore malformed messages */ }
  });

  ws.on('close', () => {
    try { stream.destroy(); } catch (_) {}
  });

  ws.on('error', (err) => {
    console.error('[ws] error:', err.message);
    try { stream.destroy(); } catch (_) {}
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
}, 5 * 60 * 1000); // check every 5 minutes

// ── Start ─────────────────────────────────────────────────────────────────────
server.listen(PORT, () => {
  console.log(`studycka backend listening on :${PORT}`);
});
