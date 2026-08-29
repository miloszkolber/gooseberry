# syntax=docker/dockerfile:1.7

ARG GO_IMAGE=golang:1.25.13-bookworm@sha256:e401dae1bf814e29204a8cb7915682e1780951e609ca0dd8865ee1937f510c48
ARG DEBIAN_IMAGE=debian:bookworm-slim@sha256:88200866dfff7ea7f5cbcb6ec7c8a701889efe6fe859fe64d6990e4b07ea4171
ARG AGENT_BROWSER_VERSION=0.34.0

FROM ${GO_IMAGE} AS build
WORKDIR /build

COPY go.mod ./
COPY main.go policy.go service.go token.go ./
RUN CGO_ENABLED=0 go build -trimpath -ldflags='-s -w' -o /out/gooseberry-browser .

FROM ${DEBIAN_IMAGE} AS browser
ARG AGENT_BROWSER_VERSION
ARG TARGETARCH

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
    && rm -rf /var/lib/apt/lists/* /root/.cache

WORKDIR /app
RUN mkdir -p /app /var/lib/gooseberry-browser/artifacts /var/lib/gooseberry-browser/state \
	&& chown -R 1000:1000 /app /var/lib/gooseberry-browser
COPY --from=build --chown=1000:1000 /out/gooseberry-browser /app/gooseberry-browser
COPY --chown=1000:1000 config.json /app/config.json
COPY --chown=1000:1000 LICENSE NOTICE.md /app/legal/

ENV GOOSEBERRY_BROWSER_HOST=127.0.0.1 \
	GOOSEBERRY_BROWSER_PORT=8787 \
	GOOSEBERRY_BROWSER_TOKEN="" \
	GOOSEBERRY_BROWSER_AUTH=false

USER 1000:1000
EXPOSE 8787
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD ["/app/gooseberry-browser", "healthcheck"]
ENTRYPOINT ["/usr/bin/tini", "-s", "--"]
CMD ["/app/gooseberry-browser"]
