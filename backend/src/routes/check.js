'use strict';

const express  = require('express');
const router   = express.Router();
const sessions = require('../session/manager');
const sandbox  = require('../sandbox/docker');
const { loadExercises } = require('./exercises');

// POST /api/check/:exerciseId?userId=...
router.post('/:exerciseId', async (req, res) => {
  const { userId } = req.query;
  const { exerciseId } = req.params;

  if (!userId) return res.status(400).json({ error: 'userId required' });

  const session = sessions.get(userId);
  if (!session || session.status !== 'ready') {
    return res.status(409).json({ error: 'Session not ready' });
  }

  const exercise = loadExercises().find((e) => e.id === exerciseId);
  if (!exercise) return res.status(404).json({ error: 'Exercise not found' });

  sessions.touch(userId);

  const results = [];
  let allPassed = true;

  for (const v of exercise.validation) {
    try {
      const actual = await sandbox.kubectlExec(session.containerId, v.args);
      const passed = v.match === 'contains'
        ? actual.includes(v.expect)
        : actual === v.expect;

      if (!passed) allPassed = false;
      results.push({ passed, actual, expected: v.expect, description: v.description });
    } catch (err) {
      allPassed = false;
      results.push({
        passed: false,
        actual: `error: ${err.message}`,
        expected: v.expect,
        description: v.description,
      });
    }
  }

  res.json({ passed: allPassed, results });
});

module.exports = router;
