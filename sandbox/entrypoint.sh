#!/bin/sh
set -e

# Configure KUBECONFIG for all interactive shells
export KUBECONFIG=/etc/rancher/k3s/k3s.yaml

# Write shell configuration so exec'd bash sessions inherit it
cat > /root/.bashrc << 'BASHRC'
export KUBECONFIG=/etc/rancher/k3s/k3s.yaml
export TERM=xterm-256color

# kubectl completion
source <(kubectl completion bash) 2>/dev/null || true
alias k=kubectl
complete -F __start_kubectl k 2>/dev/null || true

# Handy aliases
alias kgp='kubectl get pods'
alias kgd='kubectl get deployments'
alias kgs='kubectl get services'
alias kgn='kubectl get nodes'

# Prompt: green hostname + blue path
export PS1='\[\033[01;32m\]cka-lab\[\033[00m\]:\[\033[01;34m\]\w\[\033[00m\]\$ '
BASHRC

# Also apply to /etc/profile for sh-based execs
echo 'export KUBECONFIG=/etc/rancher/k3s/k3s.yaml' >> /etc/profile

# Start k3s server as PID 1
# --disable=traefik  → skip the ingress controller (saves RAM)
# --disable=metrics-server → skip metrics-server (saves RAM)
exec /usr/local/bin/k3s server \
  --disable=traefik \
  --disable=metrics-server \
  --write-kubeconfig-mode=644 \
  --snapshotter=native
