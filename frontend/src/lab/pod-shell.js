import { Bash, InMemoryFs, defineCommand } from 'just-bash/browser';
import { find } from './cluster.js';

export function openPodShell(lab, pod, container) {
  if (pod.status.phase !== 'Running')
    throw Error('Container is not running: ' + pod.status.message);
  const name = pod.metadata.name,
    ns = pod.metadata.namespace;
  const key = [ns, name, pod.metadata.creationTimestamp, container.name].join('/');
  const disk = ((lab.containerFiles ||= {})[key] ||= {});
  const files = {
    '/etc/hostname': name + '\n',
    '/etc/resolv.conf':
      'nameserver 10.43.0.10\nsearch ' + ns + '.svc.cluster.local svc.cluster.local\n',
    '/etc/os-release': container.image.startsWith('alpine')
      ? 'ID=alpine\n'
      : 'NAME="Container Linux"\n',
  };
  for (const writer of [...(pod.spec.initContainers || []), ...pod.spec.containers]) {
    const m = writer.command?.join(' ').match(/echo\s+([^;>]+?)\s*>>?\s*(\/[^; ]+)/);
    if (!m) continue;
    for (const mount of writer.volumeMounts || []) {
      const shared = container.volumeMounts?.find((v) => v.name === mount.name);
      if (shared && m[2].startsWith(mount.mountPath + '/'))
        files[m[2].replace(mount.mountPath, shared.mountPath)] = m[1] + '\n';
    }
  }
  const env = {};
  for (const e of container.env || []) {
    const cm = e.valueFrom?.configMapKeyRef,
      secret = e.valueFrom?.secretKeyRef;
    env[e.name] = cm
      ? find(lab, 'ConfigMap', cm.name, ns).data[cm.key]
      : secret
        ? atob(find(lab, 'Secret', secret.name, ns).data[secret.key])
        : e.value || '';
  }
  const fs = new InMemoryFs();
  const bash = new Bash({
    fs,
    cwd: '/',
    env: { ...env, HOSTNAME: name, HOME: '/root' },
    customCommands: [
      defineCommand('hostname', async () => ({ stdout: name + '\n', stderr: '', exitCode: 0 })),
      defineCommand('nslookup', async ([host]) => {
        const [svc, namespace = ns] = (host || '').split('.');
        const ip =
          svc === 'kubernetes'
            ? '10.43.0.1'
            : lab.objects.find(
                (o) =>
                  o.kind === 'Service' &&
                  o.metadata.name === svc &&
                  o.metadata.namespace === namespace,
              )?.spec.clusterIP;
        const ok = pod.spec.dnsPolicy !== 'Default' && ip;
        return {
          stdout: ok
            ? 'Name: ' +
              svc +
              '.' +
              (svc === 'kubernetes' ? 'default' : namespace) +
              '.svc.cluster.local\nAddress: ' +
              ip +
              '\n'
            : '',
          stderr: ok ? '' : 'nslookup: cannot resolve ' + host + '\n',
          exitCode: ok ? 0 : 1,
        };
      }),
    ],
  });
  const generated = new Set(fs.getAllPaths());
  for (const [p, value] of Object.entries({ ...files, ...disk })) {
    if (value === null) continue;
    if (p.endsWith('/')) fs.mkdirSync(p, { recursive: true });
    else {
      fs.mkdirSync(p.slice(0, p.lastIndexOf('/')) || '/', { recursive: true });
      fs.writeFileSync(p, value);
    }
  }
  return async (line, state, signal, stdin) => {
    const result = await bash.exec(line, { cwd: state.cwd, env: state.env, signal, stdin });
    state.cwd = result.env.PWD;
    state.env = result.env;
    for (const p of Object.keys(disk)) delete disk[p];
    for (const p of Object.keys(files)) if (!(await fs.exists(p))) disk[p] = null;
    for (const p of fs.getAllPaths()) {
      if (generated.has(p)) continue;
      const stat = await fs.stat(p);
      if (stat.isDirectory) disk[p + '/'] = '';
      else if (stat.isFile) {
        const value = await fs.readFile(p);
        if (value !== files[p]) disk[p] = value;
      }
    }
    return result;
  };
}
