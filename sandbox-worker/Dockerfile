FROM alpine:3.19

# Full openssh package includes sshd, ssh-keygen (openssh-client only has the client)
RUN apk add --no-cache \
    bash \
    curl \
    openssl \
    ca-certificates \
    iptables \
    ip6tables \
    socat \
    conntrack-tools \
    openssh \
    util-linux

# Download the k3s binary — same version as the server image
ARG K3S_VERSION=v1.28.5+k3s1
RUN set -e; \
    ARCH=$(uname -m); \
    case "${ARCH}" in \
      x86_64)  K3S_BIN=k3s ;; \
      aarch64) K3S_BIN=k3s-arm64 ;; \
      armv7l)  K3S_BIN=k3s-armhf ;; \
      *) echo "Unsupported arch: ${ARCH}"; exit 1 ;; \
    esac; \
    ENCODED_VER=$(echo "${K3S_VERSION}" | sed 's/+/%2B/g'); \
    curl -fsSL "https://github.com/k3s-io/k3s/releases/download/${ENCODED_VER}/${K3S_BIN}" \
      -o /usr/local/bin/k3s; \
    chmod +x /usr/local/bin/k3s

# SSH: set root password and allow root login with password authentication
RUN echo 'root:cka-worker' | chpasswd && \
    echo 'PermitRootLogin yes' >> /etc/ssh/sshd_config && \
    echo 'PasswordAuthentication yes' >> /etc/ssh/sshd_config

# Directories required by k3s agent and SSH
RUN mkdir -p /etc/rancher/k3s /var/lib/rancher/k3s /etc/profile.d /var/log

# Custom MOTD shown on SSH login
RUN printf '\n\
  ____ _____ _   _ ______   ______ _  __    _    \n\
 / ___|_   _| | | |  _ \\ \\ / / ___| |/ /   / \\   \n\
 \\___ \\ | | | | | | | | \\ V / |   | '"'"' /   / _ \\  \n\
  ___) || | | |_| | |_| || || |___| . \\  / ___ \\ \n\
 |____/ |_|  \\___/|____/ |_| \\____|_|\\_\\/_/   \\_\\\n\
\n\
  Welcome to the Worker Node — CKA Training Cluster\n\
  ---------------------------------------------------\n\
  This node is part of a practice k3s cluster.\n\
  Good luck with your CKA preparation!\n\
\n' > /etc/motd

COPY entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

ENTRYPOINT ["/entrypoint.sh"]
