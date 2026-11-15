import './load.mjs';
const { createSession, setup, check, dump, reconcile } = StudyCKA;
import { test } from 'node:test';
const { load } = globalThis.jsyaml;
import assert from 'node:assert/strict';
const { exercises } = StudyCKA;
for (const ex of exercises)
  test(ex.id + ' ' + ex.title, async () => {
    const s = setup(ex);
    let editor;
    const shell = createSession(s, (_program, name, value, commit) => editor(name, value, commit));
    const cmd = async (line, input) =>
      (await shell(input ? line + " <<'EOF'\n" + input + 'EOF' : line)).trimEnd();
    const k = (line) => cmd('kubectl ' + line);
    const execute = async (line, edit) => {
      editor = edit;
      await cmd(line);
    };
    assert.equal(check(s, ex).passed, false, 'fresh exercise must require work');
    const edit = async (target, fn) =>
      await execute('kubectl edit ' + target, (_, v, commit) => {
        const o = load(v);
        fn(o);
        commit(dump(o));
      });
    const recreate = async (target, fn) => {
      await k('get ' + target + ' -o yaml > fix.yaml');
      await execute('nano fix.yaml', (_, v, commit) => {
        const o = load(v);
        fn(o);
        commit(dump(o));
      });
      await k('delete ' + target);
      await k('apply -f fix.yaml');
    };
    const file = async (name, replacements) => {
      await execute('nano ' + name, (_, v, commit) => {
        for (const [from, to] of Object.entries(replacements)) v = v.replaceAll(from, to);
        commit(v);
      });
      await k('apply -f ' + name);
    };
    const apply = async (kind, name, spec, ns = 'default') =>
      await cmd(
        'kubectl apply -f -',
        dump({
          apiVersion: kind === 'DaemonSet' ? 'apps/v1' : 'v1',
          kind,
          metadata: { name, namespace: ns },
          spec,
        }),
      );
    const nginx = { name: 'nginx', image: 'nginx:1.25' };
    switch (+ex.id) {
      case 1:
        await k('run nginx --image=nginx:1.25');
        break;
      case 2:
        await k('create deployment web --image=nginx:1.25 --replicas=3');
        break;
      case 3:
        await k('scale deployment web --replicas=5');
        break;
      case 4:
        await k('expose deployment web --port=80 --target-port=80');
        break;
      case 5:
        await k('create namespace staging');
        await k('run nginx --image=nginx:1.25 -n staging');
        break;
      case 6:
        await k('create cm app-config --from-literal=APP_ENV=production');
        await file('pod.yaml', { '<configmap-name>': 'app-config', '<key>': 'APP_ENV' });
        assert.equal(await k('exec app -- env | grep APP_ENV'), 'APP_ENV=production');
        break;
      case 7:
        await k('create secret generic db-secret --from-literal=password=mysecretpassword');
        await file('pod.yaml', { '<secret-name>': 'db-secret', '<key>': 'password' });
        assert.equal(await k('exec db-client -- env'), 'DB_PASSWORD=mysecretpassword');
        break;
      case 8:
        await file('pod.yaml', {
          '<cpu-request>': '100m',
          '<cpu-limit>': '200m',
          '<memory-limit>': '256Mi',
          '<memory-request>': '128Mi',
        });
        break;
      case 9:
        await file('pod.yaml', {
          '<port>': '80',
          '<period>': '10',
          '<path>': '/',
          '<initial-delay>': '5',
        });
        break;
      case 10:
        await k('label deployment web tier=frontend');
        await k('create deployment api --image=nginx:1.25');
        await k('label deployment api tier=backend');
        break;
      case 11:
        await file('pod.yaml', { '<command>': 'sh", "-c", "echo Initializing' });
        break;
      case 12:
        await file('job.yaml', {
          '<command>': 'sh", "-c", "echo Hello from batch job',
          '<completions>': '1',
          '<backoff-limit>': '3',
        });
        assert.equal(await k('logs -l job-name=batch-job'), 'Hello from batch job');
        break;
      case 13:
        await file('cronjob.yaml', {
          '<cron-schedule>': '*/1 * * * *',
          '<command>': 'date; echo Hello from CronJob',
        });
        break;
      case 14:
        await file('pvc.yaml', { '<access-mode>': 'ReadWriteOnce', '<storage>': '500Mi' });
        await file('pod.yaml', { '<mount-path>': '/usr/share/nginx/html' });
        break;
      case 15:
        await k('set image deployment/web nginx=nginx:1.25');
        await edit(
          'deploy web',
          (d) =>
            (d.spec.strategy = {
              type: 'RollingUpdate',
              rollingUpdate: { maxSurge: 1, maxUnavailable: 0 },
            }),
        );
        break;
      case 16:
        await k('get pod broken-pod -o yaml > fix.yaml');
        await execute('vi fix.yaml', (_, v, commit) => {
          const o = load(v);
          delete o.spec.containers[0].command;
          commit(dump(o));
        });
        await k('delete pod broken-pod');
        await k('apply -f fix.yaml');
        break;
      case 17:
        await k('set image deployment/web nginx=nginx:1.25');
        break;
      case 18:
        await edit('svc web-svc', (o) => (o.spec.selector.app = 'nginx'));
        assert.match(await k('get endpoints web-svc'), /10\.42/);
        break;
      case 19:
        await k(
          'create clusterrolebinding pod-reader-binding --clusterrole=pod-reader --serviceaccount=default:dev-sa',
        );
        break;
      case 20:
        await k('taint node cka-lab env=production:NoSchedule-');
        break;
      case 21:
        await k('delete pvc data-pvc');
        await file('pvc.yaml', { '<storage-class>': 'local-path' });
        break;
      case 22:
        await recreate(
          'pod probe-pod',
          (o) => (o.spec.containers[0].livenessProbe.httpGet.port = 80),
        );
        break;
      case 23:
        await recreate(
          'pod memory-pod',
          (o) =>
            (o.spec.containers[0].resources = {
              requests: { memory: '32Mi' },
              limits: { memory: '64Mi' },
            }),
        );
        break;
      case 24:
        await recreate('pod api-pod', (o) => (o.spec.serviceAccountName = 'api-sa'));
        break;
      case 25:
        await file('networkpolicy.yaml', { '<port>': '80', '<app-label>': 'web' });
        break;
      case 26:
        await apply('DaemonSet', 'log-collector', {
          selector: { matchLabels: { app: 'log' } },
          template: { metadata: { labels: { app: 'log' } }, spec: { containers: [nginx] } },
        });
        break;
      case 27:
        await edit('svc web-svc', (o) => (o.spec.ports[0].targetPort = 80));
        break;
      case 28:
        await k('rollout undo deployment/web');
        break;
      case 29:
        await recreate('pod dns-pod', (o) => (o.spec.dnsPolicy = 'ClusterFirst'));
        assert.match(await k('exec dns-pod -- nslookup kubernetes'), /10\.43/);
        break;
      case 30:
        await k('delete pod cm-pod');
        await file('pod.yaml', { WRONG: 'ENV' });
        break;
      case 31:
        await recreate(
          'pod secret-pod',
          (o) => (o.spec.volumes[0].secret.secretName = 'my-secret'),
        );
        break;
      case 32:
        await k('create namespace quota-ns');
        await apply(
          'ResourceQuota',
          'compute-quota',
          {
            hard: {
              'requests.cpu': '1',
              'requests.memory': '512Mi',
              'limits.cpu': '2',
              'limits.memory': '1Gi',
            },
          },
          'quota-ns',
        );
        await k(
          'run quota-pod -n quota-ns --image=nginx:1.25 --requests=cpu=100m,memory=64Mi --limits=cpu=200m,memory=128Mi',
        );
        break;
      case 33:
        await recreate('pvc data-claim', (o) => (o.spec.accessModes = ['ReadWriteOnce']));
        break;
      case 34:
        await edit('role pod-reader', (o) => o.rules[0].verbs.push('get', 'list'));
        break;
      case 35:
        await apply('Pod', 'manual-pod', { nodeName: 'cka-lab', containers: [nginx] });
        break;
      case 36:
        await edit('svc app-svc', (o) => (o.spec.selector.app = 'app'));
        assert.equal(check(s, ex).passed, false);
        await edit('deployment app', (o) => {
          o.spec.selector.matchLabels.app = 'app';
          o.spec.template.metadata.labels.app = 'app';
          o.spec.template.spec.containers[0].env[0].valueFrom.configMapKeyRef.key = 'ENV';
        });
        break;
      case 37: {
        const volumeMounts = [{ name: 'shared', mountPath: '/data' }];
        await apply('Pod', 'sidecar-pod', {
          volumes: [{ name: 'shared', emptyDir: {} }],
          containers: [
            {
              name: 'writer',
              image: 'busybox:1.35',
              command: ['sh', '-c', 'while true; do echo hello >> /data/log.txt; sleep 5; done'],
              volumeMounts,
            },
            { ...nginx, name: 'reader', volumeMounts },
          ],
        });
        assert.equal(await k('exec sidecar-pod -c reader -- cat /data/log.txt'), 'hello');
        break;
      }
      case 38:
        await recreate('pvc claim', (o) => (o.spec.accessModes = ['ReadWriteOnce']));
        assert.match(await k('get pod pvc-pod'), /Running/);
        break;
      case 39:
        await recreate(
          'pod ready-pod',
          (o) => (o.spec.containers[0].readinessProbe.httpGet.path = '/'),
        );
        break;
      case 40:
        await edit('role role', (o) => o.rules[0].verbs.push('get', 'list'));
        await edit('rolebinding rb', (o) => (o.subjects[0].name = 'dev'));
        break;
      case 41:
        await recreate('pod pull-pod', (o) => (o.spec.containers[0].image = 'nginx:1.25'));
        break;
      case 42:
        await edit(
          'netpol np',
          (o) =>
            (o.spec.ingress = [{ from: [{ podSelector: { matchLabels: { access: 'true' } } }] }]),
        );
        break;
      case 43:
        await k('label node cka-lab disktype=nonexistent');
        break;
      case 44:
        await recreate(
          'pod init-pod',
          (o) => (o.spec.initContainers[0].volumeMounts[0].name = 'data'),
        );
        break;
      case 45:
        await k('expose deployment web --name=web-nodeport --port=80 --type=NodePort');
        await edit('svc web-nodeport', (o) => (o.spec.ports[0].nodePort = 30080));
        break;
      case 46:
      case 50:
        await cmd('ssh root@worker');
        if (ex.id === '50') {
          await cmd('k3s agent > /var/log/k3s-agent.log 2>&1 &');
          assert.match(await cmd('tail /var/log/k3s-agent.log'), /refused/);
          await cmd("sed -i 's/9999/6443/' /etc/profile.d/k3s.sh");
          await cmd('. /etc/profile.d/k3s.sh');
        }
        await cmd('k3s agent --snapshotter=native > /var/log/k3s-agent.log 2>&1 &');
        await cmd('exit');
        break;
      case 47:
        await k('cordon worker');
        await k('drain worker --ignore-daemonsets --delete-emptydir-data');
        await k('uncordon worker');
        assert.doesNotMatch(await k('get pods -o wide'), /worker/);
        break;
      case 48:
        await k('label node worker disktype=ssd');
        break;
      case 49:
        await k('taint node worker env=prod:NoSchedule');
        await apply('Pod', 'prod-pod', {
          nodeSelector: { 'kubernetes.io/hostname': 'worker' },
          tolerations: [{ key: 'env', value: 'prod', effect: 'NoSchedule' }],
          containers: [nginx],
        });
        break;
      case 51: {
        await cmd('ssh worker');
        await cmd('crictl pull busybox:1.36');
        await cmd('exit');
        break;
      }
      case 52: {
        await cmd('kubeadm init --kubernetes-version v1.34.0');
        const join = await cmd('kubeadm token create --print-join-command');
        await cmd('ssh worker');
        await cmd(join);
        await cmd('exit');
        break;
      }
      case 53: {
        await cmd('kubeadm upgrade plan');
        await cmd('kubeadm upgrade apply v1.35.0');
        break;
      }
      case 54: {
        await cmd('helm install shop ./web-chart');
        await cmd('helm upgrade shop ./web-chart --set replicas=3');
        break;
      }
      case 55: {
        await cmd(
          "printf 'resources: [../base]\\nnamePrefix: prod-\\ncommonLabels: {stage: prod}\\n' > overlay/kustomization.yaml",
        );
        await cmd('kubectl apply -k overlay');
        break;
      }
      case 56: {
        await cmd('kubectl create ingress shop --class=nginx --rule="shop.lab/*=web:80"');
        break;
      }
      case 57: {
        await cmd("sed -i 's/name: missing/name: public/;s/name: wrong/name: web/' route.yaml");
        await cmd('kubectl apply -f route.yaml');
        break;
      }
      case 58: {
        await cmd('kubectl autoscale deployment web --min=1 --max=5 --cpu-percent=50');
        break;
      }
      default:
        assert.fail('Missing solution');
    }
    reconcile(s);
    const restored = JSON.parse(JSON.stringify(s)),
      result = check(restored, ex);
    assert.ok(result.passed, JSON.stringify(result.results));
  });
