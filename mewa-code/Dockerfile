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
COPY packages/contracts/package.json packages/contracts/package.json
COPY packages/pi-mewa-browser/package.json packages/pi-mewa-browser/package.json
COPY packages/server/package.json packages/server/package.json
COPY packages/shared/package.json packages/shared/package.json
RUN bun install --frozen-lockfile

FROM dependencies AS build
COPY . .
RUN bun run build \
	&& mkdir -p /runtime/extensions \
	&& bun build packages/pi-mewa-browser/index.ts \
		--outfile /runtime/extensions/mewa-browser.js \
		--target bun \
	&& bun build packages/server/node_modules/pi-web-access/index.ts \
		--outfile /runtime/extensions/mewa-web-access.js \
		--target bun

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
COPY packages/contracts/package.json packages/contracts/package.json
COPY packages/pi-mewa-browser/package.json packages/pi-mewa-browser/package.json
COPY packages/server/package.json packages/server/package.json
COPY packages/shared/package.json packages/shared/package.json
\
COPY scripts/prune-runtime-dependencies.sh /tmp/prune-runtime-dependencies.sh
RUN bun install --frozen-lockfile --production --filter '@mewa-code/server' \
    && sh /tmp/prune-runtime-dependencies.sh packages/server/node_modules /runtime \
    && rm -f /tmp/prune-runtime-dependencies.sh

FROM ${BUN_IMAGE} AS controller
ARG BUN_VERSION

RUN apt-get update \
    && apt-get install --no-install-recommends -y \
         bash \
		ca-certificates \
		git \
		openssh-client \
		tini \
    && rm -rf /var/lib/apt/lists/* /root/.cache /root/.bun /home/bun/.bun/install/cache \
    && test "$(bun --version)" = "${BUN_VERSION}"

ENV NODE_ENV=production \
    HOME=/home/bun \
    MEWA_CODE_DATA_DIR=/var/lib/mewa \
	MEWA_CODE_STATIC_DIR=/app/web \
	MEWA_CODE_BROWSER_EXTENSION_PATH=/app/extensions/mewa-browser.js \
	MEWA_CODE_WEB_ACCESS_EXTENSION_PATH=/app/extensions/mewa-web-access.js

WORKDIR /app
RUN mkdir -p /app/extensions /var/lib/mewa /home/bun/.pi /workspace \
    && chown -R bun:bun /app /var/lib/mewa /home/bun/.pi /workspace

COPY --from=build --chown=bun:bun /work/apps/controller/dist/index.js /app/mewa-code.js
COPY --from=build --chown=bun:bun /work/webui/dist /app/web
COPY --from=build --chown=bun:bun /runtime/extensions/mewa-browser.js /app/extensions/mewa-browser.js
COPY --from=build --chown=bun:bun /runtime/extensions/mewa-web-access.js /app/extensions/mewa-web-access.js
COPY --from=production-dependencies /runtime/node_modules /app/node_modules
COPY --from=production-dependencies /runtime/licenses /app/licenses
COPY scripts/check-controller-runtime.sh /tmp/check-controller-runtime.sh

RUN bash /tmp/check-controller-runtime.sh /app \
	&& rm -f /tmp/check-controller-runtime.sh \
	&& rm -rf /root/.cache /root/.bun /home/bun/.cache /home/bun/.bun/install/cache

USER bun
EXPOSE 24242
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD ["bun", "-e", "fetch('http://127.0.0.1:24242/health').then((response) => process.exit(response.ok ? 0 : 1)).catch(() => process.exit(1))"]
ENTRYPOINT ["/usr/bin/tini", "-s", "--"]
CMD ["bun", "/app/mewa-code.js", "--no-open"]
