'use strict';

const Dockerode = require('dockerode');
const { PassThrough } = require('stream');

const docker = new Dockerode({
  socketPath: process.env.DOCKER_SOCKET || '/var/run/docker.sock',
});

const SANDBOX_IMAGE = process.env.SANDBOX_IMAGE || 'studycka-sandbox:latest';
const WORKER_IMAGE  = process.env.WORKER_IMAGE  || 'studycka-worker:latest';
const KUBECONFIG    = '/etc/rancher/k3s/k3s.yaml';

/**
 * Find a Docker network by name and return its ID, or null if not found.
 */
async function findNetworkId(name) {
  const nets = await docker.listNetworks({ filters: JSON.stringify({ name: [name] }) });
  // listNetworks with a name filter returns prefix-matches too, so check exact name
  const match = nets.find((n) => n.Name === name);
  return match ? match.Id : null;
}

/**
 * Create a per-user Docker bridge network for server ↔ worker communication.
 * If a stale network exists, disconnects all endpoints and removes it first.
 */
async function createSandboxNetwork(userId) {
  const name = `studycka-net-${userId}`;
  const staleId = await findNetworkId(name);
  if (staleId) {
    const net = docker.getNetwork(staleId);
    const info = await net.inspect().catch(() => null);
    for (const [cid] of Object.entries(info?.Containers ?? {})) {
      await net.disconnect({ Container: cid, Force: true }).catch(() => {});
    }
    await net.remove().catch(() => {});
  }
  await docker.createNetwork({ Name: name, Driver: 'bridge' });
}

/**
 * Remove the per-user Docker bridge network.
 */
async function removeSandboxNetwork(userId) {
  const name = `studycka-net-${userId}`;
  const id = await findNetworkId(name);
  if (id) await docker.getNetwork(id).remove().catch(() => {});
}

/**
 * Create and start a k3s sandbox container for a given userId.
 * Returns the container ID.
 */
async function createSandbox(userId) {
  const name        = `studycka-${userId}`;
  const networkName = `studycka-net-${userId}`;

  // If the container is already running (e.g. after a backend restart), reuse it.
  try {
    const existing = docker.getContainer(name);
    const info = await existing.inspect();
    if (info.State.Running) {
      console.log(`[createSandbox] reconnecting to existing container for ${userId}`);
      return info.Id;
    }
  } catch (_) { /* no existing container — continue with fresh setup */ }

  // Remove stale containers FIRST so their network endpoints are gone,
  // otherwise Docker refuses to remove the network (409 active endpoints).
  await removeWorkerNode(userId);
  try {
    const stale = docker.getContainer(name);
    await stale.stop({ t: 2 }).catch(() => {});
    await stale.remove({ force: true }).catch(() => {});
  } catch (_) { /* no stale container */ }

  // Now safe to recreate the network
  await createSandboxNetwork(userId);

  const container = await docker.createContainer({
    Image: SANDBOX_IMAGE,
    name,
    Hostname: 'cka-lab',
    Env: [`KUBECONFIG=${KUBECONFIG}`],
    HostConfig: {
      Privileged: true,
      Binds: ['/sys/fs/cgroup:/sys/fs/cgroup:rw'],
      Tmpfs: {
        '/run':     'rw,nosuid,nodev,exec,relatime',
        '/var/run': 'rw,nosuid,nodev,exec,relatime',
      },
      CgroupnsMode: 'host',
      Memory:   768 * 1024 * 1024, // 768 MB
      NanoCpus: 1500000000,        // 1.5 vCPU
      NetworkMode: networkName,
    },
  });

  await container.start();
  return container.id;
}

/**
 * Stop and remove the sandbox container, any worker container, and the per-user network.
 */
async function removeSandbox(userId) {
  // Remove worker first (must disconnect from network before network can be removed)
  await removeWorkerNode(userId);

  const name = `studycka-${userId}`;
  const container = docker.getContainer(name);
  await container.stop({ t: 3 }).catch(() => {});
  await container.remove({ force: true }).catch(() => {});

  await removeSandboxNetwork(userId);
}

