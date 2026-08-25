# syntax=docker/dockerfile:1.7

ARG BUN_VERSION=1.3.14
ARG BUN_IMAGE=oven/bun:1.3.14-debian@sha256:9dba1a1b43ce28c9d7931bfc4eb00feb63b0114720a0277a8f939ae4dfc9db6f

FROM ${BUN_IMAGE} AS dependencies
ARG BUN_VERSION
WORKDIR /work

RUN test "$(bun --version)" = "${BUN_VERSION}"

# Keep the dependency layer independent from application source changes.
COPY package.json bun.lock ./
COPY apps/cli/package.json apps/cli/package.json
COPY apps/web/package.json apps/web/package.json
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
		--target bun \
	&& bash scripts/prepare-controller-runtime.sh \
		packages/server/node_modules/pi-subagents \
		/runtime/extensions/pi-subagents

FROM ${BUN_IMAGE} AS production-dependencies
ARG BUN_VERSION
ARG TARGETARCH
WORKDIR /work

RUN test "$(bun --version)" = "${BUN_VERSION}"
RUN apt-get update \
    && apt-get install --no-install-recommends -y findutils \
    && rm -rf /var/lib/apt/lists/*
COPY package.json bun.lock ./
COPY apps/cli/package.json apps/cli/package.json
COPY apps/web/package.json apps/web/package.json
COPY packages/contracts/package.json packages/contracts/package.json
COPY packages/pi-mewa-browser/package.json packages/pi-mewa-browser/package.json
COPY packages/server/package.json packages/server/package.json
COPY packages/shared/package.json packages/shared/package.json
RUN bun install --frozen-lockfile --production --filter '@mewa-code/server' \
    && rm -rf packages/server/node_modules/@mewa-code \
    && mkdir -p /runtime/node_modules /runtime/pty \
    && cp -aL packages/server/node_modules/. /runtime/node_modules/ \
    && rm -rf /runtime/node_modules/.bin \
    && case "${TARGETARCH}" in \
        amd64) cp packages/server/node_modules/bun-pty/rust-pty/target/release/librust_pty.so /runtime/pty/librust_pty.so ;; \
        arm64) cp packages/server/node_modules/bun-pty/rust-pty/target/release/librust_pty_arm64.so /runtime/pty/librust_pty.so ;; \
        *) echo "unsupported target architecture: ${TARGETARCH}" >&2; exit 1 ;; \
    esac \
	&& rm -rf /runtime/node_modules/bun-pty /runtime/node_modules/@mewa-code \
	&& rm -rf /runtime/node_modules/pi-web-access /runtime/node_modules/pi-subagents \
	&& find /runtime/node_modules -type d \( -name test -o -name tests -o -name __tests__ \) -prune -exec rm -rf '{}' + \
	&& find /runtime/node_modules -type f \( -name '*.test.js' -o -name '*.test.mjs' -o -name '*.test.ts' \) -delete

FROM ${BUN_IMAGE} AS controller
ARG BUN_VERSION

RUN apt-get update \
    && apt-get install --no-install-recommends -y \
        bash \
        ca-certificates \
        git \
        tini \
    && rm -rf /var/lib/apt/lists/* /root/.cache /root/.bun /home/bun/.bun/install/cache \
    && test "$(bun --version)" = "${BUN_VERSION}"

ENV NODE_ENV=production \
    HOME=/home/bun \
    MEWA_CODE_DATA_DIR=/var/lib/mewa \
	MEWA_CODE_STATIC_DIR=/app/web \
	BUN_PTY_LIB=/usr/local/lib/mewa/librust_pty.so \
	MEWA_CODE_BROWSER_EXTENSION_PATH=/app/extensions/mewa-browser.js \
	MEWA_CODE_WEB_ACCESS_EXTENSION_PATH=/app/extensions/mewa-web-access.js \
	MEWA_CODE_SUBAGENTS_EXTENSION_PATH=/app/extensions/pi-subagents/index.ts

WORKDIR /app
RUN mkdir -p /app/extensions /var/lib/mewa /home/bun/.pi /workspace /usr/local/lib/mewa \
    && chown -R bun:bun /app /var/lib/mewa /home/bun/.pi /workspace

COPY --from=build --chown=bun:bun /work/apps/cli/dist/index.js /app/mewa-code.js
COPY --from=build --chown=bun:bun /work/apps/web/dist /app/web
COPY --from=build --chown=bun:bun /runtime/extensions/mewa-browser.js /app/extensions/mewa-browser.js
COPY --from=build --chown=bun:bun /runtime/extensions/mewa-web-access.js /app/extensions/mewa-web-access.js
COPY --from=build --chown=bun:bun /runtime/extensions/pi-subagents /app/extensions/pi-subagents
COPY --from=production-dependencies /runtime/node_modules /app/node_modules
COPY --from=production-dependencies /runtime/pty/librust_pty.so /usr/local/lib/mewa/librust_pty.so
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
