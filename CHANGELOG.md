# Changelog

All notable changes to StudyCKA are documented here.

---

## [1.0.0] — 2026-03-01

### Added
- **45 hands-on CKA exercises** across three tracks:
  - Core CKA (1–15): Pods, Deployments, Services, Namespaces, ConfigMaps, Secrets, Resource Limits, Liveness Probes, Labels & Selectors, Init Containers, Jobs, CronJobs, PV/PVC, Rolling Updates
  - Troubleshooting (16–35): Break-and-fix scenarios — CrashLoopBackOff, ImagePullBackOff, RBAC misconfigurations, tainted nodes, wrong probes, OOMKilled, NetworkPolicies, DNS, ConfigMap/Secret mount errors, Service TargetPort, PVC AccessMode, node selector
  - Multi-step & Debug (36–45): Full app stacks, RBAC chains, PV binding, init containers, node affinity, readiness probes, service selector debugging
- **Per-user k3s sandbox** — each session gets a dedicated Docker container running k3s (privileged, 768 MB RAM / 1.5 vCPU), managed via Dockerode
- **Browser terminal** — xterm.js v5 over WebSocket, backed by node-pty for a stable full-featured PTY (vim, arrow keys, Tab completion in all browsers)
- **Answer checking** — server-side `kubectl` exec inside the user's container with per-check pass/fail feedback
- **Environment reset** — tears down and recreates the sandbox, re-applies exercise preconditions
- **Auto-cleanup on exercise select** — removes all previous namespace resources before applying new preconditions
- **Resizable split panel** — drag handle between description and terminal; maximize/minimize controls
- **Markdown rendering** — exercise descriptions render full Markdown via react-markdown + remark-gfm
- **Exercise preconditions** — support for both `manifest` and `command` types
- **Session lifecycle** — bootstrap on page load, status polling, idle cleanup after 45 minutes
- **Progress persistence** — exercise pass/fail state stored in localStorage
- **nginx reverse proxy** — single port 80 for HTTP, API, and WebSocket traffic
- **Vite HMR** — frontend source mounted as a volume; changes hot-reload without rebuilding the image
