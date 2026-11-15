import { clone, docs, dump, find, jsonpath, kind, list, matches, put } from './cluster.js';
export function pairs(values) {
  return Object.fromEntries(
    values.map((x) => {
      const i = x.indexOf('=');
      return [x.slice(0, i), x.slice(i + 1)];
    }),
  );
}
function age(timestamp, now) {
  const seconds = Math.max(0, Math.floor((now - Date.parse(timestamp)) / 1000));
  if (!Number.isFinite(seconds)) return '<unknown>';
  if (seconds < 60) return seconds + 's';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60)
    return minutes + 'm' + (minutes < 10 && seconds % 60 ? (seconds % 60) + 's' : '');
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return hours + 'h' + (hours < 8 && minutes % 60 ? (minutes % 60) + 'm' : '');
  const days = Math.floor(hours / 24);
  return days + 'd' + (days < 8 && hours % 24 ? (hours % 24) + 'h' : '');
}

function table(objects, wide, labels, allNamespaces) {
  if (!objects.length) return 'No resources found.';
  const kind = objects[0].kind;
  const fields = {
    Pod: ['READY', 'STATUS', 'RESTARTS'],
    Deployment: ['READY', 'AVAILABLE'],
    Node: ['STATUS'],
    Service: ['TYPE', 'PORT(S)'],
    Endpoints: ['ENDPOINTS'],
    PersistentVolumeClaim: ['STATUS'],
  };
  const headers = ['NAME', ...(fields[kind] || []), 'AGE'];
  if (allNamespaces) headers.unshift('NAMESPACE');
  if (wide && kind === 'Pod') headers.push('IP', 'NODE');
  if (labels) headers.push('LABELS');
  const now = Date.now();
  const rows = objects.map(({ metadata, spec = {}, status = {}, subsets }) => {
    const cells = [metadata.name];
    if (allNamespaces) cells.unshift(metadata.namespace);
    switch (kind) {
      case 'Pod': {
        const containers = status.containerStatuses;
        cells.push(
          containers.filter((c) => c.ready).length + '/' + containers.length,
          status.phase === 'Pending' && !status.message.startsWith('Failed')
            ? status.message
            : status.phase,
          containers.reduce((total, c) => total + c.restartCount, 0),
        );
        break;
      }
      case 'Deployment':
        cells.push(status.readyReplicas + '/' + status.replicas, status.readyReplicas);
        break;
      case 'Node':
        cells.push(
          (status.conditions[0].status === 'True' ? 'Ready' : 'NotReady') +
            (spec.unschedulable ? ',SchedulingDisabled' : ''),
        );
        break;
      case 'Service':
        cells.push(
          spec.type || 'ClusterIP',
          spec.ports
            .map((p) => p.port + (p.nodePort ? ':' + p.nodePort : '') + '/' + (p.protocol || 'TCP'))
            .join(','),
        );
        break;
      case 'Endpoints':
        cells.push(
          subsets
            .flatMap((s) => s.addresses.map((a) => a.ip + ':' + s.ports[0].targetPort))
            .join(',') || '<none>',
        );
        break;
      case 'PersistentVolumeClaim':
        cells.push(status.phase);
        break;
    }
    cells.push(age(metadata.creationTimestamp, now));
    if (wide && kind === 'Pod') cells.push(status.podIP || '<none>', spec.nodeName || '<none>');
    if (labels)
      cells.push(
        Object.entries(metadata.labels || {})
          .map(([k, v]) => k + '=' + v)
          .join(',') || '<none>',
      );
    return cells.map(String);
  });
  const widths = headers.map((header, i) =>
    rows.reduce((w, row) => Math.max(w, row[i].length), header.length),
  );
  return [headers, ...rows]
    .map((row) =>
      row.map((cell, i) => (i === row.length - 1 ? cell : cell.padEnd(widths[i]))).join('   '),
    )
    .join('\n');
}
function merge(o, p) {
  for (const [k, v] of Object.entries(p)) {
    if (['__proto__', 'constructor', 'prototype'].includes(k)) throw Error('Invalid key');
    if (v === null) delete o[k];
    else if (v && typeof v === 'object' && !Array.isArray(v)) {
      o[k] ||= {};
      merge(o[k], v);
    } else o[k] = v;
  }
  return o;
}
// Pod specs and PVC binding fields used by the repair labs require recreation.
function ensureMutable(previous, next) {
  if (!previous) return;
  const shape = (o) => {
    if (o.kind === 'PersistentVolumeClaim') return [o.spec.accessModes, o.spec.storageClassName];
    if (o.kind === 'Pod') {
      const spec = clone(o.spec);
      for (const c of [...(spec.containers || []), ...(spec.initContainers || [])]) delete c.image;
      return spec;
    }
  };
  if (JSON.stringify(shape(previous)) !== JSON.stringify(shape(next)))
    throw Error(
      'Field is immutable. Export the manifest, edit it, delete the resource and apply the file.',
    );
}
export function kubectl(s, argv, io = {}) {
  const args = [],
    positions = [],
    f = {},
    literals = [],
    extra = [];
  let after = false;
  const options = [
    '-n',
    '--namespace',
    '-o',
    '--output',
    '-f',
    '--filename',
    '--image',
    '--replicas',
    '--port',
    '--target-port',
    '--type',
    '--name',
    '--schedule',
    '--from-literal',
    '-l',
    '--selector',
    '--field-selector',
    '--clusterrole',
    '--role',
    '--serviceaccount',
    '--verb',
    '--resource',
    '--as',
    '-p',
    '--patch',
    '--dry-run',
    '--limits',
    '--requests',
    '-c',
    '--overrides',
    '--restart',
    '--rule',
    '--class',
    '--min',
    '--max',
    '--cpu-percent',
    '--cpu',
    '--sort-by',
    '--container',
    '--to-revision',
  ];
  for (let i = 0; i < argv.length; i++) {
    const x = argv[i];
    if (after) {
      extra.push(x);
      continue;
    }
    if (x === '--') {
      after = true;
      continue;
    }
    if (x.startsWith('-') && x !== '-') {
      const at = x.indexOf('='),
        k = at < 0 ? x : x.slice(0, at),
        v =
          at >= 0
            ? x.slice(at + 1)
            : options.includes(k) && !(k === '-p' && argv.includes('logs'))
              ? argv[++i]
              : true;
      f[k] = v;
      if (k === '--from-literal') literals.push(v);
    } else {
      positions.push(i);
      args.push(x);
    }
  }
  const [cmd, ...a] = args,
    ns = f['-n'] || f['--namespace'] || s.ns,
    out = f['-o'] || f['--output'],
    file = f['-f'] || f['--filename'];
  const target = (i = 0) => {
    const [type, name] = a[i].split('/');
    return [kind(type), name || a[i + 1]];
  };
  const obj = (i = 0) => {
    const [k, n] = target(i);
    return find(s, k, n, ns);
  };
  const create = (o, replace = false) => {
    if (f['--overrides']) merge(o, JSON.parse(f['--overrides']));
    if (f['--dry-run']) return out === 'json' ? JSON.stringify(o, null, 2) : dump(o);
    if (
      o.metadata.namespace ||
      ![
        'Node',
        'Namespace',
        'ClusterRole',
        'ClusterRoleBinding',
        'PersistentVolume',
        'StorageClass',
      ].includes(o.kind)
    )
      find(s, 'Namespace', o.metadata.namespace || ns);
    if (o.kind === 'Pod') {
      if (!o.spec?.containers?.length || o.spec.containers.some((c) => !c.name || !c.image))
        throw Error('Pod requires named containers with images');
      for (const quota of list(s, 'ResourceQuota', o.metadata.namespace || ns))
        for (const key of Object.keys(quota.spec.hard)) {
          const [group, resource] = key.split('.');
          if (
            ['requests', 'limits'].includes(group) &&
            o.spec.containers.some((c) => c.resources?.[group]?.[resource] == null)
          )
            throw Error('ResourceQuota requires ' + key);
        }
    }
    if (
      !replace &&
      list(s, o.kind, o.metadata.namespace || ns).some((x) => x.metadata.name === o.metadata.name)
    )
      throw Error('AlreadyExists: ' + o.metadata.name);
    if (replace)
      ensureMutable(
        list(s, o.kind, o.metadata.namespace || ns).find(
          (x) => x.metadata.name === o.metadata.name,
        ),
        o,
      );
    put(s, o, ns);
    return o.kind.toLowerCase() + '/' + o.metadata.name + (replace ? ' configured' : ' created');
  };
  if (cmd === 'autoscale') {
    const target = obj();
    if (target.kind !== 'Deployment') throw Error('Expected a Deployment');
    const min = Number(f['--min'] || 1),
      max = Number(f['--max']);
    const cpu = Number(String(f['--cpu-percent'] || f['--cpu'] || '80').replace('%', ''));
    if (![min, max, cpu].every(Number.isInteger) || min < 1 || max < min || max > 500 || cpu < 1)
      throw Error('Invalid scaling bounds or target');
    return create({
      apiVersion: 'autoscaling/v2',
      kind: 'HorizontalPodAutoscaler',
      metadata: { name: f['--name'] || target.metadata.name },
      spec: {
        scaleTargetRef: { apiVersion: 'apps/v1', kind: 'Deployment', name: target.metadata.name },
        minReplicas: min,
        maxReplicas: max,
        metrics: [
          {
            type: 'Resource',
            resource: { name: 'cpu', target: { type: 'Utilization', averageUtilization: cpu } },
          },
        ],
      },
    });
  }
  if (cmd === 'get' || cmd === 'describe') {
    const withResource = (resource) => argv.map((arg, i) => (i === positions[1] ? resource : arg));
    if (a[0] === 'all')
      return (
        kubectl(s, withResource('pods,services,deployments,daemonsets,jobs,cronjobs'), io)
          .split('\n')
          .filter((row) => row !== 'No resources found.')
          .join('\n') || 'No resources found.'
      );
    if (a[0]?.includes(','))
      return a[0]
        .split(',')
        .map((k) => kubectl(s, withResource(k), io))
        .join('\n');
    if (['events', 'event', 'ev'].includes(a[0])) {
      const name = f['--field-selector']?.match(/involvedObject.name=(.+)/)?.[1];
      const rows = (s.events || []).filter(
        (e) =>
          (!name || e.name === name) && (f['-A'] || f['--all-namespaces'] || e.namespace === ns),
      );
      return (
        rows
          .map((e) => [e.time, e.namespace, e.reason, 'pod/' + e.name, e.message].join('   '))
          .join('\n') || 'No events.'
      );
    }
    const [k, n] = target();
    let rows = n ? [find(s, k, n, ns)] : list(s, k, f['-A'] || f['--all-namespaces'] ? null : ns);
    if (f['--field-selector']) {
      for (const selector of f['--field-selector'].split(',')) {
        const match = selector.match(/^([\w.]+)(!=|==|=)(.*)$/);
        if (!match) throw Error('Invalid field selector: ' + selector);
        const [, field, operator, value] = match;
        rows = rows.filter((o) => (jsonpath(o, field) === value) !== (operator === '!='));
      }
    }
    if (f['-l'] || f['--selector'])
      rows = rows.filter((o) =>
        matches(o.metadata.labels, pairs((f['-l'] || f['--selector']).split(','))),
      );
    const data = n ? rows[0] : { apiVersion: 'v1', kind: 'List', items: rows };
    if (cmd === 'describe')
      return rows
        .map(
          (o) =>
            dump(o) +
            (o.spec?.initContainers
              ? 'Init Containers: ' +
                o.spec.initContainers.map((c) => c.name + ' ' + c.image).join(', ') +
                '\n'
              : '') +
            (k === 'Node' ? 'Taints: ' + JSON.stringify(o.spec.taints || []) : '') +
            '\nEvents: ' +
            ((s.events || [])
              .filter(
                (e) =>
                  k === 'Pod' && e.name === o.metadata.name && e.namespace === o.metadata.namespace,
              )
              .map((e) => e.reason + ' ' + e.message)
              .join('\n') ||
              o.status?.message ||
              '<none>'),
        )
        .join('\n');
    if (out?.startsWith('jsonpath=')) return jsonpath(data, out.slice(9));
    if (out === 'yaml') return dump(data);
    if (out === 'json') return JSON.stringify(data, null, 2);
    if (out === 'name') return rows.map((o) => k.toLowerCase() + '/' + o.metadata.name).join('\n');
    return table(
      rows,
      out === 'wide',
      f['--show-labels'],
      (f['-A'] || f['--all-namespaces']) && rows[0]?.metadata.namespace,
    );
  }
  if (file && ['create', 'replace', 'apply', 'delete'].includes(cmd)) {
    const content = file === '-' ? io.stdin : io.read(file);
    return docs(content)
      .flatMap((o) => (o.kind === 'List' ? o.items : [o]))
      .map((o) =>
        cmd === 'delete'
          ? kubectl(s, ['delete', o.kind, o.metadata.name, '-n', o.metadata.namespace || ns], io)
          : create(o, cmd !== 'create'),
      )
      .join('\n');
  }
  if (cmd === 'run' || cmd === 'create' || cmd === 'expose') {
    const k = cmd === 'run' ? 'Pod' : cmd === 'expose' ? 'Service' : kind(a[0]);
    const name =
      cmd === 'run'
        ? a[0]
        : cmd === 'expose'
          ? f['--name'] || obj().metadata.name
          : k === 'Secret' && a[1] === 'generic'
            ? a[2]
            : a[1];
    if (!name) throw Error('Name required');
    const o = {
      apiVersion:
        {
          Deployment: 'apps/v1',
          Job: 'batch/v1',
          CronJob: 'batch/v1',
          Role: 'rbac.authorization.k8s.io/v1',
          RoleBinding: 'rbac.authorization.k8s.io/v1',
          ClusterRole: 'rbac.authorization.k8s.io/v1',
          ClusterRoleBinding: 'rbac.authorization.k8s.io/v1',
        }[k] || 'v1',
      kind: k,
      metadata: { name },
    };
    const image = f['--image'],
      container = { name: k === 'Deployment' ? image?.split(/[:/]/).pop() : name, image };
    if (k === 'Deployment') container.name = image?.split('/').pop().split(':')[0];
    if (extra.length) container.command = extra;
    if (k === 'Pod') {
      o.metadata.labels = { run: name, ...pairs((f['-l'] || '').split(',').filter(Boolean)) };
      o.spec = { containers: [container], restartPolicy: f['--restart'] || 'Always' };
      if (f['--port']) container.ports = [{ containerPort: +f['--port'] }];
      for (const r of ['limits', 'requests'])
        if (f['--' + r]) {
          container.resources ||= {};
          container.resources[r] = pairs(f['--' + r].split(','));
        }
    }
    if (k === 'Deployment')
      o.spec = {
        replicas: Number(f['--replicas'] || 1),
        selector: { matchLabels: { app: name } },
        template: { metadata: { labels: { app: name } }, spec: { containers: [container] } },
      };
    if (k === 'Job' || k === 'CronJob') {
      const job = {
        template: { spec: { restartPolicy: 'Never', containers: [container] } },
        backoffLimit: 6,
      };
      o.spec = k === 'Job' ? job : { schedule: f['--schedule'], jobTemplate: { spec: job } };
    }
    if (k === 'Ingress') {
      const match = f['--rule']?.match(/^([^/]+)(\/[^=]*)=([^:]+):(\d+)$/);
      if (!match) throw Error('Expected --rule=HOST/PATH=SERVICE:PORT');
      const [, host, path, service, port] = match;
      o.apiVersion = 'networking.k8s.io/v1';
      o.spec = {
        ingressClassName: f['--class'],
        rules: [
          {
            host,
            http: {
              paths: [
                {
                  path: path.replace(/\*$/, '') || '/',
                  pathType: path.endsWith('*') ? 'Prefix' : 'Exact',
                  backend: { service: { name: service, port: { number: Number(port) } } },
                },
              ],
            },
          },
        ],
      };
    }
    if (k === 'Service') {
      const src = obj();
      o.spec = {
        type: f['--type'] || 'ClusterIP',
        selector: src.spec.selector?.matchLabels || src.metadata.labels,
        ports: [
          {
            port: +f['--port'],
            targetPort: Number(f['--target-port'] || f['--port']),
            ...(f['--type'] === 'NodePort' ? { nodePort: 30000 } : {}),
          },
        ],
      };
    }
    if (k === 'Secret' || k === 'ConfigMap') {
      o.data = pairs(literals);
      if (k === 'Secret') {
        o.type = 'Opaque';
        for (const key of Object.keys(o.data)) o.data[key] = btoa(o.data[key]);
      }
    }
    if (k.endsWith('RoleBinding')) {
      const [namespace, sa] = (f['--serviceaccount'] || '').split(':');
      o.subjects = [{ kind: 'ServiceAccount', name: sa, namespace }];
      o.roleRef = {
        apiGroup: 'rbac.authorization.k8s.io',
        kind: f['--role'] ? 'Role' : 'ClusterRole',
        name: f['--role'] || f['--clusterrole'],
      };
    }
    if (k.endsWith('Role'))
      o.rules = [
        {
          apiGroups: [''],
          resources: (f['--resource'] || '').split(','),
          verbs: (f['--verb'] || '').split(','),
        },
      ];
    return create(o);
  }
  if (cmd === 'auth' && a[0] === 'can-i') {
    const [, , namespace, sa] = (f['--as'] || '').split(':');
    if (!sa) return 'yes';
    return [...list(s, 'RoleBinding', ns), ...list(s, 'ClusterRoleBinding')].some(
      (b) =>
        b.subjects?.some((x) => x.name === sa && (x.namespace || ns) === namespace) &&
        list(s, b.roleRef.kind, ns)
          .find((r) => r.metadata.name === b.roleRef.name)
          ?.rules.some(
            (r) =>
              [a[1], '*'].some((v) => r.verbs.includes(v)) &&
              [a[2], '*'].some((v) => r.resources.includes(v)),
          ),
    )
      ? 'yes'
      : 'no';
  }
  if (cmd === 'logs') {
    const pods = f['-l']
      ? list(s, 'Pod', ns).filter((p) => matches(p.metadata.labels, pairs(f['-l'].split(','))))
      : [find(s, 'Pod', a[0], ns)];
    return pods
      .map((p) => {
        const container = p.spec.containers.find(
          (c) => !(f['-c'] || f['--container']) || c.name === (f['-c'] || f['--container']),
        );
        if (!container) throw Error('Container not found');
        if (
          (f['--previous'] || f['-p']) &&
          !p.status.containerStatuses.find((c) => c.name === container.name)?.restartCount
        )
          throw Error('Previous terminated container not found');
        if (/ImagePull|NeverPull/.test(p.status.message))
          throw Error('Container is waiting to start: ' + p.status.message);
        const echo = container.command
          ?.join(' ')
          .match(/\becho\s+([^;>&]+)/)?.[1]
          ?.trim()
          .replace(/^['"]|['"]$/g, '');
        return p.status.phase === 'Succeeded'
          ? p.status.message
          : p.status.message === 'CrashLoopBackOff'
            ? (echo || 'Starting...') + '\nProcess exited with code 1'
            : echo || (container.image.includes('nginx') ? 'nginx: starting worker processes' : '');
      })
      .join('\n');
  }
  if (cmd === 'exec') {
    const p = find(s, 'Pod', a[0], ns),
      c = p.spec.containers.find(
        (x) => !(f['-c'] || f['--container']) || x.name === (f['-c'] || f['--container']),
      );
    if (!c) throw Error('Container not found');
    if (p.status.phase !== 'Running') throw Error('Container is not running: ' + p.status.message);
    if (io.exec && extra[0] !== 'env')
      return io.exec(p, c, extra, !!(f['-it'] || f['-ti'] || f['-i'] || f['--stdin']));
    if (extra[0] === 'nslookup' && extra[1] === 'kubernetes')
      return p.spec.dnsPolicy === 'Default'
        ? 'nslookup: cannot resolve kubernetes'
        : 'Name: kubernetes.default.svc.cluster.local\nAddress: 10.43.0.1';
    if (extra[0] === 'env')
      return (c.env || [])
        .map((e) => {
          const r = e.valueFrom?.configMapKeyRef || e.valueFrom?.secretKeyRef;
          return (
            e.name +
            '=' +
            (r
              ? e.valueFrom.configMapKeyRef
                ? find(s, 'ConfigMap', r.name, ns).data[r.key]
                : atob(find(s, 'Secret', r.name, ns).data[r.key])
              : e.value)
          );
        })
        .join('\n');
    if (extra[0] === 'cat') {
      for (const writer of [...(p.spec.initContainers || []), ...p.spec.containers]) {
        const m = writer.command?.join(' ').match(/echo\s+([^;>]+?)\s*>>?\s*(\/[^; ]+)/);
        if (
          m &&
          writer.volumeMounts?.some((w) =>
            c.volumeMounts?.some(
              (r) => r.name === w.name && extra[1] === m[2].replace(w.mountPath, r.mountPath),
            ),
          )
        )
          return m[1];
      }
    }
    throw Error('Unsupported container command');
  }
  if (['cordon', 'uncordon', 'drain'].includes(cmd)) {
    const n = find(s, 'Node', a[0]);
    if (cmd === 'uncordon') delete n.spec.unschedulable;
    else n.spec.unschedulable = true;
    if (cmd === 'drain') {
      s.drained = a[0];
      for (const [key, assigned] of Object.entries(s.placements))
        if (assigned === a[0]) delete s.placements[key];
    }
    return 'node/' + a[0] + ' ' + cmd + ' completed';
  }
  if (cmd === 'config' && a[0] === 'set-context') {
    s.ns = ns;
    return 'Context updated';
  }
  if (cmd === 'rollout') {
    const d = obj(1),
      key = ns + '/' + d.metadata.name;
    if (a[0] === 'history')
      return (
        'REVISION  IMAGE\n' +
        [...(s.revisions[key] || []), d.spec.template]
          .map((t, i) => i + 1 + '  ' + t.spec.containers[0].image)
          .join('\n')
      );
    if (a[0] === 'undo') {
      const prev = s.revisions[key]?.pop();
      if (!prev) throw Error('No earlier revision');
      d.spec.template = prev;
      return 'deployment rolled back';
    }
    if (a[0] === 'status')
      return d.status.readyReplicas === d.spec.replicas
        ? 'deployment successfully rolled out'
        : 'Waiting for ready replicas';
  }
  if (cmd === 'set' && a[0] === 'image') {
    const o = obj(1),
      template = o.spec.template || o,
      key = ns + '/' + o.metadata.name;
    const changes = pairs(a.filter((x) => x.includes('=')));
    if (!template.spec.containers.some((c) => changes[c.name] || changes['*']))
      throw Error('Container not found');
    (s.revisions[key] ||= []).push(clone(template));
    for (const c of template.spec.containers) c.image = changes[c.name] || changes['*'] || c.image;
    return 'image updated';
  }
  if (cmd === 'taint') {
    const n = f['--all'] ? list(s, 'Node')[0] : obj(),
      token = a.at(-1),
      [key, value, effect] = token.replace(/-$/, '').split(/[=:]/);
    n.spec.taints = (n.spec.taints || []).filter((t) => t.key !== key);
    if (!token.endsWith('-')) n.spec.taints.push({ key, value, effect });
    if (!n.spec.taints.length) delete n.spec.taints;
    return 'node taint updated';
  }
  if (cmd === 'edit') {
    const o = obj();
    io.edit(o.kind + '/' + o.metadata.name, dump(o), (value) => {
      const [next] = docs(value);
      if (next.kind !== o.kind || next.metadata.name !== o.metadata.name)
        throw Error('Resource identity cannot change');
      ensureMutable(o, next);
      put(s, next, ns);
    });
    return '';
  }
  if (cmd === 'patch') {
    const o = obj(),
      next = clone(o);
    merge(next, docs(f['-p'] || f['--patch'])[0]);
    ensureMutable(o, next);
    put(s, next, ns);
    return 'resource patched';
  }
  if (cmd === 'scale') {
    obj().spec.replicas = Number(f['--replicas']);
    return 'deployment scaled';
  }
  if (cmd === 'label') {
    const o = obj(),
      labels = (o.metadata.labels ||= {});
    for (const x of a.slice(a[0].includes('/') ? 1 : 2)) {
      if (x.endsWith('-')) delete labels[x.slice(0, -1)];
      else Object.assign(labels, pairs([x]));
    }
    return 'resource labeled';
  }
  if (cmd === 'delete') {
    const o = obj();
    s.objects = s.objects.filter((x) => x !== o);
    return o.kind + '/' + o.metadata.name + ' deleted';
  }
  throw Error('Unsupported kubectl command: ' + cmd);
}
