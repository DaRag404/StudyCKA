import { pullImage, recordPodEvents } from './images.js';
import yaml from 'js-yaml';
import { staticPods, systemControllers, systemNamespace } from './rke2.js';

const groups = {
  HorizontalPodAutoscaler: 'horizontalpodautoscalers hpa',
  Ingress: 'ingresses ing',
  GatewayClass: 'gatewayclasses gc',
  Gateway: 'gateways gtw',
  HTTPRoute: 'httproutes',
  Pod: 'pods po',
  Deployment: 'deployments deploy',
  Namespace: 'namespaces ns',
  Service: 'services svc',
  ConfigMap: 'configmaps cm',
  Secret: 'secrets',
  Job: 'jobs',
  CronJob: 'cronjobs cj',
  Node: 'nodes no',
  PersistentVolume: 'persistentvolumes pv',
  PersistentVolumeClaim: 'persistentvolumeclaims pvc',
  StorageClass: 'storageclasses sc',
  DaemonSet: 'daemonsets ds',
  ResourceQuota: 'resourcequotas quota',
  ServiceAccount: 'serviceaccounts sa',
  Role: 'roles',
  RoleBinding: 'rolebindings',
  ClusterRole: 'clusterroles',
  ClusterRoleBinding: 'clusterrolebindings',
  NetworkPolicy: 'networkpolicies netpol',
  Endpoints: 'ep',
};
export function kind(s) {
  const k = Object.keys(groups).find((k) =>
    [k.toLowerCase(), ...groups[k].split(' ')].includes(s?.toLowerCase()),
  );
  if (!k) throw Error('Unknown resource type: ' + s);
  return k;
}
const globalKinds = [
  'Node',
  'Namespace',
  'PersistentVolume',
  'StorageClass',
  'GatewayClass',
  'ClusterRole',
  'ClusterRoleBinding',
];
export const clone = (x) => JSON.parse(JSON.stringify(x));
export const matches = (labels, selector) =>
  Object.entries(selector || {}).every(([k, v]) => labels?.[k] === v);
