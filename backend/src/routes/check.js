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
      const matchType = v.match || 'exact';
      let passed = false;

      if (matchType === 'exact') {
        passed = actual === v.expect;
      } else if (matchType === 'contains' || matchType === 'includes') {
        passed = actual.includes(v.expect);
      } else if (matchType === 'nonempty') {
        passed = actual.trim().length > 0;
      } else if (matchType === 'gte') {
        const val = Number(actual);
        passed = !Number.isNaN(val) && val >= Number(v.expect);
      } else {
        // Unknown match type, fall back to exact match
        passed = actual === v.expect;
      }

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
