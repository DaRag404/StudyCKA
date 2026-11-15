(() => {
  'use strict';
  const { docs, dump, find, list, node, put, reconcile } = StudyCKA;

  function kubeadm(lab, host, args) {
    const [verb, action, version] = args;
    const option = (name) =>
      args.find((a) => a.startsWith(name + '='))?.slice(name.length + 1) ||
      args[args.indexOf(name) + 1];
    if (verb === 'init' && host === 'cka-lab') {
      if (list(lab, 'Node').length) throw Error('A control plane already exists');
      const target = args.some((a) => a.startsWith('--kubernetes-version'))
        ? option('--kubernetes-version')
        : 'v1.34.0';
      if (!/^v1\.\d+\.\d+$/.test(target)) throw Error('Invalid Kubernetes version');
      lab.discoveryHash =
        'sha256:' +
        Array.from(crypto.getRandomValues(new Uint8Array(32)), (b) =>
          b.toString(16).padStart(2, '0'),
        ).join('');
      lab.controlPlaneVersion = target;
      node(lab, host).status.nodeInfo = { kubeletVersion: target };
      put(lab, {
        apiVersion: 'v1',
        kind: 'ConfigMap',
        metadata: { name: 'kubeadm-config', namespace: 'kube-system' },
        data: { ClusterConfiguration: dump({ kubernetesVersion: target }) },
      });
      reconcile(lab);
      return 'Your Kubernetes control-plane has initialized successfully!';
    }
    if (!lab.controlPlaneVersion) throw Error('This cluster is not managed by kubeadm');
    if (verb === 'token' && action === 'create') {
      lab.bootstrapToken = crypto
        .randomUUID()
        .replaceAll('-', '')
        .replace(/^(.{6})(.{16}).*$/, '$1.$2');
      return args.includes('--print-join-command')
        ? 'kubeadm join cka-lab:6443 --token ' +
            lab.bootstrapToken +
            ' --discovery-token-ca-cert-hash ' +
            lab.discoveryHash
        : lab.bootstrapToken;
    }
    if (
      verb === 'join' &&
      host === 'worker' &&
      action === 'cka-lab:6443' &&
      lab.bootstrapToken &&
      option('--discovery-token-ca-cert-hash') === lab.discoveryHash &&
      option('--token') === lab.bootstrapToken
    ) {
      if (list(lab, 'Node').some((n) => n.metadata.name === host))
        throw Error('Node already joined');
      node(lab, host).status.nodeInfo = { kubeletVersion: lab.controlPlaneVersion };
      reconcile(lab);
      return 'This node has joined the cluster';
    }
    if (verb === 'upgrade' && host === 'cka-lab') {
      const next = 'v1.' + (Number(lab.controlPlaneVersion.split('.')[1]) + 1) + '.0';
      if (action === 'plan')
        return 'Current control plane: ' + lab.controlPlaneVersion + '\nAvailable upgrade: ' + next;
      if (action === 'apply' && version === next) {
        lab.controlPlaneVersion = version;
        const cfg = find(lab, 'ConfigMap', 'kubeadm-config', 'kube-system');
        cfg.data.ClusterConfiguration = dump({ kubernetesVersion: version });
        return 'Control plane upgraded to ' + version;
      }
    }
    throw Error('Unsupported kubeadm operation or version');
  }

  async function buildKustomization(fs, dir, visited = []) {
    if (visited.includes(dir)) throw Error('Recursive kustomization: ' + dir);
    const path = (name) => fs.resolvePath(dir, name);
    const file = (await fs.exists(path('kustomization.yaml')))
      ? 'kustomization.yaml'
      : 'kustomization.yml';
    const [config] = docs(await fs.readFile(path(file)));
    const resources = [];
    for (const name of config.resources || []) {
      const entry = path(name);
      const content = (await fs.stat(entry)).isDirectory
        ? await buildKustomization(fs, entry, [...visited, dir])
        : await fs.readFile(entry);
      resources.push(...docs(content));
    }
    for (const obj of resources) {
      obj.metadata.name = (config.namePrefix || '') + obj.metadata.name + (config.nameSuffix || '');
      if (config.namespace) obj.metadata.namespace = config.namespace;
      if (config.commonLabels) {
        Object.assign((obj.metadata.labels ||= {}), config.commonLabels);
        if (obj.spec?.template) {
          Object.assign((obj.spec.template.metadata.labels ||= {}), config.commonLabels);
          Object.assign(obj.spec.selector.matchLabels, config.commonLabels);
        }
        if (obj.kind === 'Service' && obj.spec.selector)
          Object.assign(obj.spec.selector, config.commonLabels);
      }
    }
    return resources.map(dump).join('---\n');
  }

  async function helm(lab, fs, cwd, args) {
    const [verb, release, directory] = args;
    const nsIndex = args.findIndex((a) => a === '-n' || a === '--namespace');
    const ns = nsIndex < 0 ? lab.ns : args[nsIndex + 1];
    find(lab, 'Namespace', ns);
    const releases = (lab.releases ||= []);
    const existing = releases.find((r) => r.name === release && r.ns === ns);
    if (['list', 'ls'].includes(verb))
      return [
        'NAME   NAMESPACE   REVISION',
        ...releases.filter((r) => r.ns === ns).map((r) => [r.name, r.ns, r.revision].join('   ')),
      ].join('\n');
    if (verb === 'uninstall' && existing) {
      lab.objects = lab.objects.filter(
        (o) =>
          !existing.resources.some(
            ([kind, name]) =>
              o.kind === kind && o.metadata.name === name && o.metadata.namespace === ns,
          ),
      );
      releases.splice(releases.indexOf(existing), 1);
      reconcile(lab);
      return 'release "' + release + '" uninstalled';
    }
    if (!['install', 'upgrade', 'template'].includes(verb) || !directory)
      throw Error('Usage: helm install|upgrade|template RELEASE CHART');
    if (verb === 'install' && existing) throw Error('Release already exists');
    if (verb === 'upgrade' && !existing) throw Error('Release not found');
    const path = (file) => fs.resolvePath(cwd, directory + '/' + file);
    const [chart] = docs(await fs.readFile(path('Chart.yaml')));
    const values = (await fs.exists(path('values.yaml')))
      ? docs(await fs.readFile(path('values.yaml')))[0]
      : {};
    for (let i = 3; i < args.length; i++)
      if (args[i] === '--set') {
        for (const pair of args[++i].split(',')) {
          const at = pair.indexOf('=');
          if (at < 1) throw Error('Expected key=value');
          values[pair.slice(0, at)] = pair.slice(at + 1);
        }
      }
    const context = { Release: { Name: release, Namespace: ns }, Chart: chart, Values: values };
    const rendered = [];
    for (const file of (await fs.readdir(path('templates')))
      .filter((f) => /\.ya?ml$/.test(f))
      .sort()) {
      const template = await fs.readFile(path('templates/' + file));
      rendered.push(
        ...docs(
          template.replace(/{{\s*\.([\w.]+)\s*}}/g, (_, key) => {
            const value = key.split('.').reduce((o, k) => o?.[k], context);
            if (value === undefined) throw Error('Unknown chart value: ' + key);
            return String(value);
          }),
        ),
      );
    }
    if (verb === 'template') return rendered.map(dump).join('---\n');
    for (const o of rendered) {
      if (
        list(lab, o.kind, ns).some((x) => x.metadata.name === o.metadata.name) &&
        !existing?.resources.some(([k, n]) => k === o.kind && n === o.metadata.name)
      )
        throw Error('Resource already exists: ' + o.metadata.name);
    }
    const before = structuredClone(lab.objects);
    try {
      if (existing)
        lab.objects = lab.objects.filter(
          (o) =>
            !existing.resources.some(
              ([k, n]) => o.kind === k && o.metadata.name === n && o.metadata.namespace === ns,
            ),
        );
      for (const o of rendered) put(lab, o, ns);
      reconcile(lab);
    } catch (error) {
      lab.objects = before;
      throw error;
    }
    const record = {
      name: release,
      ns,
      revision: (existing?.revision || 0) + 1,
      resources: rendered.map((o) => [o.kind, o.metadata.name]),
    };
    if (existing) Object.assign(existing, record);
    else releases.push(record);
    return 'NAME: ' + release + '\nSTATUS: deployed\nREVISION: ' + record.revision;
  }

  Object.assign(StudyCKA, { kubeadm, buildKustomization, helm });
})();