/**
 * Create and start a worker-node container that joins the server's k3s cluster.
 * Returns the worker container ID.
 */
async function createWorkerNode(userId, serverContainerId) {
  const workerName  = `studycka-worker-${userId}`;
  const serverName  = `studycka-${userId}`;
  const networkName = `studycka-net-${userId}`;

  // Remove any stale worker container
  try {
    const stale = docker.getContainer(workerName);
    await stale.stop({ t: 2 }).catch(() => {});
    await stale.remove({ force: true }).catch(() => {});
  } catch (_) { /* no stale worker */ }

  // Clear the stale worker node and its password secret from the k3s server.
  // k3s stores each node's join password as a kube Secret; if we recreate the
  // container without clearing this, the new agent gets "Node password rejected".
  await execCommand(serverContainerId, [
    'kubectl', '--kubeconfig', KUBECONFIG,
    'delete', 'node', 'worker', '--ignore-not-found=true',
  ]).catch(() => {});
  await execCommand(serverContainerId, [
    'kubectl', '--kubeconfig', KUBECONFIG,
    'delete', 'secret', 'worker.node-password.k3s', '-n', 'kube-system', '--ignore-not-found=true',
  ]).catch(() => {});

  // Read the k3s server token (available after waitForReady)
  const { stdout } = await execCommand(serverContainerId, [
    'cat', '/var/lib/rancher/k3s/server/node-token',
  ]);
  const token = stdout.trim();

  const container = await docker.createContainer({
    Image: WORKER_IMAGE,
    name: workerName,
    Hostname: 'worker',
    Env: [
      `K3S_URL=https://${serverName}:6443`,
      `K3S_TOKEN=${token}`,
    ],
    HostConfig: {
      Privileged: true,
      Binds: ['/sys/fs/cgroup:/sys/fs/cgroup:rw'],
      Tmpfs: {
        '/run':     'rw,nosuid,nodev,exec,relatime',
        '/var/run': 'rw,nosuid,nodev,exec,relatime',
      },
      CgroupnsMode: 'host',
      Memory:   512 * 1024 * 1024, // 512 MB
      NanoCpus: 750000000,         // 0.75 vCPU
      NetworkMode: networkName,
    },
  });

  await container.start();
  return container.id;
}

/**
 * Stop and remove the worker-node container for a userId (no-op if none exists).
 */
async function removeWorkerNode(userId) {
  const workerName = `studycka-worker-${userId}`;
  try {
    const container = docker.getContainer(workerName);
    await container.stop({ t: 3 }).catch(() => {});
    await container.remove({ force: true }).catch(() => {});
  } catch (_) { /* no worker to remove */ }
}

/**
 * Poll until a second node appears and all nodes show Ready.
 * Used after createWorkerNode() to wait for the agent to join the cluster.
 */
async function waitForWorkerReady(serverContainerId, timeoutMs = 180_000) {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    try {
      const { stdout } = await execCommand(serverContainerId, [
        'kubectl', '--kubeconfig', KUBECONFIG,
        'get', 'nodes', '--no-headers',
      ]);
      const lines = stdout.trim().split('\n').filter(Boolean);
      if (lines.length >= 2) {
        const allReady = lines.every((line) => line.split(/\s+/)[1] === 'Ready');
        if (allReady) return;
      }
    } catch (_) { /* cluster busy — retry */ }

    await sleep(3000);
  }

  throw new Error('Worker node did not become Ready within timeout');
}

/**
 * Poll until the worker node shows NotReady status.
 * Used after killing the k3s agent to confirm the fault is visible before setup completes.
 */
async function waitForWorkerNotReady(serverContainerId, timeoutMs = 120_000) {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    try {
      const { stdout } = await execCommand(serverContainerId, [
        'kubectl', '--kubeconfig', KUBECONFIG,
        'get', 'node', 'worker', '--no-headers',
      ]);
      const line = stdout.trim().split('\n').find(Boolean) ?? '';
      if (line.split(/\s+/)[1] === 'NotReady') return;
    } catch (_) { /* retry */ }

    await sleep(3000);
  }

  throw new Error('Worker node did not become NotReady within timeout');
}

