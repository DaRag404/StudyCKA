(() => {
  'use strict';
  const tags = {
    nginx: ['latest', 'alpine', '1.24', '1.25', '1.26', '1.27'],
    busybox: ['latest', '1.35', '1.36'],
    alpine: ['latest', '3.19', '3.20'],
    redis: ['latest', '7', '7-alpine'],
    httpd: ['latest', '2.4'],
  };
  for (const component of [
    'etcd',
    'kubernetes',
    'coredns',
    'k8s-metrics-server',
    'calico',
    'flannel',
  ])
    tags['rancher/hardened-' + component] = ['latest'];

  function reference(image) {
    const name = (image || '').replace(/^docker\.io\/(?:library\/)?/, '');
    return name.split('/').at(-1).includes(':') ? name : name + ':latest';
  }
  function pullImage(lab, host, image, policy) {
    const ref = reference(image);
    const cache = ((lab.images ||= {})[host] ||= []);
    if (cache.includes(ref) && policy !== 'Always') return '';
    if (policy === 'Never') return 'ErrImageNeverPull';
    const colon = ref.lastIndexOf(':');
    if (
      !Object.hasOwn(tags, ref.slice(0, colon)) ||
      !tags[ref.slice(0, colon)].includes(ref.slice(colon + 1))
    )
      return 'ImagePullBackOff';
    if (!cache.includes(ref)) cache.push(ref);
    return '';
  }
  function crictl(lab, host, [verb, arg]) {
    const cache = ((lab.images ||= {})[host] ||= []);
    if (verb === 'images')
      return [
        'IMAGE                              TAG',
        ...cache
          .filter((ref) => !arg || ref.startsWith(arg))
          .sort()
          .map((ref) => {
            const colon = ref.lastIndexOf(':');
            return ref.slice(0, colon).padEnd(35) + ref.slice(colon + 1);
          }),
      ].join('\n');
    if (verb === 'pull' && arg) {
      if (pullImage(lab, host, arg, 'Always')) throw Error('manifest unknown: ' + arg);
      return 'Image is up to date for ' + reference(arg);
    }
    if (verb === 'rmi' && cache.includes(reference(arg))) {
      cache.splice(cache.indexOf(reference(arg)), 1);
      return 'Deleted: ' + reference(arg);
    }
    throw Error('Usage: crictl images [image] | pull IMAGE | rmi IMAGE');
  }

  function recordPodEvents(lab, pod) {
    if (pod.metadata.namespace === 'kube-system') return;
    const { name, namespace } = pod.metadata;
    const signature = [pod.status.message, ...pod.spec.containers.map((c) => c.image)].join('/');
    const events = (lab.events ||= []);
    const last = events.findLast((e) => e.name === name && e.namespace === namespace);
    if (last?.signature === signature) return;
    const add = (reason, message) =>
      events.push({ name, namespace, signature, reason, message, time: new Date().toISOString() });
    if (/CrashLoop|OOMKilled|Liveness/.test(pod.status.message)) {
      add('Killing', pod.status.message);
      add('BackOff', 'Back-off restarting failed container');
    } else if (pod.status.message === 'ImagePullBackOff') {
      add('Failed', 'Failed to pull image: ' + pod.spec.containers.map((c) => c.image).join(', '));
      add('BackOff', 'Back-off pulling image');
    } else if (pod.status.phase === 'Running') {
      add('Pulled', 'Container images available on node');
      add('Started', 'Started container ' + pod.spec.containers.map((c) => c.name).join(', '));
    } else add('Warning', pod.status.message);
    if (events.length > 200) events.splice(0, events.length - 200);
  }

  Object.assign(StudyCKA, { pullImage, crictl, recordPodEvents });
})();
