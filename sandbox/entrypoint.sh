#!/bin/sh
set -e

# Configure KUBECONFIG for all interactive shells
export KUBECONFIG=/etc/rancher/k3s/k3s.yaml

# Write .vimrc — fixes arrow keys and gives sensible defaults
cat > /root/.vimrc << 'VIMRC'
set nocompatible
set backspace=indent,eol,start
set noswapfile
syntax on
set number
set hlsearch
set incsearch
set mouse=
VIMRC

# Write .bashrc — sourced by interactive shells
cat > /root/.bashrc << 'BASHRC'
export KUBECONFIG=/etc/rancher/k3s/k3s.yaml
export TERM=xterm-256color
export HOME=/root

# Tab completion (must come before kubectl completion)
[ -f /usr/share/bash-completion/bash_completion ] && source /usr/share/bash-completion/bash_completion

# kubectl completion + alias
source <(kubectl completion bash) 2>/dev/null || true
alias k=kubectl
complete -F __start_kubectl k 2>/dev/null || true

# vi → vim (arrow keys work, modern terminal support)
alias vi=vim
alias view='vim -R'

# Handy aliases
alias kgp='kubectl get pods'
alias kgd='kubectl get deployments'
alias kgs='kubectl get services'
alias kgn='kubectl get nodes'
alias kga='kubectl get all'

# Prompt: green hostname + blue path  (~ shows for /root)
export PS1='\[\033[01;32m\]cka-lab\[\033[00m\]:\[\033[01;34m\]\w\[\033[00m\]\$ '
BASHRC

# .bash_profile ensures .bashrc is sourced for login shells
cat > /root/.bash_profile << 'PROFILE'
[ -f /root/.bashrc ] && source /root/.bashrc
PROFILE

# Also apply KUBECONFIG to /etc/profile for sh-based execs
echo 'export KUBECONFIG=/etc/rancher/k3s/k3s.yaml' >> /etc/profile

# Start k3s server as PID 1
exec /usr/local/bin/k3s server \
  --disable=traefik \
  --disable=metrics-server \
  --write-kubeconfig-mode=644 \
  --snapshotter=native
