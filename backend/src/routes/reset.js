'use strict';

const express  = require('express');
const router   = express.Router();
const sandbox  = require('../sandbox/docker');
const sessions = require('../session/manager');
const { loadExercises } = require('./exercises');

// POST /api/reset/:exerciseId?userId=...
router.post('/:exerciseId', async (req, res) => {
  const { userId } = req.query;
  const { exerciseId } = req.params;

  if (!userId) return res.status(400).json({ error: 'userId required' });

  const session = sessions.get(userId);
  if (!session) return res.status(404).json({ error: 'Session not found' });

  sessions.set(userId, { status: 'resetting' });
  res.json({ status: 'resetting' });

  // Async reset — client polls /api/session/status
  (async () => {
    try {
      // Tear down old container
      if (session.containerId) {
        await sandbox.removeSandbox(userId);
      }

      // Create fresh container
      const containerId = await sandbox.createSandbox(userId);
      sessions.set(userId, { status: 'waiting', containerId });

      await sandbox.waitForReady(containerId);
      await sandbox.waitForSystemPodsReady(containerId);

      // Apply exercise preconditions if any
      let workerContainerId = null;
      const exercise = loadExercises().find((e) => e.id === exerciseId);
      if (exercise?.preconditions?.length) {
        for (const pre of exercise.preconditions) {
          if (pre.type === 'manifest') {
            await sandbox.applyManifest(containerId, pre.manifest);
          } else if (pre.type === 'command') {
            const shellCmd = Array.isArray(pre.command) ? pre.command.join(' ') : pre.command;
            await sandbox.execCommand(containerId, ['sh', '-c', shellCmd]);
          } else if (pre.type === 'file') {
            await sandbox.writeFile(containerId, pre.path, pre.content);
          } else if (pre.type === 'worker-node') {
            workerContainerId = await sandbox.createWorkerNode(userId, containerId);
            sessions.set(userId, { workerContainerId });
            await sandbox.waitForWorkerReady(containerId);
          } else if (pre.type === 'command-on-worker') {
            if (workerContainerId) {
              const shellCmd = Array.isArray(pre.command) ? pre.command.join(' ') : pre.command;
              await sandbox.execCommand(workerContainerId, ['sh', '-c', shellCmd]);
            }
          } else if (pre.type === 'wait-for-worker-not-ready') {
            await sandbox.waitForWorkerNotReady(containerId);
          }
        }
      }

      sessions.set(userId, { status: 'ready', containerId, workerContainerId });
    } catch (err) {
      console.error(`[reset] failed for ${userId}:`, err.message);
      sessions.set(userId, { status: 'error', error: err.message });
    }
  })();
});

module.exports = router;
