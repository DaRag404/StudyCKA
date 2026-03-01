'use strict';

const express  = require('express');
const router   = express.Router();
const sandbox  = require('../sandbox/docker');
const sessions = require('../session/manager');
const { loadExercises } = require('./exercises');

// POST /api/setup/:exerciseId?userId=...
// Applies exercise preconditions to the EXISTING container (no sandbox recreate).
// Called automatically when the user selects an exercise.
router.post('/:exerciseId', async (req, res) => {
  const { userId } = req.query;
  const { exerciseId } = req.params;

  if (!userId) return res.status(400).json({ error: 'userId required' });

  const session = sessions.get(userId);
  if (!session || session.status !== 'ready') {
    return res.status(409).json({ error: 'Session not ready' });
  }

  const exercise = loadExercises().find((e) => e.id === exerciseId);
  if (!exercise?.preconditions?.length) {
    return res.json({ ok: true });
  }

  try {
    for (const pre of exercise.preconditions) {
      if (pre.type === 'manifest') {
        await sandbox.applyManifest(session.containerId, pre.manifest);
      } else if (pre.type === 'command') {
        const shellCmd = Array.isArray(pre.command) ? pre.command.join(' ') : pre.command;
        await sandbox.execCommand(session.containerId, ['sh', '-c', shellCmd]);
      }
    }
    res.json({ ok: true });
  } catch (err) {
    console.error(`[setup] failed for ${userId} / ${exerciseId}:`, err.message);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