/**
 * Poll until `kubectl get nodes` shows a Ready node or timeout expires.
 */
async function waitForReady(containerId, timeoutMs = 120_000) {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    try {
      const { stdout } = await execCommand(containerId, [
        'kubectl', '--kubeconfig', KUBECONFIG,
        'get', 'nodes', '--no-headers',
      ]);
      if (stdout.includes('Ready')) return;
    } catch (_) { /* not ready yet */ }

    await sleep(3000);
  }

  throw new Error('k3s did not become Ready within timeout');
}

/**
 * Apply a YAML manifest string inside the container via kubectl apply -f -
 */
async function applyManifest(containerId, manifest) {
  await execCommand(containerId, [
    'sh', '-c',
    `echo '${Buffer.from(manifest).toString('base64')}' | base64 -d | kubectl --kubeconfig ${KUBECONFIG} apply -f -`,
  ]);
}

/**
 * Write a file into the container at the given absolute path.
 */
async function writeFile(containerId, filePath, content) {
  await execCommand(containerId, [
    'sh', '-c',
    `echo '${Buffer.from(content).toString('base64')}' | base64 -d > ${filePath}`,
  ]);
}

/**
 * Run a kubectl command inside the container and return stdout.
 */
async function kubectlExec(containerId, args) {
  const { stdout } = await execCommand(containerId, [
    'kubectl', '--kubeconfig', KUBECONFIG, ...args,
  ]);
  return stdout.trim();
}

/**
 * Low-level: exec a command in a container, return { stdout, stderr }.
 * Uses Tty:false so Docker demuxes stdout/stderr into separate streams.
 */
async function execCommand(containerId, cmd) {
  const container = docker.getContainer(containerId);

  const exec = await container.exec({
    Cmd: cmd,
    AttachStdout: true,
    AttachStderr: true,
    Tty: false,
  });

  const stream = await exec.start({ Detach: false });

  return new Promise((resolve, reject) => {
    const stdoutBufs = [];
    const stderrBufs = [];
    const out = new PassThrough();
    const err = new PassThrough();

    out.on('data', (c) => stdoutBufs.push(c));
    err.on('data', (c) => stderrBufs.push(c));

    docker.modem.demuxStream(stream, out, err);

    stream.on('end', () => {
      resolve({
        stdout: Buffer.concat(stdoutBufs).toString(),
        stderr: Buffer.concat(stderrBufs).toString(),
      });
    });
    stream.on('error', reject);
  });
}

/**
 * Poll until all kube-system pods have left Pending / ContainerCreating.
 * Call this after waitForReady() so exercise preconditions can be scheduled.
 * Does NOT throw on timeout — it logs and continues so the exercise still loads.
 */
async function waitForSystemPodsReady(containerId, timeoutMs = 120_000) {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    try {
      const { stdout } = await execCommand(containerId, [
        'kubectl', '--kubeconfig', KUBECONFIG,
        'get', 'pods', '-n', 'kube-system', '--no-headers',
      ]);
      const lines = stdout.trim().split('\n').filter(Boolean);
      if (lines.length > 0) {
        const notReady = lines.some((line) =>
          line.includes('Pending') ||
          line.includes('ContainerCreating') ||
          line.includes('PodInitializing') ||
          line.includes('Init:')
        );
        if (!notReady) return;
      }
    } catch (_) { /* not ready yet */ }

    await sleep(3000);
  }

  console.warn('[waitForSystemPodsReady] timed out — continuing anyway');
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

module.exports = {
  createSandbox,
  removeSandbox,
  createWorkerNode,
  removeWorkerNode,
  waitForReady,
  waitForSystemPodsReady,
  waitForWorkerReady,
  waitForWorkerNotReady,
  applyManifest,
  writeFile,
  kubectlExec,
  execCommand,
};
