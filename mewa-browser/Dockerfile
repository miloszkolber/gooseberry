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
  && case "${AGENT_BROWSER_VERSION}:${TARGETARCH}" in \
    0.34.0:amd64) agent_arch=x64; agent_sha256=69eadf5d8d6003a06a5cd2f914ebb261c7754fe1335a9190122c334e91909789 ;; \
    0.34.0:arm64) agent_arch=arm64; agent_sha256=ca70bf7c2d269a152b3824cbb65befb7b8258b8aa1cf34767c64ada2abc3d7c8 ;; \
    0.34.0:) echo "TARGETARCH must be set to amd64 or arm64" >&2; exit 1 ;; \
    *) echo "unsupported agent-browser version or architecture: ${AGENT_BROWSER_VERSION}:${TARGETARCH}" >&2; exit 1 ;; \
  esac \
  && install -d /usr/local/libexec \
  && curl --fail --location --retry 3 \
    --output /usr/local/libexec/agent-browser \
    "https://github.com/vercel-labs/agent-browser/releases/download/v${AGENT_BROWSER_VERSION}/agent-browser-linux-${agent_arch}" \
  && printf '%s  %s\n' "${agent_sha256}" /usr/local/libexec/agent-browser | sha256sum --check --status - \
  && chmod 0755 /usr/local/libexec/agent-browser \
  && printf '%s\n' \
    '#!/bin/sh' \
    'export PATH=/usr/local/bin:/usr/bin:/bin' \
    'export AGENT_BROWSER_EXECUTABLE_PATH=/usr/bin/chromium' \
    'exec /usr/local/libexec/agent-browser "$@"' \
    > /usr/local/bin/agent-browser \
  && chmod 0755 /usr/local/bin/agent-browser \
  && apt-get purge -y --auto-remove curl \
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
