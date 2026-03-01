FROM rancher/k3s:v1.28.5-k3s1

# Install extra tools available in the CKA exam environment
RUN apk add --no-cache \
    bash \
    bash-completion \
    curl \
    vim \
    nano \
    jq \
    git \
    openssl \
    util-linux

# Install helm (CKA doesn't require it but useful for practice)
RUN curl -fsSL https://raw.githubusercontent.com/helm/helm/main/scripts/get-helm-3 \
    | HELM_INSTALL_DIR=/usr/local/bin bash 2>/dev/null || \
    # Fallback: download binary directly
    (HELM_VERSION=v3.14.0 && \
     curl -fsSL "https://get.helm.sh/helm-${HELM_VERSION}-linux-amd64.tar.gz" \
       | tar -xz --strip-components=1 -C /usr/local/bin linux-amd64/helm)

# Pre-create kubeconfig directory
RUN mkdir -p /root/.kube /etc/rancher/k3s

COPY entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

# k3s needs to be PID 1 for proper signal handling
ENTRYPOINT ["/entrypoint.sh"]
