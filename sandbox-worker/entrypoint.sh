#!/bin/sh
set -e

# Generate SSH host keys (they are not baked into the image, so each container gets unique keys)
ssh-keygen -A

# Write k3s agent env vars to a profile.d file so SSH login shells can restart the agent
cat > /etc/profile.d/k3s.sh << EOF
export K3S_URL=${K3S_URL}
export K3S_TOKEN=${K3S_TOKEN}
EOF

# Start k3s agent in background — sshd (PID 1) keeps the container alive even if agent dies
# node-status-update-frequency reduced from 10s default so the server detects
# loss of heartbeat (and marks the node NotReady) within the 15s grace period.
k3s agent --snapshotter=native --kubelet-arg=node-status-update-frequency=5s > /var/log/k3s-agent.log 2>&1 &

# Run sshd in the foreground as PID 1 (-e logs to stderr)
exec /usr/sbin/sshd -D -e
