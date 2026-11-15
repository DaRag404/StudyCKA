import { kubeadm } from './admin.js';
import { clone, docs, node, put, reconcile, find, installSystemResources } from './cluster.js';
import { kubectl } from './kubectl.js';

const config = '/etc/profile.d/k3s.sh',
  log = '/var/log/k3s-agent.log';
export function path(s, name = '~') {
  const parts =
    (name.replace(/^~(?=\/|$)/, '/root').startsWith('/') ? '' : s.cwd + '/') +
    name.replace(/^~(?=\/|$)/, '/root');
  const out = [];
  for (const p of parts.split('/')) {
    if (p === '..') out.pop();
    else if (p && p !== '.') out.push(p);
  }
  return '/' + out.join('/');
}
// Retain quoted arguments (including empty strings) and recognize operators only outside quotes.
function tokens(line) {
  const res = [];
  let word = '',
    q = '',
    started = false;
  const flush = () => {
    if (started) res.push({ word });
    word = '';
    started = false;
  };
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '\\' && q !== "'" && i + 1 < line.length) {
      word += line[++i];
      started = true;
      continue;
    }
    if (q) {
      if (c === q) q = '';
      else word += c;
      continue;
    }
    if (c === "'" || c === '"') {
      q = c;
      started = true;
      continue;
    }
    if (/\s/.test(c)) {
      flush();
      continue;
    }
    const op = line.slice(i).match(/^(2>\/dev\/null|2>&1|&&|\|\||>>|[>|;&])/);
    if (op) {
      flush();
      res.push({ op: op[0] });
      i += op[0].length - 1;
      continue;
    }
    word += c;
    started = true;
  }
  if (q) throw Error('Unclosed quote');
  flush();
  return res;
}
export function run(s, line, editor, stdin = '') {
  const files = s.host === 'worker' ? s.workerFiles : s.files;
  const read = (n) => {
    const p = path(s, n);
    if (!Object.hasOwn(files, p)) throw Error(n + ': No such file');
    return files[p];
  };
  const write = (n, v) => {
    files[path(s, n)] = v;
  };
  function one([cmd, ...a], input) {
    if (!cmd) return '';
    if (cmd === 'sudo') return one(a, input);
    if (cmd === 'kubectl' || cmd === 'k')
      return kubectl(s, a, { read, stdin: input, edit: editor });
    if (['vi', 'vim', 'nano'].includes(cmd)) {
      const p = path(s, a[0]);
      editor(p, files[p] || '', (v) => write(p, v));
      return '';
    }
    if (cmd === 'cat' || cmd === 'tail' || cmd === 'head') {
      const src =
        a
          .filter((x) => !x.startsWith('-') && !/^\d+$/.test(x))
          .map(read)
          .join('\n') || input;
      return cmd === 'cat'
        ? src
        : src
            .trimEnd()
            .split('\n')
            .slice(...(cmd === 'head' ? [0, 10] : [-10]))
            .join('\n');
    }
    if (cmd === 'pwd') return s.cwd;
    if (cmd === 'cd') {
      s.cwd = path(s, a[0]);
      return '';
    }
    if (cmd === 'ls') {
      const p = path(s, a.find((x) => !x.startsWith('-')) || s.cwd).replace(/\/$/, '') + '/';
      return [
        ...new Set(
          Object.keys(files)
            .filter((x) => x.startsWith(p))
            .map((x) => x.slice(p.length).split('/')[0]),
        ),
      ].join('  ');
    }
    if (cmd === 'cp' || cmd === 'mv') {
      write(a[1], read(a[0]));
      if (cmd === 'mv') delete files[path(s, a[0])];
      return '';
    }
    if (cmd === 'rm') {
      for (const p of a.filter((x) => !x.startsWith('-'))) delete files[path(s, p)];
      return '';
    }
    if (cmd === 'mkdir') {
      for (const n of a.filter((x) => !x.startsWith('-'))) files[path(s, n) + '/'] = '';
      return '';
    }
    if (cmd === 'true') return '';
    if (cmd === 'touch') {
      a.forEach((n) => {
        files[path(s, n)] ??= '';
      });
      return '';
    }
    if (cmd === 'echo' || cmd === 'printf')
      return a
        .filter((x) => x !== '-n')
        .join(' ')
        .replace(/\\n/g, '\n');
    if (cmd === 'grep') {
      const pos = a.findIndex((x) => !x.startsWith('-'));
      const content = a[pos + 1] ? read(a[pos + 1]) : input;
      return content
        .split('\n')
        .filter((x) => x.includes(a[pos]))
        .join('\n');
    }
    if (cmd === 'base64')
      return a.includes('-d') || a.includes('--decode') ? atob(input.trim()) : btoa(input);
    if (cmd === 'sed') {
      const expr = a.find((x) => x.startsWith('s')),
        delim = expr?.[1];
      if (!delim) throw Error('Expected sed substitution s/old/new/');
      const [, from, to, flags] = expr.split(delim);
      const n = a.at(-1),
        v = (n === expr ? input : read(n)).replace(
          new RegExp(from, flags?.includes('g') ? 'g' : ''),
          to,
        );
      if (a.includes('-i')) {
        write(n, v);
        return '';
      }
      return v;
    }
    if (cmd === 'whoami') return 'root';
    if (cmd === 'hostname') return s.host;
    if (cmd === 'history') return s.history.join('\n');
    if (cmd === 'ssh') {
      if (!['worker', 'root@worker'].includes(a.at(-1))) throw Error('Unknown host');
      find(s, 'Node', 'worker');
      s.host = 'worker';
      s.cwd = '/root';
      s.agentUrl = s.workerFiles[config];
      return 'Connected to worker';
    }
    if (cmd === 'exit') {
      s.host = 'cka-lab';
      s.cwd = '/root';
      return 'Returned to cka-lab';
    }
    if (cmd === 'ps')
      return (
        'PID USER COMMAND\n1 root init' +
        (s.host === 'worker' && s.agentRunning ? '\n24 root k3s agent' : '')
      );
    if ((cmd === '.' || cmd === 'source') && s.host === 'worker') {
      s.agentUrl = read(a[0]);
      return '';
    }
    if (cmd === 'k3s' && a[0] === 'agent' && s.host === 'worker') {
      const n = find(s, 'Node', 'worker');
      s.agentRunning = s.agentUrl?.includes(':6443');
      n.status.conditions[0].status = s.agentRunning ? 'True' : 'False';
      return s.agentRunning ? 'Agent connected' : 'Connection refused: ' + s.agentUrl;
    }
    if (cmd === 'clear') return '\x1bc';
    if (cmd === 'help')
      return 'Browser lab shell: kubectl (k), ls, cd, pwd, cat, echo, grep, sed, cp, mv, rm, base64, ssh, ps, head, tail, history.\nUse nano/vi FILE or kubectl edit KIND NAME to open the editor. Save with Ctrl+S. Pipes, redirects and <<EOF manifests are supported.';
    throw Error(cmd + ': command not found');
  }
  const t = tokens(line),
    outputs = [];
  let words = [],
    input = stdin,
    redirect = null,
    append = false;
  const flush = (pipe) => {
    let out = one(words, input);
    if (redirect) {
      write(
        redirect,
        (append ? files[path(s, redirect)] || '' : '') + out + (out.endsWith('\n') ? '' : '\n'),
      );
      out = '';
    }
    if (pipe) input = out;
    else {
      if (out) outputs.push(out);
      input = '';
    }
    words = [];
    redirect = null;
    append = false;
  };
  for (let i = 0; i < t.length; i++) {
    const { word, op } = t[i];
    if (!op) words.push(word);
    else if (op === '>' || op === '>>') {
      redirect = t[++i]?.word;
      if (!redirect) throw Error('Missing redirect target');
      append = op === '>>';
    } else if (op === '||') {
      try {
        flush(false);
        break;
      } catch {
        words = [];
        redirect = null;
        input = '';
      }
    } else if (['|', '&&', ';', '&'].includes(op)) flush(op === '|');
  }
  if (words.length) flush(false);
  reconcile(s);
  return outputs.join('\n');
}
export function setup(ex = {}) {
  const s = {
    objects: [],
    files: {},
    workerFiles: {},
    history: [],
    cwd: '/root',
    ns: 'default',
    host: 'cka-lab',
    placements: {},
    revisions: {},
  };
  node(s, 'cka-lab');
  put(s, { apiVersion: 'v1', kind: 'Namespace', metadata: { name: 'default' } });
  put(s, {
    apiVersion: 'storage.k8s.io/v1',
    kind: 'StorageClass',
    metadata: { name: 'local-path' },
    provisioner: 'rancher.io/local-path',
  });
  for (const p of ex.preconditions || []) {
    if (p.type === 'kubeadm') {
      s.kubeadmLab = true;
      s.objects = s.objects.filter((o) => o.kind !== 'Node');
      put(s, { apiVersion: 'v1', kind: 'Namespace', metadata: { name: 'kube-system' } });
      if (p.version) kubeadm(s, 'cka-lab', ['init', '--kubernetes-version', p.version]);
    } else if (p.type === 'cpu-load') (s.cpuLoad ||= {})[p.target] = p.millicores;
    else if (p.type === 'manifest') for (const o of docs(p.manifest)) put(s, o);
    else if (p.type === 'file') s.files[p.path] = p.content;
    else if (p.type === 'worker-node') {
      node(s, 'worker');
      s.agentRunning = true;
      s.workerFiles[config] = 'export K3S_URL=https://cka-lab:6443\n';
      s.workerFiles[log] = 'Agent connected';
    } else if (p.type === 'command') run(s, p.command);
    else if (p.type === 'command-on-worker') {
      if (p.command.startsWith('sed ')) {
        s.host = 'worker';
        run(s, p.command);
        s.host = 'cka-lab';
      } else if (p.command === 'pkill k3s || true') {
        s.agentRunning = false;
        find(s, 'Node', 'worker').status.conditions[0].status = 'False';
        s.workerFiles[log] = 'Agent stopped';
      } else throw Error('Unknown worker setup');
    } else if (p.type !== 'wait-for-worker-not-ready')
      throw Error('Unknown precondition ' + p.type);
  }
  if (s.kubeadmLab) {
    reconcile(s);
    return s;
  }
  return installSystemResources(s);
}
export function check(s, ex) {
  const results = ex.validation.map((v) => {
    let actual,
      passed = false;
    try {
      actual = kubectl(s, v.args);
      passed = v.match === 'contains' ? actual.includes(v.expect) : actual === v.expect;
    } catch (e) {
      actual = e.message;
    }
    return { actual, passed, expected: v.expect, description: v.description };
  });
  if (ex.id === '54') {
    const release = s.releases?.find((r) => r.name === 'shop' && r.ns === 'default');
    results.push({
      passed: release?.revision >= 2,
      actual: String(release?.revision || 0),
      expected: '2 or later',
      description: 'Helm release upgraded',
    });
  }
  if (ex.id === '47')
    results.push({
      actual: s.drained || 'not drained',
      expected: 'worker',
      passed: s.drained === 'worker',
      description: 'Worker was drained',
    });
  return { passed: results.every((r) => r.passed), results };
}
export function execute(s, line, editor, stdin) {
  const before = clone(s);
  try {
    return run(s, line, editor, stdin);
  } catch (e) {
    Object.assign(s, before);
    throw e;
  }
}
