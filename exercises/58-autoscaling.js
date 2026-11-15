StudyCKA.exercises.push({
  id: '58',
  title: 'Autoscale a Deployment',
  category: 'Workloads',
  difficulty: 'medium',
  order: 58,
  description:
    'Autoscale Deployment web between 1 and 5 replicas with a CPU utilization target of 50%. The simulated workload consumes 200m CPU in total. Each replica requests 100m. Verify the resulting replica count.',
  hints: [
    'Run `kubectl autoscale deployment web --min=1 --max=5 --cpu-percent=50`.',
    'Inspect `kubectl get hpa web -o yaml` and `kubectl get deploy web`.',
  ],
  preconditions: [
    {
      type: 'manifest',
      manifest: `apiVersion: apps/v1
kind: Deployment
metadata:
  name: web
spec:
  replicas: 1
  selector:
    matchLabels: {app: web}
  template:
    metadata:
      labels: {app: web}
    spec:
      containers:
      - name: nginx
        image: nginx:1.25
        resources:
          requests: {cpu: 100m}
`,
    },
    {
      type: 'cpu-load',
      target: 'default/web',
      millicores: 200,
    },
  ],
  validation: [
    {
      args: ['get', 'hpa', 'web', '-o', 'jsonpath={.spec.minReplicas}'],
      expect: '1',
      description: 'Minimum replicas',
    },
    {
      args: ['get', 'hpa', 'web', '-o', 'jsonpath={.spec.maxReplicas}'],
      expect: '5',
      description: 'Maximum replicas',
    },
    {
      args: [
        'get',
        'hpa',
        'web',
        '-o',
        'jsonpath={.spec.metrics[0].resource.target.averageUtilization}',
      ],
      expect: '50',
      description: 'CPU target',
    },
    {
      args: ['get', 'deploy', 'web', '-o', 'jsonpath={.status.readyReplicas}'],
      expect: '4',
      description: 'Deployment scaled to current demand',
    },
  ],
});
