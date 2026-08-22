ARG NODE_VERSION=24-bookworm-slim
ARG AGENT_BROWSER_VERSION=0.34.0

FROM node:${NODE_VERSION}

ARG AGENT_BROWSER_VERSION
ARG TARGETARCH
RUN apt-get update \
  && apt-get install -y --no-install-recommends \
    ca-certificates \
    chromium \
    curl \
    tini \
  && case "${TARGETARCH:-amd64}" in \
    amd64) agent_arch=x64 ;; \
    arm64) agent_arch=arm64 ;; \
    *) echo "unsupported architecture: ${TARGETARCH}" >&2; exit 1 ;; \
  esac \
  && install -d /usr/local/libexec \
  && curl --fail --location --retry 3 \
    --output /usr/local/libexec/agent-browser \
    "https://github.com/vercel-labs/agent-browser/releases/download/v${AGENT_BROWSER_VERSION}/agent-browser-linux-${agent_arch}" \
  && chmod 0755 /usr/local/libexec/agent-browser \
  && printf '%s\n' \
    '#!/bin/sh' \
    'export PATH=/usr/local/bin:/usr/bin:/bin' \
    'export AGENT_BROWSER_EXECUTABLE_PATH=/usr/bin/chromium' \
    'exec /usr/local/libexec/agent-browser "$@"' \
    > /usr/local/bin/agent-browser \
  && chmod 0755 /usr/local/bin/agent-browser \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY package.json ./
COPY config.json ./config.json
COPY src ./src

ENV NODE_ENV=production \
    PORT=8787 \
    BROWSER_ARTIFACT_ROOT=/state/artifacts \
    AGENT_BROWSER_BINARY=/usr/local/bin/agent-browser \
    AGENT_BROWSER_CONFIG=/app/config.json

USER node
EXPOSE 8787
ENTRYPOINT ["/usr/bin/tini", "-s", "--"]
CMD ["node", "src/server.mjs"]
