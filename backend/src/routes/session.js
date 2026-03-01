'use strict';

const express     = require('express');
const router      = express.Router();
const sandbox     = require('../sandbox/docker');
const sessions    = require('../session/manager');

// POST /api/session  { userId }
router.post('/', async (req, res) => {
  const { userId } = req.body;
  if (!userId) return res.status(400).json({ error: 'userId required' });

  sessions.touch(userId);

  // Return existing session state if it exists
  if (sessions.has(userId)) {
    return res.json({ status: sessions.get(userId).status });
  }

  // Bootstrap a new session
  sessions.set(userId, { status: 'starting', containerId: null, error: null });

  // Fire-and-forget — frontend polls /status
  (async () => {
    try {
      const containerId = await sandbox.createSandbox(userId);
      sessions.set(userId, { status: 'waiting', containerId });

      await sandbox.waitForReady(containerId);
      sessions.set(userId, { status: 'ready', containerId });
    } catch (err) {
      console.error(`[session] bootstrap failed for ${userId}:`, err.message);
      sessions.set(userId, { status: 'error', error: err.message });
    }
  })();

  res.json({ status: 'starting' });
});

// GET /api/session/status?userId=...
router.get('/status', (req, res) => {
  const { userId } = req.query;
  if (!userId) return res.status(400).json({ error: 'userId required' });

  sessions.touch(userId);
  const session = sessions.get(userId);
  if (!session) return res.json({ status: 'none' });

  res.json({ status: session.status, error: session.error ?? undefined });
});

module.exports = router;
