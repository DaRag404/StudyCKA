import { crictl } from './images.js';
import { kubeadm, helm, buildKustomization } from './admin.js';
import { openPodShell } from './pod-shell.js';
import { Bash, InMemoryFs, defineCommand } from 'just-bash/browser';
import { kubectl } from './kubectl.js';
import { clone, find, reconcile } from './cluster.js';
import { installLinuxFiles, serverConfig, workerConfig } from './linux-files.js';

const shortcuts = {
  k: [],
  kgp: ['get', 'pods'],
  kgd: ['get', 'deployments'],
  kgs: ['get', 'services'],
  kgn: ['get', 'nodes'],
  kga: ['get', 'all'],
};
const environment = {
  HOME: '/root',
  USER: 'root',
  LOGNAME: 'root',
  SHELL: '/bin/bash',
  TERM: 'xterm-256color',
  EDITOR: 'vi',
  VISUAL: 'vi',
  KUBE_EDITOR: 'vi',
};
const output = (text = '') => ({
  stdout: text && !text.endsWith('\n') ? text + '\n' : text,
  stderr: '',
  exitCode: 0,
});
const profile = '/etc/profile.d/k3s.sh';
const hostFiles = (lab, host) => (host === 'worker' ? 'workerFiles' : 'files');

// Each host owns its filesystem. Store user files and directories but omit the
// interpreter's generated executables and virtual kernel/device entries.
async function restoreMetadata(fs, metadata = {}) {
  for (const [p, entry] of Object.entries(metadata)) {
    if (entry.link !== undefined) await fs.symlink(entry.link, p);
    else if (entry.mode !== undefined) await fs.chmod(p, entry.mode);
  }
}
function filesystem(lab, host) {
  const fs = new InMemoryFs();
  for (const dir of ['/root', '/tmp', '/etc', '/var/log', '/home'])
    fs.mkdirSync(dir, { recursive: true });
  const files = lab[hostFiles(lab, host)];
  for (const [name, content] of Object.entries(files)) {
    if (name.endsWith('/')) fs.mkdirSync(name, { recursive: true });
    else {
      fs.mkdirSync(name.slice(0, name.lastIndexOf('/')) || '/', { recursive: true });
      fs.writeFileSync(
        name,
        typeof content === 'string'
          ? content
          : Uint8Array.from(atob(content.base64), (c) => c.charCodeAt(0)),
      );
    }
  }
  return fs;
}
export function createSession(lab, openEditor) {
  const machines = new Map();
  let podExec;
  const command = (name, fn) =>
    defineCommand(name, async (args, ctx) => {
      try {
        return output(await fn(args, ctx));
      } catch (error) {
        return { stdout: '', stderr: error.message + '\n', exitCode: 1 };
      }
    });
  function machine(host) {
    if (machines.has(host)) return machines.get(host);
    installLinuxFiles(lab, host);
    const fs = filesystem(lab, host);
    const customCommands = [];
    customCommands.push(
      command('__studycka_session', ([status, aliases, functions]) => {
        lab.shellSettings ||= {};
        lab.shellSettings[host] = { status: Number(status) || 0, aliases, functions };
      }),
    );
    async function kube(args, ctx) {
      const before = clone(lab);
      try {
        const kIndex = args.indexOf('-k');
        if (args[0] === 'kustomize' || kIndex >= 0) {
          const dir = args[0] === 'kustomize' ? args[1] || '.' : args[kIndex + 1];
          const rendered = await buildKustomization(fs, fs.resolvePath(ctx.cwd, dir));
          if (args[0] === 'kustomize') return rendered;
          args.splice(kIndex, 2, '-f', '-');
          ctx = { ...ctx, stdin: rendered };
        }
        const contents = new Map();
        for (const [i, token] of args.entries()) {
          const filename = ['-f', '--filename'].includes(token)
            ? args[i + 1]
            : token.match(/^(?:-f|--filename)=(.+)$/)?.[1];
          if (filename && filename !== '-')
            contents.set(filename, await fs.readFile(fs.resolvePath(ctx.cwd, filename)));
        }
        let editing;
        const result = kubectl(lab, args, {
          stdin: ctx.stdin,
          exec: async (pod, container, argv, interactive) => {
            const run = openPodShell(lab, pod, container);
            const state = {
              name: pod.metadata.name,
              namespace: pod.metadata.namespace,
              container: container.name,
              cwd: '/',
            };
            if (interactive && argv.length === 1 && /^(?:\/bin\/)?(?:ba)?sh$/.test(argv[0])) {
              lab.containerSession = state;
              podExec = run;
              return '';
            }
            const quote = (arg) => "'" + arg.replaceAll("'", "'\\''") + "'";
            const result = await run(argv.map(quote).join(' '), state, undefined, ctx.stdin);
            if (result.exitCode) throw Error((result.stderr || result.stdout).trimEnd());
            return result.stdout.trimEnd();
          },
          read: (name) => contents.get(name),
          edit: (name, value, commit) => {
            editing = openEditor(
              ctx.env.get('KUBE_EDITOR') || ctx.env.get('EDITOR') || 'vi',
              name,
              value,
              (next) => {
                commit(next);
                reconcile(lab);
              },
            );
          },
        });
        const resolved = await result;
        if (editing) await editing;
        reconcile(lab);
        return resolved;
      } catch (error) {
        Object.assign(lab, before);
        throw error;
      }
    }
    for (const [name, prefix] of Object.entries({ kubectl: [], ...shortcuts }))
      customCommands.push(command(name, (args, ctx) => kube([...prefix, ...args], ctx)));
    for (const name of ['editor', 'vi', 'vim', 'view', 'nano'])
      customCommands.push(
        command(name, async (args, ctx) => {
          const file = args.at(-1);
          let resolved = file ? fs.resolvePath(ctx.cwd, file) : '';
          await openEditor(
            name === 'editor' ? ctx.env.get('EDITOR') || 'vi' : name,
            file || '',
            resolved && (await fs.exists(resolved)) ? await fs.readFile(resolved) : '',
            async (text, filename) => {
              const path = filename ? fs.resolvePath(ctx.cwd, filename) : resolved;
              if (!path) throw Error('No file name');
              const parent = path.slice(0, path.lastIndexOf('/')) || '/';
              if (!(await fs.stat(parent)).isDirectory) throw Error(parent + ': not a directory');
              await fs.writeFile(path, text);
              if (!resolved) resolved = path;
            },
          );
        }),
      );
    customCommands.push(
      command('crictl', (args) => {
        const result = crictl(lab, host, args);
        if (args[0] === 'pull') reconcile(lab);
        return result;
      }),
      command('kubeadm', (args) => kubeadm(lab, host, args)),
      command('helm', (args, ctx) => helm(lab, fs, ctx.cwd, args)),
      command('kustomize', ([verb, dir = '.'], ctx) => {
        if (verb !== 'build') throw Error('Usage: kustomize build DIRECTORY');
        return buildKustomization(fs, fs.resolvePath(ctx.cwd, dir));
      }),
      command('hostname', () => host),
      command('whoami', () => 'root'),
      command('history', () =>
        lab.history.map((line, i) => String(i + 1).padStart(5) + '  ' + line).join('\n'),
      ),
      command('clear', () => '\x1b[H\x1b[2J'),
      command('ssh', (args) => {
        if (!['root@worker', 'worker'].includes(args.at(-1))) throw Error('ssh: Unknown host');
        if (!lab.kubeadmLab) find(lab, 'Node', 'worker');
        lab.host = 'worker';
        lab.cwd = '/root';
      }),
      command(
        'ps',
        () =>
          'PID USER COMMAND\n1 root ' +
          (host === 'worker' ? 'sshd' : 'k3s server') +
          (host === 'worker' && lab.agentRunning ? '\n24 root k3s agent' : ''),
      ),
      command('k3s', (args, ctx) => {
        if (host !== 'worker' || args[0] !== 'agent') throw Error('k3s: unsupported invocation');
        lab.agentRunning = (ctx.env.get('K3S_URL') || '').endsWith(':6443');
        find(lab, 'Node', 'worker').status.conditions[0].status = lab.agentRunning
          ? 'True'
          : 'False';
        return lab.agentRunning
          ? 'Agent connected'
          : 'Connection refused: ' + ctx.env.get('K3S_URL');
      }),
    );
    const bash = new Bash({
      fs,
      cwd: '/root',
      env: {
        ...environment,
        HOSTNAME: host,
        KUBECONFIG: host === 'worker' ? workerConfig : serverConfig,
      },
      customCommands,
      processInfo: { uid: 0, gid: 0 },
    });
    const state = {
      bash,
      fs,
      generated: new Set(
        fs
          .getAllPaths()
          .filter(
            (p) =>
              p === '/proc' ||
              p.startsWith('/proc/') ||
              p === '/dev' ||
              p.startsWith('/dev/') ||
              p.startsWith('/bin/') ||
              p.startsWith('/usr/bin/'),
          ),
      ),
    };
    state.ready = restoreMetadata(fs, lab.fileMetadata?.[host]);
    machines.set(host, state);
    return state;
  }
  async function persist(host, { fs, generated }) {
    const contents = {},
      metadata = {};
    for (const p of fs.getAllPaths()) {
      if (generated.has(p) || p === '/') continue;
      const stat = await fs.lstat(p);
      if (stat.isSymbolicLink) {
        metadata[p] = { link: await fs.readlink(p) };
        continue;
      }
      if (stat.isDirectory) contents[p + '/'] = '';
      else if (stat.isFile) {
        const text = await fs.readFile(p);
        contents[p] =
          text.includes('\uFFFD') || text.includes('\0')
            ? { base64: await fs.readFile(p, 'base64') }
            : text;
      }
      if ((stat.mode & 0o7777) !== (stat.isDirectory ? 0o755 : 0o644))
        metadata[p] = { mode: stat.mode };
    }
    lab[hostFiles(lab, host)] = contents;
    (lab.fileMetadata ||= {})[host] = metadata;
  }
  async function execute(line, signal, stdin = '') {
    if (lab.containerSession) {
      const state = lab.containerSession;
      if (line.trim() === 'exit') {
        delete lab.containerSession;
        podExec = undefined;
        return '';
      }
      const pod = find(lab, 'Pod', state.name, state.namespace);
      podExec ||= openPodShell(
        lab,
        pod,
        pod.spec.containers.find((c) => c.name === state.container),
      );
      const result = await podExec(line, state, signal, stdin);
      return result.stdout + result.stderr;
    }
    const host = lab.host,
      state = machine(host);
    await state.ready;
    lab.shellEnv ||= {};
    if (host === 'worker' && !lab.shellEnv.worker) {
      const conf = await state.fs.readFile(profile).catch(() => '');
      lab.shellEnv.worker = { K3S_URL: conf.match(/K3S_URL=(\S+)/)?.[1] || '' };
    }
    if (line.trim() === 'exit' && host === 'worker') {
      lab.host = 'cka-lab';
      lab.cwd = lab.shellEnv['cka-lab']?.PWD || '/root';
      delete lab.shellEnv.worker;
      return 'logout\n';
    }
    const settings = lab.shellSettings?.[host];
    const initialAliases = Object.entries(shortcuts)
      .map(([name, args]) => 'alias ' + name + "='kubectl " + args.join(' ').trimEnd() + "'")
      .join('\n');
    const prologue = [
      'shopt -s expand_aliases',
      settings?.aliases ?? initialAliases,
      settings?.functions || '',
      '(exit ' + (settings?.status || 0) + ')',
    ];
    const capture = `__studycka_session "$?" "$(alias)" "$(declare -F | while read -r _ _ fn; do type "$fn" | tail -n +2; done)"`;
    const script = [...prologue, line, capture].join('\n');
    const result = await state.bash.exec(script, {
      env: lab.shellEnv[host],
      cwd: lab.cwd,
      rawScript: true,
      signal,
      stdin,
    });
    lab.shellEnv[host] = result.env;
    if (host === lab.host) lab.cwd = result.env.PWD || lab.cwd;
    await persist(host, state);
    return result.stdout + result.stderr;
  }
  execute.incomplete = (script) => {
    try {
      machine(lab.host).bash.transform(script);
      return false;
    } catch (e) {
      return /unexpected EOF|got EOF|unterminated here-document|unexpected token `(?:fi|done|esac)'/.test(
        e.message,
      );
    }
  };
  execute.completePath = async (part, directoriesOnly) => {
    const { fs, ready } = machine(lab.host);
    await ready;
    const slash = part.lastIndexOf('/'),
      prefix = part.slice(0, slash + 1),
      base = part.slice(slash + 1);
    const directory = fs.resolvePath(lab.cwd, (prefix || '.').replace(/^~(?=\/|$)/, '/root'));
    try {
      const entries = await fs.readdirWithFileTypes(directory);
      const paths = [];
      for (const entry of entries) {
        if (!entry.name.startsWith(base) || (!base.startsWith('.') && entry.name.startsWith('.')))
          continue;
        const isDir =
          entry.isDirectory ||
          (entry.isSymbolicLink &&
            (await fs.stat(fs.resolvePath(directory, entry.name)).catch(() => null))?.isDirectory);
        if (isDir || !directoriesOnly) paths.push(prefix + entry.name + (isDir ? '/' : ''));
      }
      return paths;
    } catch {
      return [];
    }
  };
  return execute;
}
