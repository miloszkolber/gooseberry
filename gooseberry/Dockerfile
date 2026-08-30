# syntax=docker/dockerfile:1.7

ARG BUN_IMAGE=oven/bun:1.4.0-debian@sha256:5bb0f9be3a1a36a03e27c9a9dd894a3b1ad26657155c7df4dda771e17bf872ef
ARG GO_IMAGE=golang:1.27.0-trixie@sha256:ae28539d2ef595b9a2930dd7f031d9592376829dc0eae7cb869559f7d5812c3a
ARG AGENT_BROWSER_VERSION=0.34.0
ARG DEBIAN_IMAGE=debian:trixie-slim@sha256:d7e12182ce18b85b93007c1dedf31f2d29e01ccf3182cc4017c709b6259bc132

FROM --platform=$BUILDPLATFORM ${BUN_IMAGE} AS web-build
WORKDIR /work
COPY gooseberry/package.json gooseberry/bun.lock gooseberry/bunfig.toml ./
COPY gooseberry/webui/package.json webui/package.json
COPY gooseberry/contracts/package.json contracts/package.json
RUN bun install --frozen-lockfile
COPY gooseberry/webui/ webui/
COPY gooseberry/contracts/ contracts/
COPY gooseberry/tsconfig.base.json ./
RUN bun run build:web \
    && mkdir -p /out/licenses/frontend \
    && find node_modules -type f \( -iname 'license*' -o -iname 'notice*' \) \
        -exec cp --parents '{}' /out/licenses/frontend/ \;

FROM --platform=$BUILDPLATFORM ${GO_IMAGE} AS go-build
WORKDIR /work
COPY gooseberry/go.mod gooseberry/go.sum ./
RUN go mod download
COPY gooseberry/main.go ./
COPY gooseberry/controller/ controller/
COPY gooseberry/browser/ browser/
ARG TARGETOS
ARG TARGETARCH
RUN CGO_ENABLED=0 GOOS=$TARGETOS GOARCH=$TARGETARCH go build -trimpath -ldflags='-s -w' -o /out/gooseberry . \
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
    && rm -rf /var/lib/apt/lists/* /root/.cache \
    && mkdir -p /app /var/lib/gooseberry /var/lib/gooseberry-browser/artifacts /var/lib/gooseberry-browser/state /home/goose \
    && chown -R 1000:1000 /app /var/lib/gooseberry /var/lib/gooseberry-browser /home/goose
ENV HOME=/home/goose GOOSEBERRY_BROWSER_AUTH=false GOGC=200
WORKDIR /app
COPY --from=go-build /out/gooseberry /app/gooseberry
COPY --from=go-build /out/licenses /app/licenses
COPY --from=web-build /work/webui/dist /app/web
COPY --from=web-build /out/licenses /app/licenses
COPY gooseberry/browser/config.json /app/config.json
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