export function put(s, o, ns = s.ns) {
  if (!o?.kind || !o.metadata?.name) throw Error('Manifest requires kind and metadata.name');
  kind(o.kind);
  if (!globalKinds.includes(o.kind)) o.metadata.namespace ||= ns;
  const i = s.objects.findIndex(
    (x) =>
      x.kind === o.kind &&
      x.metadata.name === o.metadata.name &&
      x.metadata.namespace === o.metadata.namespace,
  );
  o.metadata.creationTimestamp =
    i < 0 ? new Date().toISOString() : s.objects[i].metadata.creationTimestamp;
  if (i < 0) s.objects.push(o);
  else s.objects[i] = o;
  return o;
}
export function node(s, name) {
  return put(s, {
    apiVersion: 'v1',
    kind: 'Node',
    metadata: { name, labels: { 'kubernetes.io/hostname': name } },
    spec: {},
    status: { conditions: [{ type: 'Ready', status: 'True' }] },
  });
}
export const docs = (str) => yaml.loadAll(str, { schema: yaml.JSON_SCHEMA }).filter(Boolean);
export const dump = (o) => yaml.dump(o, { noRefs: true, lineWidth: -1 });
export function list(s, k, ns = s.ns) {
  return s.objects.filter(
    (x) => x.kind === k && (!ns || !x.metadata.namespace || x.metadata.namespace === ns),
  );
}
export function find(s, k, n, ns = s.ns) {
  const o = list(s, k, ns).find((x) => x.metadata.name === n);
  if (!o) throw Error(k + ' "' + n + '" not found');
  return o;
}
function schedule(p, nodes, index) {
  const sp = p.spec;
  const eligible = nodes.filter(
    (n) =>
      n.status.conditions[0].status === 'True' &&
      (!sp.nodeName || sp.nodeName === n.metadata.name) &&
      (!n.spec.unschedulable || sp.nodeName === n.metadata.name) &&
      matches(n.metadata.labels, sp.nodeSelector) &&
      (n.spec.taints || []).every((t) =>
        (sp.tolerations || []).some(
          (x) =>
            (x.key === t.key || (!x.key && x.operator === 'Exists')) &&
            (x.operator === 'Exists' || x.value === t.value) &&
            (!x.effect || x.effect === t.effect),
        ),
      ) &&
      (
        sp.affinity?.nodeAffinity?.requiredDuringSchedulingIgnoredDuringExecution
          ?.nodeSelectorTerms || [{}]
      ).some((term) =>
        (term.matchExpressions || []).every((x) => x.values?.includes(n.metadata.labels[x.key])),
      ),
  );
  return eligible[index % eligible.length]?.metadata.name;
}
function podStatus(s, p, index) {
  const ns = p.metadata.namespace,
    sp = p.spec,
    cs = sp.containers || [],
    nodeName = schedule(p, list(s, 'Node'), index);
  let reason = nodeName
    ? ''
    : 'FailedScheduling: no node matches node selector, affinity or tolerations';
  for (const v of sp.volumes || []) {
    if (v.secret && !list(s, 'Secret', ns).some((x) => x.metadata.name === v.secret.secretName))
      reason = 'FailedMount: secret not found';
    if (
      v.persistentVolumeClaim &&
      !list(s, 'PersistentVolumeClaim', ns).some(
        (x) => x.metadata.name === v.persistentVolumeClaim.claimName && x.status.phase === 'Bound',
      )
    )
      reason = 'FailedScheduling: unbound PersistentVolumeClaim';
  }
  for (const c of [...(sp.initContainers || []), ...cs]) {
    if (nodeName) reason = pullImage(s, nodeName, c.image, c.imagePullPolicy) || reason;
    if (c.command?.join(' ').includes('exit 1')) reason = 'CrashLoopBackOff';
    if (c.resources?.limits?.memory === '4Mi') reason = 'OOMKilled';
    if (c.livenessProbe?.httpGet?.port === 9090) reason = 'Liveness probe failed';
    for (const e of c.env || [])
      for (const [field, k] of [
        ['configMapKeyRef', 'ConfigMap'],
        ['secretKeyRef', 'Secret'],
      ]) {
        const r = e.valueFrom?.[field];
        if (
          r &&
          list(s, k, ns).find((x) => x.metadata.name === r.name)?.data?.[r.key] === undefined
        )
          reason = "CreateContainerConfigError: couldn't find key " + r.key;
      }
    if ((c.volumeMounts || []).some((m) => !sp.volumes?.some((v) => v.name === m.name)))
      reason = 'FailedMount: unknown volume';
  }
  const running = !reason;
  if (cs.some((c) => c.readinessProbe?.httpGet?.path === '/wrong'))
    reason = 'Readiness probe failed';
  return {
    phase: running ? 'Running' : 'Pending',
    message: reason || 'Scheduled and started',
    containerStatuses: cs.map((c) => ({
      name: c.name,
      ready: !reason,
      restartCount: /OOMKilled|Liveness|CrashLoop/.test(reason) ? 1 : 0,
    })),
    hostIP: nodeName,
    podIP: nodeName ? '10.42.0.' + (index + 2) : undefined,
  };
}
// Reconcile controller-owned objects and observed status after each command.
export function installSystemResources(s) {
  if (s.rke2ProfileVersion) return s;
  for (const resource of systemControllers()) {
    const { name, namespace } = resource.metadata;
    if (!list(s, resource.kind, namespace).some((o) => o.metadata.name === name)) put(s, resource);
  }
  s.rke2ProfileVersion = 1;
  reconcile(s);
  return s;
}

