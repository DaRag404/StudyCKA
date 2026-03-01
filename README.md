# StudyCKA ⎈

A browser-based training platform for the **Certified Kubernetes Administrator (CKA)** exam. Work through hands-on Kubernetes exercises in an interactive terminal connected to a real, isolated k3s cluster — all running locally inside Docker.

---

## What It Is

StudyCKA gives you a self-contained lab environment where you can practise `kubectl` commands and Kubernetes concepts without needing a cloud account or a local cluster setup. Each user gets their own k3s cluster spun up on demand. You solve tasks in the terminal, then click **Check Answer** to get instant feedback.

### UI Layout

```
┌──────────────────────┬────────────────────────────────────┐
│   Exercise List      │  Exercise description + hints      │
│                      │  [ Check Answer ] [ Reset Env ]    │
│   01. Create a Pod   ├────────────────────────────────────┤
│   02. Create a …     │                                    │
│   03. Scale a …      │   bash — cka-lab                   │
│   …                  │                                    │
│                      │   cka-lab:~$ kubectl get pods      │
│   ● Cluster ready    │   NAME    READY   STATUS           │
└──────────────────────┴────────────────────────────────────┘
```

- **Left panel** — exercise list with difficulty badges and a progress bar
- **Top right** — the selected exercise: task description, hints, and action buttons
- **Bottom right** — a live terminal (xterm.js) connected directly to your k3s cluster

---

## Requirements

| Dependency | Minimum version |
|---|---|
| Docker | 24+ |
| Docker Compose | v2 (the `docker compose` plugin) |

No Node.js, kubectl, or Kubernetes installation needed on the host.

---

## Quick Start

```bash
# 1. Clone the repository
git clone <repo-url> studycka
cd studycka

# 2. Build all images (first run takes ~5 minutes — downloads k3s + npm packages)
docker compose build

# 3. Start the platform
docker compose up

# 4. Open your browser
#    http://localhost
```

On first load the platform will spin up a private k3s cluster for your session. This takes **20–30 seconds**. The terminal will show a "Waiting for k3s…" message and the status indicator in the sidebar will pulse yellow until the cluster is ready.

---

## Stopping and Restarting

```bash
# Stop all services (clusters are destroyed)
docker compose down

# Start again (your progress badge resets — cluster state is ephemeral)
docker compose up
```

> **Note:** exercise progress (✓/✗ badges) is stored in your browser's `localStorage`, so it survives page refreshes but not a full browser-data clear.

---

## How It Works

### Per-user Kubernetes Cluster

When you open the app, the backend generates a session ID (stored in `localStorage`) and creates a **dedicated Docker container** running k3s — a single-binary, lightweight Kubernetes distribution. The container runs with:

- `--privileged` mode (required by k3s for cgroup management)
- 768 MB RAM and 1.5 vCPU hard limits
- An isolated overlay filesystem (your cluster state is completely separate from other users)

The backend polls `kubectl get nodes` every 3 seconds until the node reaches `Ready` status, then signals the frontend to connect the terminal.

### Browser Terminal

The terminal uses **xterm.js** connected via WebSocket to the backend. The backend opens a Docker TTY exec session into your k3s container (`docker exec -it /bin/bash`) and pipes the raw binary PTY stream directly to the browser. Resize events from the browser keep the remote terminal dimensions in sync.

The container's `.bashrc` pre-configures:
- `KUBECONFIG=/etc/rancher/k3s/k3s.yaml`
- `kubectl` bash completion
- Alias `k=kubectl`
- Helpful aliases: `kgp`, `kgd`, `kgs`, `kgn`

### Answer Checking

When you click **Check Answer**, the backend runs a series of `kubectl` commands **server-side** inside your container (non-interactive exec) and compares the output to the expected values defined in the exercise YAML. Results are returned immediately with per-check pass/fail detail.

### Environment Reset

**Reset Environment** tears down your current k3s container, starts a fresh one, waits for it to be ready, then applies any **precondition manifests** defined in the exercise (e.g. a pre-existing Deployment for a "scale" exercise). The terminal reconnects automatically.

---

## Exercises

15 hands-on tasks covering the core CKA curriculum, ordered by complexity:

| # | Exercise | Difficulty | Topic |
|---|---|---|---|
| 01 | Create a Pod | Easy | Core Concepts |
| 02 | Create a Deployment | Easy | Workloads |
| 03 | Scale a Deployment | Easy | Workloads |
| 04 | Expose a Service | Easy | Services & Networking |
| 05 | Create a Namespace | Easy | Core Concepts |
| 06 | Create a ConfigMap and Use It | Medium | Configuration |
| 07 | Create a Secret | Medium | Configuration |
| 08 | Set Resource Requests and Limits | Medium | Workloads |
| 09 | Configure a Liveness Probe | Medium | Workloads |
| 10 | Labels and Selectors | Easy | Core Concepts |
| 11 | Init Container | Medium | Workloads |
| 12 | Create a Job | Medium | Workloads |
| 13 | Create a CronJob | Medium | Workloads |
| 14 | PersistentVolume and PersistentVolumeClaim | Hard | Storage |
| 15 | Rolling Update Strategy | Hard | Workloads |

