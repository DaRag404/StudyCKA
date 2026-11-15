StudyCKA.exercises.push({
  id: '56',
  title: 'Expose a Service with Ingress',
  category: 'Services & Networking',
  difficulty: 'medium',
  order: 56,
  description:
    'Create an Ingress named shop using class nginx. Route shop.lab/ and all paths beneath it to Service web on port 80.',
  hints: ['Use `kubectl create ingress shop --class=nginx --rule="shop.lab/*=web:80"`.'],
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
      type: 'manifest',
      manifest: `apiVersion: v1
kind: Service
metadata: {name: web}
spec:
  selector: {app: web}
  ports: [{port: 80, targetPort: 80}]
`,
    },
  ],
  validation: [
    {
      args: ['get', 'ing', 'shop', '-o', 'jsonpath={.spec.ingressClassName}'],
      expect: 'nginx',
      description: 'Ingress class',
    },
    {
      args: ['get', 'ing', 'shop', '-o', 'jsonpath={.spec.rules[0].host}'],
      expect: 'shop.lab',
      description: 'Host matches',
    },
    {
      args: ['get', 'ing', 'shop', '-o', 'jsonpath={.spec.rules[0].http.paths[0].path}'],
      expect: '/',
      description: 'HTTP route path',
    },
    {
      args: ['get', 'ing', 'shop', '-o', 'jsonpath={.spec.rules[0].http.paths[0].pathType}'],
      expect: 'Prefix',
      description: 'HTTP route pathType',
    },
    {
      args: [
        'get',
        'ing',
        'shop',
        '-o',
        'jsonpath={.spec.rules[0].http.paths[0].backend.service.name}',
      ],
      expect: 'web',
      description: 'HTTP route backend.service.name',
    },
    {
      args: [
        'get',
        'ing',
        'shop',
        '-o',
        'jsonpath={.spec.rules[0].http.paths[0].backend.service.port.number}',
      ],
      expect: '80',
      description: 'HTTP route backend.service.port.number',
    },
  ],
});
