import './load.mjs';
const { setup, createSession } = StudyCKA;
import { test } from 'node:test';
import assert from 'node:assert/strict';

test('saved labs acquire the host filesystem and Vi, preserving user files and subsequent edits', async () => {
  const lab = setup({ preconditions: [{ type: 'worker-node' }] });
  lab.files['/root/answer.yaml'] = 'previous work';
  lab.shellEnv = { 'cka-lab': { EDITOR: 'nano', KUBECONFIG: '/etc/rancher/k3s/k3s.yaml' } };
  const editors = [];
  const edit = async (program, name, value, save) => {
    editors.push(program);
    if (name === '') await save('notes\n', 'scratch.txt');
  };
  let shell = createSession(lab, edit);
  assert.equal(await shell('echo "$EDITOR $VISUAL $KUBE_EDITOR"'), 'vi vi vi\n');
  assert.match(await shell('tree -L 2 /etc/rancher'), /rke2\.yaml/);
  assert.match(await shell('cat ~/.kube/config'), /studycka/);
  assert.deepEqual(await shell.completePath('/etc/ran', true), ['/etc/rancher/']);
  await shell('kubectl edit pod kube-apiserver-cka-lab -n kube-system');
  await shell('mkdir -p /root/work && cd /root/work');
  await shell('editor');
  assert.deepEqual(editors, ['vi', 'vi']);
  await shell('rm /etc/os-release');
  shell = createSession(JSON.parse(JSON.stringify(lab)), edit);
  assert.equal(
    await shell(
      'pwd; cat scratch.txt; cat ~/answer.yaml; test ! -e /etc/os-release && echo removed',
    ),
    '/root/work\nnotes\nprevious workremoved\n',
  );
  await shell('ssh worker');
  assert.equal(
    await shell('cat /etc/hostname; ls /var/lib/rancher/rke2/agent/pod-manifests'),
    'worker\nkube-proxy.yaml\n',
  );
  assert.equal(
    await shell(
      'test ! -e /root/work/scratch.txt && test ! -d /var/lib/rancher/rke2/server && echo isolated',
    ),
    'isolated\n',
  );
});
