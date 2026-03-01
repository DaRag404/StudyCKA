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

45 hands-on tasks across three tracks:

**Core CKA (1–15)** — foundational tasks: Pods, Deployments, Services, ConfigMaps, Secrets, Resource Limits, Probes, Jobs, CronJobs, PV/PVC, Rolling Updates.

**Troubleshooting (16–35)** — break-and-fix scenarios: CrashLoopBackOff, ImagePullBackOff, RBAC misconfigurations, tainted nodes, wrong probes, OOMKilled, NetworkPolicies, DNS, ConfigMap/Secret mount errors, and more.

**Multi-step & Debug (36–45)** — complex real-world tasks: deploying full app stacks, multi-step RBAC, PV binding chains, init containers, node affinity, readiness probes, and service selector debugging.

Exercise progress is saved in `localStorage` and survives page refreshes.

---

## How It Works

- Each session gets a dedicated Docker container running k3s (privileged, 768 MB RAM / 1.5 vCPU).
- The terminal uses xterm.js over WebSocket, backed by node-pty for a stable full-featured PTY (vim, arrow keys, Tab completion all work).
- **Check Answer** runs `kubectl` commands server-side inside your container and compares output to expected values.
- **Reset Environment** tears down your container, starts a fresh one, and re-applies exercise preconditions.
- Selecting an exercise automatically cleans up previous resources and applies preconditions for the new one.
- Idle sessions are cleaned up after 45 minutes.

---

## Adding Exercises

Create a YAML file in `exercises/`. No rebuild needed — files are hot-reloaded from a mounted volume.

```yaml
id: "46"
title: "My Exercise"
difficulty: "medium"   # easy | medium | hard
category: "Workloads"
order: 46
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
```

---

## Stopping

```bash
docker compose down   # stops all services; cluster state is ephemeral
docker compose up     # start again
```

---

## Troubleshooting

**Cluster stuck on "Waiting for k3s…" >2 min** — k3s needs privileged containers. Check Docker is not in rootless mode; cgroup v2 may need host configuration.

**Terminal shows "Connection error"** — refresh the page; the WebSocket reconnects to your existing session.

**Port 80 in use** — change `"80:80"` to `"8080:80"` in `docker-compose.yml` and open `http://localhost:8080`.
