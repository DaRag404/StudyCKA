'use strict';

const express  = require('express');
const router   = express.Router();
const sandbox  = require('../sandbox/docker');
const sessions = require('../session/manager');
const { loadExercises } = require('./exercises');

// Cleanup command: removes all user-created resources from the default namespace,
// deletes any non-system namespaces, and removes template files from /root/.
// Runs each exercise from a clean slate.
const CLEANUP_CMD = [
  'sh', '-c',
  [
    // Remove any node taints left by previous exercises (key only, removes any value/effect)
    'kubectl taint nodes --all env- 2>/dev/null || true',
    // Remove node labels added by exercises (e.g. disktype=ssd from exercise 48)
    'kubectl label nodes --all disktype- 2>/dev/null || true',
    // Uncordon the server node in case it was cordoned accidentally
    'kubectl uncordon cka-lab 2>/dev/null || true',
    'kubectl delete all          --all -n default --force --grace-period=0 --ignore-not-found=true --wait=false',
    'kubectl delete networkpolicies --all -n default --ignore-not-found=true',
    'kubectl delete pvc          --all -n default --force --grace-period=0 --ignore-not-found=true',
    'kubectl delete rolebindings,roles --all -n default --ignore-not-found=true',
    'kubectl delete serviceaccounts   --all -n default --ignore-not-found=true',
    'kubectl delete configmaps   --all -n default --ignore-not-found=true',
    // Delete all non-system namespaces created by previous exercises
    'kubectl get ns --no-headers -o custom-columns=\':metadata.name\' | grep -vE \'^(default|kube-system|kube-public|kube-node-lease)$\' | xargs -r kubectl delete ns --ignore-not-found=true --wait=false 2>/dev/null || true',
    // Remove template files placed in home directory by preconditions
    'rm -f /root/*.yaml',
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
    // Step 1: remove worker node from previous exercise if any
    await sandbox.removeWorkerNode(userId);
    sessions.set(userId, { workerContainerId: null });

    // Step 2: clean previous exercise resources (includes taint removal)
    await sandbox.execCommand(session.containerId, CLEANUP_CMD);

    // Step 3: wait for kube-system pods to recover (taint removal may unblock them)
    await sandbox.waitForSystemPodsReady(session.containerId);

    // Step 4: apply preconditions for the new exercise
    const exercise = loadExercises().find((e) => e.id === exerciseId);
    if (exercise?.preconditions?.length) {
      for (const pre of exercise.preconditions) {
        if (pre.type === 'manifest') {
          await sandbox.applyManifest(session.containerId, pre.manifest);
        } else if (pre.type === 'command') {
          const shellCmd = Array.isArray(pre.command) ? pre.command.join(' ') : pre.command;
          await sandbox.execCommand(session.containerId, ['sh', '-c', shellCmd]);
        } else if (pre.type === 'file') {
          await sandbox.writeFile(session.containerId, pre.path, pre.content);
        } else if (pre.type === 'worker-node') {
          const workerContainerId = await sandbox.createWorkerNode(userId, session.containerId);
          sessions.set(userId, { workerContainerId });
          await sandbox.waitForWorkerReady(session.containerId);
        } else if (pre.type === 'command-on-worker') {
          const { workerContainerId } = sessions.get(userId);
          if (workerContainerId) {
            const shellCmd = Array.isArray(pre.command) ? pre.command.join(' ') : pre.command;
            await sandbox.execCommand(workerContainerId, ['sh', '-c', shellCmd]);
          }
        } else if (pre.type === 'wait-for-worker-not-ready') {
          await sandbox.waitForWorkerNotReady(session.containerId);
        }
      }
    }

    // Step 5: wait until all pods in default namespace have left ContainerCreating
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
