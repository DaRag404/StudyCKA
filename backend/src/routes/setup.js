'use strict';

const express  = require('express');
const router   = express.Router();
const sandbox  = require('../sandbox/docker');
const sessions = require('../session/manager');
const { loadExercises } = require('./exercises');

// Cleanup command: removes all user-created resources from the default namespace
// so each exercise starts from a clean slate.
const CLEANUP_CMD = [
  'sh', '-c',
  [
    'kubectl delete all          --all -n default --force --grace-period=0 --ignore-not-found=true --wait=false',
    'kubectl delete networkpolicies --all -n default --ignore-not-found=true',
    'kubectl delete pvc          --all -n default --force --grace-period=0 --ignore-not-found=true',
    'kubectl delete rolebindings,roles --all -n default --ignore-not-found=true',
    'kubectl delete serviceaccounts   --all -n default --ignore-not-found=true',
    'kubectl delete configmaps   --all -n default --ignore-not-found=true',
    'true',
  ].join('; '),
];

// POST /api/setup/:exerciseId?userId=...
// 1. Cleans the default namespace (removes previous exercise resources)
// 2. Applies preconditions for the new exercise
// Called automatically when the user selects an exercise.
router.post('/:exerciseId', async (req, res) => {
  const { userId } = req.query;
  const { exerciseId } = req.params;

  if (!userId) return res.status(400).json({ error: 'userId required' });

  const session = sessions.get(userId);
  if (!session || session.status !== 'ready') {
    return res.status(409).json({ error: 'Session not ready' });
  }

  try {
    // Step 1: clean previous exercise resources
    await sandbox.execCommand(session.containerId, CLEANUP_CMD);

    // Step 2: apply preconditions for the new exercise
    const exercise = loadExercises().find((e) => e.id === exerciseId);
    if (exercise?.preconditions?.length) {
      for (const pre of exercise.preconditions) {
        if (pre.type === 'manifest') {
          await sandbox.applyManifest(session.containerId, pre.manifest);
        } else if (pre.type === 'command') {
          const shellCmd = Array.isArray(pre.command) ? pre.command.join(' ') : pre.command;
          await sandbox.execCommand(session.containerId, ['sh', '-c', shellCmd]);
        }
      }
    }

    // Step 3: wait until all pods in default namespace have left ContainerCreating
    await waitForPodsScheduled(session.containerId);

    res.json({ ok: true });
  } catch (err) {
    console.error(`[setup] failed for ${userId} / ${exerciseId}:`, err.message);
    res.status(500).json({ error: err.message });
  }
});

// Poll until no pods in default namespace are in ContainerCreating / PodInitializing.
// Gives up after timeoutMs and continues anyway (better to show the exercise than hang).
async function waitForPodsScheduled(containerId, timeoutMs = 90_000) {
  const KUBECONFIG = '/etc/rancher/k3s/k3s.yaml';
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    try {
      const { stdout } = await sandbox.execCommand(containerId, [
        'kubectl', '--kubeconfig', KUBECONFIG,
        'get', 'pods', '-n', 'default', '--no-headers',
      ]);
      const lines = stdout.trim().split('\n').filter(Boolean);
      const stillCreating = lines.some((line) =>
        line.includes('ContainerCreating') || line.includes('PodInitializing')
      );
      if (!stillCreating) return;
    } catch (_) { /* cluster busy — retry */ }

    await new Promise((r) => setTimeout(r, 2000));
  }
}

module.exports = router;
