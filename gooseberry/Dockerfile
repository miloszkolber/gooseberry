# syntax=docker/dockerfile:1.7

ARG BUN_VERSION=1.3.14
ARG BUN_IMAGE=oven/bun:1.3.14-debian@sha256:9dba1a1b43ce28c9d7931bfc4eb00feb63b0114720a0277a8f939ae4dfc9db6f
ARG GO_IMAGE=golang:1.25.13-bookworm@sha256:e401dae1bf814e29204a8cb7915682e1780951e609ca0dd8865ee1937f510c48
ARG AGENT_BROWSER_VERSION=0.34.0
ARG DEBIAN_IMAGE=debian:bookworm-slim@sha256:88200866dfff7ea7f5cbcb6ec7c8a701889efe6fe859fe64d6990e4b07ea4171

FROM ${BUN_IMAGE} AS dependencies
ARG BUN_VERSION
WORKDIR /work
RUN test "$(bun --version)" = "${BUN_VERSION}"
COPY package.json bun.lock ./
COPY webui/package.json webui/package.json
COPY contracts/package.json contracts/package.json
RUN bun install --frozen-lockfile

FROM dependencies AS web-build
COPY webui/ webui/
COPY contracts/ contracts/
COPY tsconfig.base.json ./
RUN bun run build:web \
    && mkdir -p /out/licenses/frontend \
    && find node_modules -type f \( -iname 'license*' -o -iname 'notice*' \) \
        -exec cp --parents '{}' /out/licenses/frontend/ \;

FROM ${GO_IMAGE} AS go-build
WORKDIR /work
COPY go.mod go.sum ./
RUN go mod download
COPY main.go ./
COPY controller/ controller/
COPY browser/ browser/
RUN CGO_ENABLED=0 go build -trimpath -ldflags='-s -w' -o /out/gooseberry . \
    && mkdir -p /out/licenses/go \
    && cp /usr/local/go/LICENSE /out/licenses/go/LICENSE \
    && go list -m all > /out/licenses/modules.txt \
    && go list -m -f '{{if .Version}}{{.Path}}@{{.Version}} {{.Dir}}{{end}}' all \
        | while read -r module directory; do \
            test -n "$module" || continue; \
            mkdir -p "/out/licenses/$module"; \
            find "$directory" -maxdepth 1 -type f \( -iname 'license*' -o -iname 'notice*' \) \
                -exec cp '{}' "/out/licenses/$module/" \;; \
          done

FROM ${DEBIAN_IMAGE} AS runtime
ARG AGENT_BROWSER_VERSION
ARG TARGETARCH
RUN apt-get update \
    && apt-get install --no-install-recommends -y \
        ca-certificates \
        git \
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
    && rm -rf /var/lib/apt/lists/* /root/.cache

RUN mkdir -p /app /var/lib/gooseberry /var/lib/gooseberry-browser/artifacts /var/lib/gooseberry-browser/state /home/goose \
    && chown -R 1000:1000 /app /var/lib/gooseberry /var/lib/gooseberry-browser /home/goose
ENV HOME=/home/goose GOOSEBERRY_BROWSER_AUTH=false GOGC=200
WORKDIR /app
COPY --from=go-build /out/gooseberry /app/gooseberry
COPY --from=go-build /out/licenses /app/licenses
COPY --from=web-build /work/webui/dist /app/web
COPY --from=web-build /out/licenses /app/licenses
COPY browser/config.json /app/config.json
COPY LICENSE NOTICE.md /app/legal/
RUN test -x /app/gooseberry \
    && test -f /app/web/index.html \
    && test -f /app/licenses/github.com/coder/acp-go-sdk@v0.13.5/LICENSE \
    && test -f /app/licenses/github.com/coder/websocket@v1.8.15/LICENSE.txt \
    && test -f /app/licenses/github.com/fsnotify/fsnotify@v1.10.1/LICENSE \
    && test -f /app/licenses/golang.org/x/sys@v0.13.0/LICENSE \
    && test ! -e /app/gooseberry.js && test ! -d /app/node_modules \
    && ! command -v bun && ! command -v node && ! command -v go
USER 1000:1000
EXPOSE 7312 8787
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD ["/app/gooseberry", "healthcheck"]
ENTRYPOINT ["/usr/bin/tini", "-s", "--"]
CMD ["/app/gooseberry"]
