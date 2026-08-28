# syntax=docker/dockerfile:1.7

ARG BUN_VERSION=1.3.14
ARG BUN_IMAGE=oven/bun:1.3.14-debian@sha256:9dba1a1b43ce28c9d7931bfc4eb00feb63b0114720a0277a8f939ae4dfc9db6f

FROM ${BUN_IMAGE} AS dependencies
ARG BUN_VERSION
WORKDIR /work

RUN test "$(bun --version)" = "${BUN_VERSION}"

# Keep the dependency layer independent from application source changes.
COPY package.json bun.lock ./
COPY apps/controller/package.json apps/controller/package.json
COPY webui/package.json webui/package.json
COPY packages/goose-client/package.json packages/goose-client/package.json
COPY packages/contracts/package.json packages/contracts/package.json
COPY packages/server/package.json packages/server/package.json
COPY packages/shared/package.json packages/shared/package.json
RUN bun install --frozen-lockfile

FROM dependencies AS build
COPY . .
RUN bun run build

FROM ${BUN_IMAGE} AS production-dependencies
ARG BUN_VERSION
ARG TARGETARCH
WORKDIR /work

RUN test "$(bun --version)" = "${BUN_VERSION}"
RUN apt-get update \
    && apt-get install --no-install-recommends -y findutils \
    && rm -rf /var/lib/apt/lists/*
COPY package.json bun.lock ./
COPY apps/controller/package.json apps/controller/package.json
COPY webui/package.json webui/package.json
COPY packages/goose-client/package.json packages/goose-client/package.json
COPY packages/contracts/package.json packages/contracts/package.json
COPY packages/server/package.json packages/server/package.json
COPY packages/shared/package.json packages/shared/package.json
COPY scripts/prune-runtime-dependencies.sh /tmp/prune-runtime-dependencies.sh
RUN bun install --frozen-lockfile --production --filter '@gooseberry/controller' \
	&& sh /tmp/prune-runtime-dependencies.sh apps/controller/node_modules /runtime \
    && rm -f /tmp/prune-runtime-dependencies.sh

FROM ${BUN_IMAGE} AS controller
ARG BUN_VERSION

RUN apt-get update \
    && apt-get install --no-install-recommends -y \
		ca-certificates \
		git \
		tini \
    && rm -rf /var/lib/apt/lists/* /root/.cache /root/.bun /home/bun/.bun/install/cache \
    && test "$(bun --version)" = "${BUN_VERSION}"

ENV NODE_ENV=production \
    HOME=/home/bun \
	GOOSEBERRY_BROWSER_AUTH=false

WORKDIR /app
RUN mkdir -p /var/lib/gooseberry \
	&& chown -R bun:bun /app /var/lib/gooseberry

COPY --from=build --chown=bun:bun /work/apps/controller/dist/index.js /app/gooseberry.js
COPY --from=build --chown=bun:bun /work/webui/dist /app/web
COPY --from=production-dependencies /runtime/node_modules /app/node_modules
COPY --from=production-dependencies /runtime/licenses /app/licenses
COPY LICENSE NOTICE.md /app/legal/
COPY scripts/check-controller-runtime.sh /tmp/check-controller-runtime.sh

# The runtime checker uses Bash. Install and purge it in this one layer so the final package
# inventory has no unused shell while the check still inspects the assembled controller runtime.
RUN apt-get update \
	&& apt-get install --no-install-recommends -y bash \
	&& bash /tmp/check-controller-runtime.sh /app \
	&& rm -f /tmp/check-controller-runtime.sh \
	&& apt-get purge --auto-remove --allow-remove-essential -y bash \
	&& rm -rf /var/lib/apt/lists/* /root/.cache /root/.bun /home/bun/.cache /home/bun/.bun/install/cache

USER bun
EXPOSE 7312
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD ["bun", "-e", "fetch('http://127.0.0.1:7312/health').then((response) => process.exit(response.ok ? 0 : 1)).catch(() => process.exit(1))"]
ENTRYPOINT ["/usr/bin/tini", "-s", "--"]
CMD ["bun", "/app/gooseberry.js"]
