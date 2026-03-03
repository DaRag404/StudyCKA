# StudyCKA ⎈

A self-contained CKA exam training platform. Work through hands-on Kubernetes exercises in a live terminal connected to a real, isolated k3s cluster — all running locally in Docker.

<img width="1473" height="872" alt="image" src="https://github.com/user-attachments/assets/3aae4602-1c72-4f81-aa0a-0222fc63949b" />

---

## Requirements

- Docker 24+
- Docker Compose v2 (`docker compose` plugin)

No Node.js, kubectl, or Kubernetes installation needed on the host.

---

## Quick Start

```bash
git clone <repo-url> studycka
cd studycka
docker compose build   # first run takes ~5 min
docker compose up
```

Open **http://localhost** in your browser.

On first load a private k3s cluster starts for your session (20–30 seconds). The status indicator pulses yellow until the cluster is ready.

---

## Exercises

50 hands-on tasks across four tracks, progressing from easy to hard:

### Core Skills (1–15) — easy/medium
Foundational CKA tasks done from scratch:

| # | Title | Difficulty |
|---|-------|-----------|
| 1 | Create a Pod | easy |
| 2 | Create a Deployment | easy |
| 3 | Scale a Deployment | easy |
| 4 | Expose a Deployment as a Service | easy |
| 5 | Create a Namespace | easy |
| 6 | Create a ConfigMap and Use It | medium |
| 7 | Create a Secret | medium |
| 8 | Set Resource Requests and Limits | medium |
| 9 | Configure a Liveness Probe | medium |
| 10 | Labels and Selectors | easy |
| 11 | Init Container | medium |
| 12 | Create a Job | medium |
| 13 | Create a CronJob | medium |
| 14 | PersistentVolumeClaim and Pod Volume Mount | medium |
| 15 | Rolling Update and Rollout | medium |

### Troubleshooting & Scheduling (16–45) — easy to hard
Break-and-fix scenarios covering every major CKA domain:

| # | Title | Difficulty |
|---|-------|-----------|
| 16 | Fix: CrashLoopBackOff | medium |
| 17 | Fix: ImagePullBackOff (Image Typo) | easy |
| 18 | Fix: Service Has No Endpoints | medium |
| 19 | Fix: RBAC — Missing ClusterRoleBinding | medium |
| 20 | Fix: Pod Stuck in Pending (Node Taint) | medium |
| 21 | Fix: PVC Stuck in Pending (Wrong StorageClass) | medium |
| 22 | Fix: Pod Restarting Due to Liveness Probe | medium |
| 23 | Fix: OOMKilled — Memory Limit Too Low | medium |
| 24 | Fix: Pod Using Wrong ServiceAccount | medium |
| 25 | Fix: NetworkPolicy Blocking Traffic | hard |
| 26 | Create a DaemonSet | easy |
| 27 | Fix: Service TargetPort Mismatch | medium |
| 28 | Roll Back a Deployment | medium |
| 29 | Fix: Pod Cannot Resolve Cluster DNS | medium |
| 30 | Fix: Wrong ConfigMap Key Reference | medium |
| 31 | Fix: Secret Volume Mount Failing | medium |
| 32 | Create a Namespace Resource Quota | medium |
| 33 | Fix: PVC Not Binding (Access Mode Mismatch) | medium |
| 34 | Fix: RBAC Role Missing Verb | medium |
| 35 | Manually Schedule a Pod | medium |
| 36 | Fix: Multi-step App Stack | hard |
| 37 | Sidecar Container with Shared Volume | medium |
| 38 | Fix: PV + PVC + Pod Binding Chain | hard |
| 39 | Fix: Pod Never Becomes Ready | medium |
| 40 | Fix: RoleBinding Wrong Subject | hard |
| 41 | Fix: ImagePullBackOff (Bad Tag) | easy |
| 42 | Fix: NetworkPolicy — Allow Specific Pod Traffic | hard |
| 43 | Fix: Pod Pending Due to Node Affinity | hard |
| 44 | Fix: Init Container Volume Name Mismatch | hard |
| 45 | Expose a Service with NodePort | easy |

### Two-Node Cluster (46–50) — medium to hard
Exercises that spin up a second worker node, giving you a real multi-node cluster to work with. SSH into the worker node, fix agent failures, drain nodes, and manage scheduling across both nodes.

| # | Title | Difficulty |
|---|-------|-----------|
| 46 | Fix NotReady Worker Node | hard |
| 47 | Drain Worker Node for Maintenance | medium |
| 48 | Fix Pending Pod with Node Label | easy |
| 49 | Taint Worker Node and Schedule a Tolerating Pod | medium |
| 50 | Fix Worker Node Agent Configuration | hard |

Exercise progress is saved in `localStorage` and survives page refreshes.

---

## How It Works

- Each session gets a dedicated Docker container running k3s (privileged, 768 MB RAM / 1.5 vCPU).
- The terminal uses xterm.js over WebSocket, backed by node-pty for a stable full-featured PTY (vim, arrow keys, Tab completion all work).
- **Check Answer** runs `kubectl` commands server-side inside your container and compares output to expected values.
- **Reset Environment** tears down your container, starts a fresh one, and re-applies exercise preconditions.
- Selecting an exercise automatically cleans up previous resources and applies preconditions for the new one.
- **Two-node exercises** (46–50) spin up a second privileged container running the k3s agent that joins the cluster as a worker node. The terminal is locked during setup and unlocked once the cluster is ready.
- Idle sessions are cleaned up after 45 minutes.

---

## Adding Exercises

Create a YAML file in `exercises/`. No rebuild needed — files are hot-reloaded from a mounted volume.

```yaml
id: "51"
title: "My Exercise"
difficulty: "medium"   # easy | medium | hard
category: "Workloads"
order: 51
description: |
  Task description. Markdown is supported.
hints:
  - "First hint"
validation:
  - args: ["get", "pod", "my-pod", "-o", "jsonpath={.spec.containers[0].image}"]
    expect: "nginx:1.25"
    description: "Pod uses correct image"
preconditions:
  - type: manifest
    manifest: |
      apiVersion: v1
      kind: Pod
      ...
  - type: command
    command: "kubectl taint nodes --all key=val:NoSchedule"
  - type: file
    path: /root/template.yaml
    content: |
      # YAML template placed in the sandbox for the user to edit
  - type: worker-node          # spins up a second k3s agent node
  - type: command-on-worker
    command: "pkill k3s || true"
  - type: wait-for-worker-not-ready
```

### Precondition types

| Type | Description |
|------|-------------|
| `manifest` | Apply a Kubernetes YAML manifest via `kubectl apply` |
| `command` | Run a shell command inside the server (control plane) container |
| `file` | Place a template file in the sandbox at the given path |
| `worker-node` | Spin up a second container running the k3s agent as a worker node |
| `command-on-worker` | Run a shell command inside the worker container |
| `wait-for-worker-not-ready` | Block until the worker node shows `NotReady` in `kubectl get nodes` |

---

## Stopping

```bash
docker compose down   # stops all services; cluster state is ephemeral
docker compose up     # start again
```

---

## Troubleshooting

**Cluster stuck on "Waiting for k3s…" >2 min** — k3s needs privileged containers. Check Docker is not in rootless mode; cgroup v2 may need host configuration.

**Terminal shows "Connection error"** — refresh the page; the WebSocket reconnects to your existing session after a backend restart.

**Port 80 in use** — change `"80:80"` to `"8080:80"` in `docker-compose.yml` and open `http://localhost:8080`.

**Worker node stays in "Preparing environment…"** — the two-node exercises take longer to set up (~60–90 s). If it never completes, click Reset Environment.
