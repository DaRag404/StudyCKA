import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setup } from '../src/lab/shell.js';
import { kubectl } from '../src/lab/kubectl.js';
import { installSystemResources, reconcile } from '../src/lab/cluster.js';

test('system pods respect namespaces, node placement and kubectl selectors', () => {
  const lab = setup({ preconditions: [{ type: 'worker-node' }] });
  const k = (...args) => kubectl(lab, args);
  assert.equal(k('get', 'pods'), 'No resources found.');
  assert.match(k('get', 'pods', '-A'), /^NAMESPACE .*\nkube-system  /);
  assert.match(k('-n', 'kube-system', 'get', 'all'), /rke2-metrics-server/);
  const pods = JSON.parse(
    k('get', 'po', '--all-namespaces', '--field-selector', 'spec.nodeName=worker', '-o', 'json'),
  ).items;
  assert.ok(pods.some((p) => p.metadata.name === 'kube-proxy-worker'));
  assert.ok(pods.some((p) => p.metadata.labels?.['k8s-app'] === 'canal'));
  assert.ok(pods.every((p) => p.spec.nodeName === 'worker'));
  const api = k('get', 'pods', '-n', 'kube-system', '-l', 'component=kube-apiserver', '-o', 'name');
  assert.equal(api, 'pod/kube-apiserver-cka-lab');
  k('delete', api, '-n', 'kube-system');
  reconcile(lab);
  assert.match(k('describe', api, '-n', 'kube-system'), /hostNetwork: true/);
});

test('adding the RKE2 profile to a saved lab preserves existing workloads and files', () => {
  const lab = setup();
  lab.objects = lab.objects.filter(
    (o) => o.metadata.namespace !== 'kube-system' && o.metadata.name !== 'kube-system',
  );
  delete lab.rke2ProfileVersion;
  kubectl(lab, ['run', 'my-pod', '--image=nginx:1.25']);
  lab.files['/root/notes'] = 'saved';
  installSystemResources(lab);
  const count = lab.objects.length;
  installSystemResources(lab);
  assert.equal(lab.objects.length, count);
  assert.equal(lab.files['/root/notes'], 'saved');
  assert.match(kubectl(lab, ['get', 'pods', '-A']), /default\s+my-pod/);
  assert.match(kubectl(lab, ['get', 'pods', '-n', 'kube-system']), /etcd-cka-lab/);
});
