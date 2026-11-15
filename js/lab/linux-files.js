(() => {
  'use strict';
  const { dump } = StudyCKA;
  const { staticPods } = StudyCKA;

  const rke2 = '/var/lib/rancher/rke2';
  const serverConfig = '/etc/rancher/rke2/rke2.yaml';
  const workerConfig = rke2 + '/agent/kubelet.kubeconfig';

  // Add the host image once. After that, edits, moves and deletions belong to the user.
  function installLinuxFiles(lab, host) {
    if (lab.linuxFilesVersion?.[host]) return;
    const worker = host === 'worker';
    const files = worker ? lab.workerFiles : lab.files;
    const metadata = ((lab.fileMetadata ||= {})[host] ||= {});
    const directories = [
      '/boot',
      '/dev',
      '/etc/profile.d',
      '/etc/systemd/system',
      '/home',
      '/lib',
      '/lib64',
      '/media',
      '/mnt',
      '/opt',
      '/proc',
      '/root',
      '/run',
      '/sbin',
      '/srv',
      '/sys',
      '/tmp',
      '/usr/bin',
      '/usr/lib',
      '/usr/local/bin',
      '/usr/sbin',
      '/usr/share',
      '/var/cache',
      '/var/lib/kubelet/pods',
      '/var/log/containers',
      '/var/log/pods',
      '/var/tmp',
      rke2 + '/bin',
    ];
    function available(path) {
      return (
        !Object.hasOwn(files, path) && !Object.hasOwn(files, path + '/') && !metadata[path]?.link
      );
    }
    function file(path, content, mode) {
      if (!available(path)) return;
      files[path] = content;
      if (mode) metadata[path] = { mode };
    }
    function link(path, target) {
      if (available(path)) metadata[path] = { link: target };
    }
    for (const directory of directories) if (available(directory)) files[directory + '/'] = '';
    for (const [path, mode] of [
      ['/root', 0o700],
      ['/tmp', 0o1777],
      ['/var/tmp', 0o1777],
    ]) {
      metadata[path] ??= { mode };
    }
    file('/etc/hostname', host + '\n');
    file(
      '/etc/hosts',
      '127.0.0.1 localhost\n192.168.122.10 cka-lab\n' +
        (lab.objects.some((o) => o.kind === 'Node' && o.metadata.name === 'worker')
          ? '192.168.122.11 worker\n'
          : ''),
    );
    file(
      '/etc/passwd',
      'root:x:0:0:root:/root:/bin/bash\nnobody:x:65534:65534:nobody:/nonexistent:/sbin/nologin\n',
    );
    file('/etc/group', 'root:x:0:\nnogroup:x:65534:\n');
    file('/etc/os-release', 'NAME="StudyCKA Linux"\nID=studycka\n');
    file('/etc/profile.d/editor.sh', 'export EDITOR=vi\nexport VISUAL=vi\n');
    file('/root/.bashrc', 'export EDITOR=vi\nexport VISUAL=vi\nalias k=kubectl\n');
    file('/root/.vimrc', 'set nocompatible\nset backspace=indent,eol,start\nsyntax off\n');
    file(
      '/etc/rancher/rke2/config.yaml',
      'node-name: ' +
        host +
        '\n' +
        (worker ? 'server: https://cka-lab:9345\ntoken: studycka-lab\n' : 'cni: canal\n'),
    );
    const config = worker ? workerConfig : serverConfig;
    const user = worker ? 'system:node:worker' : 'system:admin';
    file(
      config,
      dump({
        apiVersion: 'v1',
        kind: 'Config',
        clusters: [
          {
            name: 'studycka',
            cluster: {
              server: worker ? 'https://cka-lab:6443' : 'https://127.0.0.1:6443',
            },
          },
        ],
        users: [{ name: user, user: { token: 'studycka-lab' } }],
        contexts: [{ name: 'studycka', context: { cluster: 'studycka', user } }],
        'current-context': 'studycka',
      }),
      0o600,
    );
    if (!worker) {
      files['/root/.kube/'] ??= '';
      link('/root/.kube/config', config);
      files['/etc/rancher/k3s/'] ??= '';
      link('/etc/rancher/k3s/k3s.yaml', config);
      for (const chart of ['rke2-canal', 'rke2-coredns', 'rke2-metrics-server']) {
        file(
          rke2 + '/server/manifests/' + chart + '.yaml',
          dump({
            apiVersion: 'helm.cattle.io/v1',
            kind: 'HelmChart',
            metadata: { name: chart, namespace: 'kube-system' },
            spec: { chart, targetNamespace: 'kube-system' },
          }),
        );
      }
    }
    link(rke2 + '/bin/kubectl', '/usr/bin/kubectl');
    for (const pod of staticPods(host)) {
      const component = pod.metadata.labels.component;
      file(
        rke2 + '/agent/pod-manifests/' + component + '.yaml',
        dump({
          ...pod,
          metadata: { name: component, namespace: 'kube-system', labels: pod.metadata.labels },
        }),
      );
    }
    file(rke2 + '/agent/logs/kubelet.log', 'Started kubelet on ' + host + '\n');
    file(rke2 + '/agent/containerd/containerd.log', 'containerd successfully booted\n');
    (lab.linuxFilesVersion ||= {})[host] = 1;
    const env = lab.shellEnv?.[host];
    if (env) {
      env.EDITOR = env.VISUAL = env.KUBE_EDITOR = 'vi';
      if (env.KUBECONFIG === '/etc/rancher/k3s/k3s.yaml') env.KUBECONFIG = config;
    }
  }

  Object.assign(StudyCKA, { serverConfig, workerConfig, installLinuxFiles });
})();