export function reconcile(s) {
  const nodes = list(s, 'Node');
  const generatedTimes = new Map();
  const keyOf = (o) => [o.kind, o.metadata.namespace, o.metadata.name].join('/');
  s.objects = s.objects.filter((o) => {
    if (o.kind !== 'Endpoints' && !o.metadata.ownerReferences?.some((r) => r.controller))
      return true;
    generatedTimes.set(keyOf(o), o.metadata.creationTimestamp);
    return false;
  });
  if (
    s.rke2ProfileVersion &&
    list(s, 'Namespace').some((o) => o.metadata.name === systemNamespace)
  ) {
    for (const n of nodes) {
      for (const pod of staticPods(n.metadata.name)) {
        if (!list(s, 'Pod', systemNamespace).some((p) => p.metadata.name === pod.metadata.name))
          put(s, pod);
      }
    }
  }
  for (const c of list(s, 'PersistentVolumeClaim', null)) {
    const pv = list(s, 'PersistentVolume').find(
      (p) =>
        (p.spec.storageClassName || '') === (c.spec.storageClassName || '') &&
        c.spec.accessModes?.every((m) => p.spec.accessModes.includes(m)),
    );
    c.status = {
      phase:
        pv ||
        c.spec.storageClassName === 'local-path' ||
        (!c.spec.storageClassName && !list(s, 'PersistentVolume').length)
          ? 'Bound'
          : 'Pending',
    };
  }
  for (const hpa of list(s, 'HorizontalPodAutoscaler', null)) {
    const target = list(s, 'Deployment', hpa.metadata.namespace).find(
      (d) => d.metadata.name === hpa.spec.scaleTargetRef.name,
    );
    if (!target) continue;
    const utilization = hpa.spec.metrics?.[0]?.resource?.target?.averageUtilization;
    const requests = target.spec.template.spec.containers.map((c) => c.resources?.requests?.cpu);
    const request = requests.every(Boolean)
      ? requests.reduce(
          (total, cpu) =>
            total + (String(cpu).endsWith('m') ? parseFloat(cpu) : Number(cpu) * 1000),
          0,
        )
      : 0;
    const load = s.cpuLoad?.[target.metadata.namespace + '/' + target.metadata.name];
    const desired =
      load != null && request && utilization
        ? Math.ceil(load / ((request * utilization) / 100))
        : target.spec.replicas || 1;
    target.spec.replicas = Math.min(
      hpa.spec.maxReplicas,
      Math.max(hpa.spec.minReplicas || 1, desired),
    );
    hpa.status = { desiredReplicas: target.spec.replicas };
  }
  for (const d of s.objects.filter((o) => ['Deployment', 'DaemonSet'].includes(o.kind))) {
    const count = d.kind === 'DaemonSet' ? nodes.length : (d.spec.replicas ?? 1);
    if (!Number.isInteger(count) || count < 0 || count > 500)
      throw Error('Replica count must be between 0 and 500');
    let ready = 0;
    for (let i = 0; i < count; i++) {
      const p = clone(d.spec.template);
      p.apiVersion = 'v1';
      p.kind = 'Pod';
      p.metadata = {
        ...p.metadata,
        namespace: d.metadata.namespace,
        name: d.metadata.name + '-lab-' + (i + 1),
        ownerReferences: [{ kind: d.kind, name: d.metadata.name, controller: true }],
      };
      const key = p.metadata.namespace + '/' + p.metadata.name;
      const assigned = s.placements[key];
      if (d.kind === 'DaemonSet') p.spec.nodeName = nodes[i].metadata.name;
      else if (assigned && nodes.some((n) => n.metadata.name === assigned))
        p.spec.nodeName = assigned;
      p.status = podStatus(s, p, i);
      if (p.status.hostIP) s.placements[key] = p.spec.nodeName = p.status.hostIP;
      if (p.status.containerStatuses.every((c) => c.ready)) ready++;
      put(s, p);
    }
    d.status =
      d.kind === 'DaemonSet' ? { numberReady: ready } : { readyReplicas: ready, replicas: count };
  }
  for (const j of list(s, 'CronJob', null)) {
    put(s, {
      apiVersion: 'batch/v1',
      kind: 'Job',
      metadata: {
        namespace: j.metadata.namespace,
        name: j.metadata.name + '-1',
        ownerReferences: [{ kind: 'CronJob', name: j.metadata.name, controller: true }],
      },
      spec: clone(j.spec.jobTemplate.spec),
    });
  }
  for (const j of list(s, 'Job', null)) {
    const p = clone(j.spec.template);
    p.apiVersion = 'v1';
    p.kind = 'Pod';
    p.metadata = {
      name: j.metadata.name + '-1',
      namespace: j.metadata.namespace,
      labels: { 'job-name': j.metadata.name },
      ownerReferences: [{ kind: 'Job', name: j.metadata.name, controller: true }],
    };
    p.status = podStatus(s, p, 0);
    if (p.status.phase === 'Running') {
      p.status.phase = 'Succeeded';
      p.status.message =
        p.spec.containers[0].command?.join(' ').replace(/^.*?echo /, '') || 'Completed';
      j.status = { succeeded: 1 };
    }
    put(s, p);
  }
  list(s, 'Pod', null).forEach((p, i) => {
    if (!p.metadata.ownerReferences) {
      p.status = podStatus(s, p, i);
      if (p.status.hostIP) p.spec.nodeName = p.status.hostIP;
    }
  });
  // Host-network pods share their node's IP; other pods have distinct cluster IPs.
  const nodeIPs = new Map(nodes.map((n, i) => [n.metadata.name, '192.168.122.' + (10 + i)]));
  list(s, 'Pod', null).forEach((p, i) => {
    recordPodEvents(s, p);
    if (!p.status.hostIP) return;
    p.status.hostIP = nodeIPs.get(p.spec.nodeName);
    p.status.podIP = p.spec.hostNetwork
      ? p.status.hostIP
      : '10.42.' + Math.floor(i / 250) + '.' + (2 + (i % 250));
  });
  for (const svc of list(s, 'Service', null)) {
    const pods = list(s, 'Pod', svc.metadata.namespace).filter(
      (p) =>
        matches(p.metadata.labels, svc.spec.selector) &&
        p.status.containerStatuses.every((c) => c.ready),
    );
    put(s, {
      apiVersion: 'v1',
      kind: 'Endpoints',
      metadata: { ...svc.metadata },
      subsets: pods.length
        ? [{ addresses: pods.map((p) => ({ ip: p.status.podIP })), ports: svc.spec.ports }]
        : [],
    });
  }
  for (const route of list(s, 'HTTPRoute', null)) {
    const ns = route.metadata.namespace;
    const parents = (route.spec.parentRefs || []).map((ref) => {
      const gateway = list(s, 'Gateway', ref.namespace || ns).find(
        (g) => g.metadata.name === ref.name,
      );
      const accepted =
        gateway?.spec.listeners?.some(
          (l) => l.protocol === 'HTTP' && (!ref.sectionName || ref.sectionName === l.name),
        ) && list(s, 'GatewayClass').some((c) => c.metadata.name === gateway.spec.gatewayClassName);
      const resolved = route.spec.rules?.every((r) =>
        r.backendRefs?.every((b) =>
          list(s, 'Service', ns).some(
            (svc) => svc.metadata.name === b.name && svc.spec.ports.some((p) => p.port === b.port),
          ),
        ),
      );
      return {
        parentRef: ref,
        conditions: [
          { type: 'Accepted', status: accepted ? 'True' : 'False' },
          { type: 'ResolvedRefs', status: resolved ? 'True' : 'False' },
        ],
      };
    });
    route.status = { parents };
  }
  for (const object of s.objects) {
    const key = keyOf(object);
    if (generatedTimes.has(key)) object.metadata.creationTimestamp = generatedTimes.get(key);
  }
}
export function jsonpath(o, expr) {
  const path = expr
    .replace(/^\{\.?|\}$/g, '')
    .replace(/\[\?\(@\.type==["']Ready["']\)\]/g, '[0]')
    .replace(/\[(\d+)\]/g, '.$1');
  const v = path
    .split('.')
    .filter(Boolean)
    .reduce((x, key) => x?.[key], o);
  return v == null ? '' : typeof v === 'object' ? JSON.stringify(v) : String(v);
}