Each exercise includes:
- A full task description with YAML examples
- Collapsible hints (reveal when stuck)
- Automated validation with per-check feedback

---

## Adding Your Own Exercises

Create a new YAML file in the `exercises/` directory. The backend hot-reloads exercise files from a mounted volume — no rebuild required.

```yaml
id: "16"
title: "My Custom Exercise"
difficulty: "medium"       # easy | medium | hard
category: "Workloads"
order: 16
description: |
  Describe the task here. Markdown-style formatting is supported.

hints:
  - "First hint"
  - "Second hint"

# kubectl args run inside the user's container; output compared to expect
validation:
  - args: ["get", "pod", "my-pod", "-o", "jsonpath={.spec.containers[0].image}"]
    expect: "nginx:1.25"
    description: "Pod uses correct image"

# Optional: YAML applied to the cluster before the user starts (on reset)
preconditions:
  - type: manifest
    manifest: |
      apiVersion: v1
      kind: ConfigMap
      metadata:
        name: pre-existing-config
      data:
        key: value
```

After saving the file, refresh the browser — the new exercise appears in the list immediately.

---

## Project Structure

```
studycka/
├── docker-compose.yml          # Orchestrates all services
├── nginx/
│   └── nginx.conf              # Reverse proxy: /, /api/, /terminal (WS)
├── sandbox/
│   ├── Dockerfile              # k3s image + bash, vim, curl, jq, helm
│   └── entrypoint.sh           # Configures .bashrc, starts k3s server
├── backend/
│   ├── Dockerfile
│   ├── package.json
│   └── src/
│       ├── index.js            # Express server + WebSocket terminal handler
│       ├── routes/
│       │   ├── exercises.js    # GET /api/exercises[/:id]
│       │   ├── session.js      # POST /api/session, GET /api/session/status
│       │   ├── reset.js        # POST /api/reset/:exerciseId
│       │   └── check.js        # POST /api/check/:exerciseId
│       ├── session/
│       │   └── manager.js      # In-memory session store with TTL cleanup
│       └── sandbox/
│           └── docker.js       # Dockerode wrapper (create, exec, terminal, wait)
├── frontend/
│   ├── Dockerfile
│   ├── package.json
│   └── src/
│       ├── App.jsx             # Root layout + session bootstrap + status polling
│       ├── store.js            # Zustand global state
│       └── components/
│           ├── ExerciseList.jsx    # Sidebar with progress tracking
│           ├── ExerciseDetail.jsx  # Task description + check/reset actions
│           └── TerminalPanel.jsx   # xterm.js terminal + WebSocket connection
└── exercises/
    ├── 01-create-pod.yaml
    └── … (15 exercises total)
```

---

## Technology Stack

| Layer | Technology | Purpose |
|---|---|---|
| Frontend | React 18 + Vite | SPA framework and dev server |
| Terminal | xterm.js v5 | Browser-based PTY renderer |
| State | Zustand | Lightweight global state |
| Styling | Tailwind CSS | Dark-theme utility classes |
| Backend | Node.js 20 + Express | REST API and WebSocket server |
| WebSocket | `ws` | Terminal WebSocket server |
| Container API | Dockerode | Create/exec/manage sandbox containers |
| Kubernetes | k3s (rancher/k3s) | Lightweight single-binary Kubernetes |
| Proxy | nginx | Routes HTTP and WebSocket traffic |
| Infra | Docker Compose | Local multi-service orchestration |

---

## Resource Usage

Each active user session consumes approximately:

| Resource | Per user |
|---|---|
| RAM | ~512–768 MB (k3s + system pods) |
| CPU | Up to 1.5 vCPU (burst) |
| Disk | ~500 MB (k3s image layers, shared) |

Idle sessions are automatically cleaned up after **45 minutes** of inactivity — their containers are stopped and removed.

---

## Troubleshooting

**The terminal shows "Waiting for k3s…" for more than 2 minutes**
- k3s requires privileged Docker containers. Check that Docker is not running in rootless mode.
- On some systems, cgroup v2 requires additional host configuration for k3s.

**"Connection error" in the terminal immediately after the cluster turns ready**
- Refresh the page. The WebSocket will reconnect to the existing session.

**The sandbox image fails to build (helm download error)**
- The `sandbox/Dockerfile` downloads Helm during build. Check internet connectivity or the Helm release URL.

**Port 80 is already in use**
- Change the nginx port in `docker-compose.yml`: `"8080:80"` then open `http://localhost:8080`.

**On Windows: Docker socket errors**
- Ensure Docker Desktop is running with the "Expose daemon on tcp://localhost:2375" option **off** and WSL2 integration **on**. The socket at `/var/run/docker.sock` is available inside WSL2 containers automatically.
