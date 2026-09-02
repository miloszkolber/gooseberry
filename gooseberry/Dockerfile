# syntax=docker/dockerfile:1.7

ARG BUN_IMAGE=oven/bun:1.4.0-debian@sha256:5bb0f9be3a1a36a03e27c9a9dd894a3b1ad26657155c7df4dda771e17bf872ef
ARG GO_IMAGE=golang:1.27.0-trixie@sha256:ae28539d2ef595b9a2930dd7f031d9592376829dc0eae7cb869559f7d5812c3a
ARG AGENT_BROWSER_VERSION=0.34.0
ARG DEBIAN_IMAGE=debian:trixie-slim@sha256:d7e12182ce18b85b93007c1dedf31f2d29e01ccf3182cc4017c709b6259bc132
ARG VERSION=0.0.0-dev
ARG REVISION=unknown

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

FROM --platform=$BUILDPLATFORM ${GO_IMAGE} AS go-source
WORKDIR /work
COPY gooseberry/go.mod gooseberry/go.sum ./
RUN go mod download
COPY gooseberry/main.go ./
COPY gooseberry/cmd/ cmd/
COPY gooseberry/controller/ controller/
COPY gooseberry/browser/ browser/
COPY gooseberry/internal/ internal/

FROM go-source AS go-build
ARG TARGETOS
ARG TARGETARCH
ARG VERSION
ARG REVISION
RUN export CGO_ENABLED=0 GOOS=$TARGETOS GOARCH=$TARGETARCH; \
    set -eu; \
    for entry in gooseberry:. gooseberry-browser:./cmd/browser; do \
        binary=${entry%%:*}; package=${entry#*:}; \
        go build -trimpath -ldflags="-s -w -X main.version=$VERSION -X main.revision=$REVISION" -o "/out/$binary" "$package"; \
        mkdir -p "/out/licenses/$binary/go"; \
        cp /usr/local/go/LICENSE "/out/licenses/$binary/go/LICENSE"; \
        go list -deps -f '{{with .Module}}{{if .Version}}{{.Path}}@{{.Version}} {{.Dir}}{{end}}{{end}}' "$package" \
            > /tmp/modules.unsorted; \
        sort -u /tmp/modules.unsorted > /tmp/modules; \
        cut -d ' ' -f1 /tmp/modules > "/out/licenses/$binary/modules.txt"; \
        while read -r module directory; do \
            test -n "$module" || continue; \
            mkdir -p "/out/licenses/$binary/$module"; \
            find "$directory" -maxdepth 1 -type f \( -iname 'license*' -o -iname 'notice*' \) \
                -exec cp '{}' "/out/licenses/$binary/$module/" \;; \
        done < /tmp/modules; \
    done

FROM go-source AS ui-test-build
COPY gooseberry/tests/ui/fixture/ tests/ui/fixture/
ARG TARGETOS
ARG TARGETARCH
RUN CGO_ENABLED=0 GOOS=$TARGETOS GOARCH=$TARGETARCH \
    go build -trimpath -ldflags='-s -w' -o /out/gooseberry-ui-fixture ./tests/ui/fixture

FROM ${DEBIAN_IMAGE} AS runtime-base
RUN apt-get update \
    && apt-get install --no-install-recommends -y ca-certificates tini \
    && rm -rf /var/lib/apt/lists/* \
    && mkdir -p /app /home/goose \
    && chown 1000:1000 /app /home/goose
ENV HOME=/home/goose
WORKDIR /app
COPY LICENSE NOTICE.md /app/legal/
ENTRYPOINT ["/usr/bin/tini", "-s", "--"]

FROM runtime-base AS browser-packages
ARG AGENT_BROWSER_VERSION
ARG TARGETARCH
RUN apt-get update \
    && apt-get install --no-install-recommends -y \
        chromium \
        curl \
        fonts-liberation \
        fonts-noto-cjk \
        fonts-noto-color-emoji \
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
    && mkdir -p /app/licenses/agent-browser \
    && curl --fail --location --retry 3 \
        --output /app/licenses/agent-browser/LICENSE \
        "https://raw.githubusercontent.com/vercel-labs/agent-browser/v${AGENT_BROWSER_VERSION}/LICENSE" \
    && printf '%s\n' \
        '#!/bin/sh' \
        'export PATH=/usr/local/bin:/usr/bin:/bin' \
        'export AGENT_BROWSER_EXECUTABLE_PATH=/usr/bin/chromium' \
        'exec /usr/local/libexec/agent-browser "$@"' \
        > /usr/local/bin/agent-browser \
    && chmod 0755 /usr/local/bin/agent-browser \
    && apt-get purge -y --auto-remove curl \
    && rm -rf /var/lib/apt/lists/* /root/.cache \
    && mkdir -p /var/lib/gooseberry-browser/artifacts /var/lib/gooseberry-browser/state \
    && chown -R 1000:1000 /var/lib/gooseberry-browser

FROM browser-packages AS browser
COPY --from=go-build /out/gooseberry-browser /app/gooseberry-browser
COPY --from=go-build /out/licenses/gooseberry-browser /app/licenses
COPY gooseberry/browser/config.json /app/config.json
RUN test -x /app/gooseberry-browser \
    && test -s /app/licenses/agent-browser/LICENSE \
    && test ! -e /app/gooseberry && test ! -d /app/web \
    && ! command -v git && ! command -v bun && ! command -v node && ! command -v go
USER 1000:1000
EXPOSE 8787
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD ["/app/gooseberry-browser", "healthcheck"]
CMD ["/app/gooseberry-browser"]

FROM browser-packages AS ui-acceptance
RUN apt-get update \
    && apt-get install --no-install-recommends -y git \
    && rm -rf /var/lib/apt/lists/* \
    && mkdir -p /app/web /artifacts \
    && chown -R 1000:1000 /artifacts
COPY --from=ui-test-build /out/gooseberry-ui-fixture /app/gooseberry-ui-fixture
COPY --from=web-build /work/webui/dist /app/web
COPY gooseberry/tests/ui/run.sh /app/run-ui-acceptance
RUN chmod 0755 /app/run-ui-acceptance \
    && test -x /app/gooseberry-ui-fixture \
    && test -f /app/web/index.html \
    && ! command -v bun && ! command -v node && ! command -v go
USER 1000:1000
CMD ["/app/run-ui-acceptance"]

# Keep the application last: a build without --target produces only Gooseberry.
FROM runtime-base AS gooseberry
RUN apt-get update \
    && apt-get install --no-install-recommends -y git \
    && rm -rf /var/lib/apt/lists/* \
    && mkdir -p /var/lib/gooseberry \
    && chown 1000:1000 /var/lib/gooseberry
ENV GOGC=200
COPY --from=go-build /out/gooseberry /app/gooseberry
COPY --from=go-build /out/licenses/gooseberry /app/licenses
COPY --from=web-build /work/webui/dist /app/web
COPY --from=web-build /out/licenses /app/licenses
RUN test -x /app/gooseberry \
    && test -f /app/web/index.html \
    && test ! -e /app/gooseberry-browser && test ! -e /app/config.json \
    && test ! -d /var/lib/gooseberry-browser && test ! -d /app/node_modules \
    && ! command -v chromium && ! command -v agent-browser \
    && ! command -v bun && ! command -v node && ! command -v go
USER 1000:1000
EXPOSE 7312
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD ["/app/gooseberry", "healthcheck"]
CMD ["/app/gooseberry"]
