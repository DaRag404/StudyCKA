// Representative RKE2 installation with Canal. Add-ons are configurable in real clusters.
export const systemNamespace = 'kube-system';
const tolerations = [{ operator: 'Exists' }];
const container = (name, image) => ({ name, image });

export function systemControllers() {
  function workload(kind, name, labels, containers, hostNetwork = false) {
    return {
      apiVersion: 'apps/v1',
      kind,
      metadata: { name, namespace: systemNamespace, labels },
      spec: {
        ...(kind === 'Deployment' ? { replicas: 1 } : {}),
        selector: { matchLabels: labels },
        template: { metadata: { labels }, spec: { containers, tolerations, hostNetwork } },
      },
    };
  }
  const dnsLabels = { 'k8s-app': 'kube-dns' };
  return [
    { apiVersion: 'v1', kind: 'Namespace', metadata: { name: systemNamespace } },
    workload('Deployment', 'rke2-coredns-rke2-coredns', dnsLabels, [
      container('coredns', 'rancher/hardened-coredns'),
    ]),
    workload('Deployment', 'rke2-metrics-server', { 'app.kubernetes.io/name': 'metrics-server' }, [
      container('metrics-server', 'rancher/hardened-k8s-metrics-server'),
    ]),
    workload(
      'DaemonSet',
      'rke2-canal',
      { 'k8s-app': 'canal' },
      [
        container('calico-node', 'rancher/hardened-calico'),
        container('kube-flannel', 'rancher/hardened-flannel'),
      ],
      true,
    ),
    {
      apiVersion: 'v1',
      kind: 'Service',
      metadata: {
        name: 'rke2-coredns-rke2-coredns',
        namespace: systemNamespace,
        labels: dnsLabels,
      },
      spec: {
        type: 'ClusterIP',
        clusterIP: '10.43.0.10',
        selector: dnsLabels,
        ports: ['UDP', 'TCP'].map((protocol) => ({
          name: 'dns-' + protocol.toLowerCase(),
          port: 53,
          targetPort: 53,
          protocol,
        })),
      },
    },
  ];
}

export function staticPods(nodeName) {
  const components =
    nodeName === 'cka-lab'
      ? ['etcd', 'kube-apiserver', 'kube-controller-manager', 'kube-scheduler', 'kube-proxy']
      : ['kube-proxy'];
  return components.map((component) => ({
    apiVersion: 'v1',
    kind: 'Pod',
    metadata: {
      name: component + '-' + nodeName,
      namespace: systemNamespace,
      labels: {
        component,
        ...(component === 'kube-proxy' ? { 'k8s-app': 'kube-proxy' } : { tier: 'control-plane' }),
      },
      annotations: { 'kubernetes.io/config.source': 'file' },
    },
    spec: {
      nodeName,
      hostNetwork: true,
      tolerations,
      containers: [
        container(
          component,
          component === 'etcd' ? 'rancher/hardened-etcd' : 'rancher/hardened-kubernetes',
        ),
      ],
    },
  }));
}
