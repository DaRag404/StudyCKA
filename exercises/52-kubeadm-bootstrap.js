StudyCKA.exercises.push({
  id: '52',
  title: 'Bootstrap a Cluster with kubeadm',
  category: 'Cluster Administration',
  difficulty: 'medium',
  order: 52,
  description:
    'Initialize a v1.34.0 control plane on cka-lab. Generate a join command and run it on worker. Verify both nodes are Ready.',
  hints: [
    'Run `kubeadm init --kubernetes-version v1.34.0`.',
    'Use `kubeadm token create --print-join-command`, then `ssh worker` and paste the printed command.',
  ],
  preconditions: [
    {
      type: 'kubeadm',
    },
  ],
  validation: [
    {
      args: ['get', 'node', 'cka-lab', '-o', 'jsonpath={.status.nodeInfo.kubeletVersion}'],
      expect: 'v1.34.0',
      description: 'Control plane initialized',
    },
    {
      args: ['get', 'node', 'worker', '-o', 'jsonpath={.status.conditions[0].status}'],
      expect: 'True',
      description: 'Worker joined',
    },
  ],
});
