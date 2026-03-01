'use strict';

const Dockerode = require('dockerode');
const { PassThrough } = require('stream');

const docker = new Dockerode({
  socketPath: process.env.DOCKER_SOCKET || '/var/run/docker.sock',
});

const SANDBOX_IMAGE = process.env.SANDBOX_IMAGE || 'studycka-sandbox:latest';
const KUBECONFIG    = '/etc/rancher/k3s/k3s.yaml';

/**
 * Create and start a k3s sandbox container for a given userId.
 * Returns the container ID.
 */
async function createSandbox(userId) {
  const name = `studycka-${userId}`;

  // Remove any stale container with the same name
  try {
    const stale = docker.getContainer(name);
    await stale.stop({ t: 2 }).catch(() => {});
    await stale.remove({ force: true }).catch(() => {});
  } catch (_) { /* no stale container */ }

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
    },
  });

  await container.start();
  return container.id;
}

/**
 * Stop and remove the sandbox container for a userId.
 */
async function removeSandbox(userId) {
  const name = `studycka-${userId}`;
  const container = docker.getContainer(name);
  await container.stop({ t: 3 }).catch(() => {});
  await container.remove({ force: true }).catch(() => {});
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
 * Open an interactive TTY exec session and return { exec, stream }.
 * Caller wires the stream to/from a WebSocket.
 */
async function openTerminal(containerId) {
  const container = docker.getContainer(containerId);

  const exec = await container.exec({
    Cmd: ['/bin/bash', '--login'],
    AttachStdin:  true,
    AttachStdout: true,
    AttachStderr: true,
    Tty: true,
    Env: [
      `KUBECONFIG=${KUBECONFIG}`,
      'TERM=xterm-256color',
    ],
  });

  const stream = await exec.start({ hijack: true, stdin: true });
  return { exec, stream };
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

module.exports = {
  createSandbox,
  removeSandbox,
  waitForReady,
  applyManifest,
  kubectlExec,
  openTerminal,
};
