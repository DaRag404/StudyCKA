# StudyCKA ⎈

Open **index.html** in the root of the downloaded repository. Keep the adjacent **assets/** directory with it. All 58 exercises work offline in a modern desktop browser; no install, server, account, database or container runtime is needed. For static hosting, copy the same HTML file and assets directory.

Choose an exercise, use the terminal, then select **Check Answer**. The cluster, virtual files, shell history, recent terminal output, progress, timer and panel settings stay in the browser’s localStorage. Returning to an exercise restores its workspace. **Reset Environment** recreates just the current lab; **Reset** beside the progress bar clears grading history. Use the same browser profile and file location (or the same website address) to resume. Private browsing or clearing site data can discard saved work.

The terminal runs a Bash-compatible JavaScript interpreter inside xterm. Use shell variables, pipelines, loops, redirection and here-documents alongside `kubectl` and the original shortcuts `k`, `kgp`, `kgd`, `kgs`, `kgn` and `kga`. To edit a manifest, run `vi file.yaml` or `kubectl edit deployment web`. Press **i** to insert, **Esc** to return to normal mode and **:wq** followed by **Enter** to save and exit. The terminal also supports basic Nano editing with **Ctrl+O**, **Enter** and **Ctrl+X**. Set `KUBE_EDITOR=nano` to use Nano for kubectl edits. SSH switches to a simulated worker with its own files, logs and agent state. No commands run on the host. The simulator models exercise scenarios; it does not run Linux executables, download images, send packets or implement the entire Kubernetes API.

The simulated hosts have a navigable Linux filesystem. Try `ls -la ~`, `tree -L 2 /etc`, or `cd /var/lib/rancher/rke2/agent/pod-manifests`. Vi is the default for `$EDITOR`, `editor` and `kubectl edit`. Files belong to the current lab and host. Use `kubectl get pods -n kube-system -o wide` to inspect its RKE2 system pods.

Run `crictl images` to inspect the current node’s cache. `crictl pull nginx:1.25` pulls from the simulated offline catalog. Use `kubectl get events` to follow failures and recovery, `kubectl logs --previous POD` for a restarting container and `kubectl exec -it POD -- sh` to enter its filesystem. Type `exit` to return to the node.

Exercises 51–58 cover node image caches, kubeadm bootstrap and upgrades, a local Helm chart, Kustomize overlays, Ingress rules, Gateway API routes and CPU-based autoscaling. Helm supports the local chart and simple value substitutions used in the lab. Autoscaling uses a simulated CPU load.

## Development

Only developers rebuilding the checked-in static files need Node.js (20 or later). From the repository root:

```sh
npm ci --prefix frontend
npm test --prefix frontend
npm run lint --prefix frontend
npm run build --prefix frontend
```

The build bundles the React interface, xterm, YAML parser, CSS and exercise definitions locally and regenerates **index.html** and **assets/**. Edit exercises in **exercises/** and the shell, resource model and kubectl interpreter in **frontend/src/lab/**. The test suite starts each exercise from its original preconditions, solves it using terminal operations and checks the saved state. To develop with live reload, run `npm run dev --prefix frontend`.
