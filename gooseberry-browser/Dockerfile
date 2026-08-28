# syntax=docker/dockerfile:1.7

ARG BUN_VERSION=1.3.14
ARG NODE_VERSION=24.18.1-bookworm-slim
ARG BUN_IMAGE=oven/bun:1.3.14-debian@sha256:9dba1a1b43ce28c9d7931bfc4eb00feb63b0114720a0277a8f939ae4dfc9db6f
ARG NODE_IMAGE=node:24.18.1-bookworm-slim@sha256:235600a8101ab264e117b1768e925532262668dc9b581ef1dd7d96ced463b8e7
ARG AGENT_BROWSER_VERSION=0.34.0

FROM ${BUN_IMAGE} AS build
ARG BUN_VERSION
WORKDIR /build

RUN test "$(bun --version)" = "${BUN_VERSION}"
COPY package.json config.json ./
COPY src ./src
RUN bun build src/server.mjs --outfile /build/server.mjs --target node

FROM ${NODE_IMAGE} AS browser
ARG NODE_VERSION
ARG AGENT_BROWSER_VERSION
ARG TARGETARCH

RUN test "$(node --version)" = "v${NODE_VERSION%%-*}"

RUN apt-get update \
    && apt-get install --no-install-recommends -y \
        ca-certificates \
        chromium \
        curl \
        fonts-liberation \
        fonts-noto-cjk \
        fonts-noto-color-emoji \
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
    && rm -rf /var/lib/apt/lists/* /root/.npm /root/.cache \
    && rm -rf /usr/local/lib/node_modules/npm /usr/local/lib/node_modules/corepack \
        /usr/local/bin/npm /usr/local/bin/npx /usr/local/bin/corepack

WORKDIR /app
RUN mkdir -p /app /var/lib/gooseberry-browser/artifacts /var/lib/gooseberry-browser/state \
	&& chown -R node:node /app /var/lib/gooseberry-browser
COPY --from=build --chown=node:node /build/server.mjs /app/server.mjs
COPY --from=build --chown=node:node /build/config.json /app/config.json
COPY --chown=node:node LICENSE NOTICE.md /app/legal/

ENV NODE_ENV=production \
	GOOSEBERRY_BROWSER_HOST=127.0.0.1 \
	GOOSEBERRY_BROWSER_PORT=8787 \
	GOOSEBERRY_BROWSER_ARTIFACT_ROOT=/var/lib/gooseberry-browser/artifacts \
	GOOSEBERRY_BROWSER_STATE_ROOT=/var/lib/gooseberry-browser/state \
	GOOSEBERRY_BROWSER_COMMAND_TIMEOUT_MS=120000 \
	GOOSEBERRY_BROWSER_REQUEST_TIMEOUT_MS=120000 \
	GOOSEBERRY_BROWSER_MAX_ARTIFACT_BYTES=67108864 \
	GOOSEBERRY_BROWSER_MAX_TOTAL_ARTIFACT_BYTES=268435456 \
	GOOSEBERRY_BROWSER_MAX_STATE_BYTES=268435456 \
	GOOSEBERRY_BROWSER_MAX_SESSIONS=16 \
    AGENT_BROWSER_BINARY=/usr/local/bin/agent-browser \
    AGENT_BROWSER_CONFIG=/app/config.json

USER node
EXPOSE 8787
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD ["node", "-e", "fetch('http://127.0.0.1:' + (process.env.GOOSEBERRY_BROWSER_PORT || '8787') + '/health').then((response) => process.exit(response.ok ? 0 : 1)).catch(() => process.exit(1))"]
ENTRYPOINT ["/usr/bin/tini", "-s", "--"]
CMD ["node", "/app/server.mjs"]
