import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setup } from '../src/lab/shell.js';
import { createSession } from '../src/lab/session.js';

test('pull failure, event history, container shell isolation and reload', async () => {
  const lab = setup(),
    run = createSession(lab);
  await run('kubectl run probe --image=nginx:missing');
  assert.match(await run('kubectl get pods'), /ImagePullBackOff/);
  assert.match(await run('crictl images'), /hardened-etcd/);
  assert.doesNotMatch(await run('crictl images'), /missing/);
  await run('kubectl set image pod/probe probe=nginx:1.25');
  assert.match(await run('kubectl get pods'), /Running/);
  assert.match(await run('kubectl get events'), /Failed[\s\S]*BackOff[\s\S]*Started/);
  assert.match(await run('crictl images'), /nginx\s+1.25/);
  await run('kubectl exec -it probe -- sh');
  assert.equal((await run('hostname')).trim(), 'probe');
  await run('echo inside > /tmp/isolated');
  const restored = createSession(JSON.parse(JSON.stringify(lab)));
  assert.equal((await restored('cat /tmp/isolated')).trim(), 'inside');
  await restored('exit');
  assert.match(await restored('cat /tmp/isolated'), /No such file/);
  assert.equal((await restored('kubectl exec probe -- cat /tmp/isolated')).trim(), 'inside');
});

test('previous logs show the command output of a crashing container', async () => {
  const run = createSession(setup());
  await run("kubectl run crash --image=busybox:1.36 -- sh -c 'echo goodbye; exit 1'");
  assert.match(await run('kubectl logs -p crash'), /goodbye\nProcess exited with code 1/);
  assert.match(await run('kubectl get events'), /Back-off restarting/);
});
