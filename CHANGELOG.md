# Changelog

All notable changes to StudyCKA are documented here.

---

## [Unreleased]

---

## [0.3.0] — 2026-03-01

### Added
- **10 troubleshooting exercises (16–25)** — "break and fix" scenarios modelled on real CKA exam tasks:
  - 16: Fix CrashLoopBackOff — container has a wrong entrypoint command
  - 17: Fix ImagePullBackOff — typo in the image name (`ngnix` → `nginx`)
  - 18: Fix Service returning no endpoints — label selector mismatch
  - 19: Fix RBAC — pod-reader ClusterRole exists but ClusterRoleBinding is missing
  - 20: Fix Pod stuck Pending — node has a `NoSchedule` taint the pod doesn't tolerate
  - 21: Fix PVC stuck Pending — references a non-existent StorageClass
  - 22: Fix Pod restarting — liveness probe targets the wrong port (9090 vs 80)
  - 23: Fix OOMKilled — memory limit too low (4 Mi) for nginx to start
  - 24: Fix wrong ServiceAccount — pod uses `default` SA instead of `api-sa`
  - 25: Fix NetworkPolicy — `deny-all` blocks ingress; add an allow policy for port 80
- **`type: command` precondition support** — exercise reset can now run arbitrary shell commands (e.g. `kubectl taint`) as setup steps, not only apply manifests. Exercise 20 uses this to apply the node taint during reset.
- **`execCommand` exported from `docker.js`** — the low-level exec helper is now accessible to the reset route.

---

## [0.2.0] — 2026-03-01

### Added
- **Resizable split panel** — drag handle between the exercise description and the terminal allows free vertical resizing. Clamped to a minimum of 120 px per panel.
- **Terminal window controls** — the three dots in the terminal toolbar are now interactive:
  - 🔴 Red — collapse terminal to toolbar only (description expands to fill panel)
  - 🟡 Yellow — restore last drag split position (dimmed when already in split mode)
  - 🟢 Green — maximise terminal (description hidden, terminal fills panel)
  - Hovering the dot group reveals icon hints (✕ / ↕ / ⤢)
- **Markdown rendering** — exercise descriptions now render full Markdown (bold, inline code, fenced code blocks, bullet lists, tables) via `react-markdown` + `remark-gfm` instead of plain text.
- **Vite HMR volume mount** — `frontend/src`, `index.html`, and `vite.config.js` are now mounted as volumes so source changes are picked up by Vite's hot-reload without rebuilding the image.

### Fixed
- **Blank page on load** — `GET /@vite/client` was returning 403. Root causes: Vite 5.4 `Host` header security check (fixed by `allowedHosts: 'all'`) and nginx sending `Connection: upgrade` on plain HTTP requests to `/@vite/` (fixed by removing the redundant location block).
- **Exercises API returning ENOENT** — path in `exercises.js` resolved to `/exercises` (filesystem root) instead of `/app/exercises`. Fixed `../../../` → `../../`.
- **k3s overlayfs error on Windows/WSL2** — `overlayfs` snapshotter is unsupported inside Docker containers on WSL2. Fixed by adding `--snapshotter=native` to the k3s server startup flags.
- **`docker compose restart` not applying rebuild** — documented and switched to `docker compose up --force-recreate` after image rebuilds.

### Changed
- **Sandbox base image** — switched from `rancher/k3s` (no `apk`) to `alpine:3.19` with k3s binary downloaded separately. All tools (`bash`, `vim`, `curl`, `jq`, `helm`, etc.) now install correctly via `apk`.
- **nginx `/@vite/` location block removed** — the catch-all `/` location correctly handles both Vite HTTP requests and HMR WebSocket upgrades.

---

## [0.1.0] — 2026-03-01

### Added
- Initial platform implementation.
- **Frontend** — React 18 + Vite SPA with two-panel layout: exercise list sidebar and terminal panel.
- **Terminal** — xterm.js v5 connected via WebSocket to a Docker TTY exec session (no node-pty). Supports resize events and binary PTY stream.
- **Backend** — Node.js + Express REST API (`/api/exercises`, `/api/session`, `/api/reset`, `/api/check`) and WebSocket terminal handler.
- **Per-user k3s sandbox** — each user session gets a dedicated Docker container running k3s (privileged, 768 MB RAM / 1.5 vCPU limit). Managed via Dockerode.
- **Session lifecycle** — bootstrap on page load, polling until cluster Ready, idle cleanup after 45 minutes.
- **Answer checking** — server-side `kubectl` exec inside the user's container; per-check pass/fail with expected vs actual output.
- **Environment reset** — tears down and recreates the sandbox container, re-applies exercise preconditions.
- **15 CKA exercises** covering: Pods, Deployments, Scaling, Services, Namespaces, ConfigMaps, Secrets, Resource Limits, Liveness Probes, Labels & Selectors, Init Containers, Jobs, CronJobs, PV/PVC, Rolling Updates.
- **nginx reverse proxy** — routes `/api/`, `/terminal` (WebSocket), and `/` (Vite) through a single port 80.
- **Docker Compose orchestration** — `sandbox-build`, `backend`, `frontend`, `nginx` services.
