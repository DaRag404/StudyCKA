#!/bin/sh
set -e

# Configure KUBECONFIG for all interactive shells
export KUBECONFIG=/etc/rancher/k3s/k3s.yaml

# Write .vimrc — fixes arrow keys, no colours, sensible defaults
cat > /root/.vimrc << 'VIMRC'
set nocompatible
set backspace=indent,eol,start
set noswapfile
syntax off
set nonumber
set nohls
set t_Co=0
set mouse=
" Arrow keys: shorten escape-sequence wait for web terminal latency
set ttimeout
set ttimeoutlen=20
" Disable terminal queries that arrive mid-redraw over WebSocket and corrupt
" the display: bracketed-paste init, version request, cursor-position query
set t_BE=
set t_RV=
set t_u7=
" Disable character-level insert/delete optimisations (DCH1/ICH1).
" Without these vim redraws full lines, which is slower but correct in
" web terminals where cursor-relative edits get misaligned.
set t_dc=
set t_IC=
" Encourage full-screen redraws instead of partial optimisations
set ttyfast
" Do not switch to application cursor key mode (DECCKM) on startup/exit.
" Without this, vim sends \x1b[?1h on start and \x1b[?1l on exit; the
" SS3 prefix (\x1bO) in that mode can leave a stray 'o' in the terminal.
set t_ks=
set t_ke=
VIMRC

# Append explicit CSI arrow key codes (normal cursor key mode sequences).
# Must embed a literal ESC byte — cannot be written in a single-quote heredoc.
_ESC=$(printf '\033')
printf 'set t_ku=%s[A\nset t_kd=%s[B\nset t_kr=%s[C\nset t_kl=%s[D\n' \
  "$_ESC" "$_ESC" "$_ESC" "$_ESC" >> /root/.vimrc

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

# Plain white prompt — no colour codes, avoids readline width miscalculation
export PS1='cka-lab:\w\$ '

# Disable bracketed paste in readline — prevents garbled prompts in web terminals
bind 'set enable-bracketed-paste off' 2>/dev/null || true
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
