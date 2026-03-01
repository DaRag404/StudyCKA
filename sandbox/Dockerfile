FROM alpine:3.19

# Install packages (apk is available on Alpine)
RUN apk add --no-cache \
    bash \
    bash-completion \
    curl \
    vim \
    nano \
    jq \
    git \
    openssl \
    util-linux \
    ca-certificates \
    iptables \
    ip6tables \
    socat \
    conntrack-tools

# Download the k3s binary (it bundles kubectl, containerd, runc, etc.)
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

# Symlinks so users can call kubectl, ctr, crictl directly
RUN ln -s /usr/local/bin/k3s /usr/local/bin/kubectl \
 && ln -s /usr/local/bin/k3s /usr/local/bin/ctr \
 && ln -s /usr/local/bin/k3s /usr/local/bin/crictl

# Install helm
RUN curl -fsSL https://raw.githubusercontent.com/helm/helm/main/scripts/get-helm-3 \
    | HELM_INSTALL_DIR=/usr/local/bin bash

# Pre-create directories k3s expects on startup
RUN mkdir -p /etc/rancher/k3s /var/lib/rancher/k3s /root/.kube

COPY entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

ENTRYPOINT ["/entrypoint.sh"]
