ARG NODE_VERSION=24-bookworm-slim
ARG BUN_VERSION=1.3.12
ARG SYNARA_VERSION=0.6.3
ARG SYNARA_SHA256=59cce6e976303d145ba18c2085a9056d0c80db0bcd90d163cf626e1c164e2b6f

FROM docker.io/oven/bun:${BUN_VERSION} AS bun-runtime

FROM node:${NODE_VERSION} AS extension-build
WORKDIR /src/mewa
COPY package.json package-lock.json tsconfig.json ./
RUN npm ci --include=dev --no-audit --no-fund
COPY pi ./pi
RUN npm run build \
  && PI_CODING_AGENT_DIR=/src/mewa/dist/pi \
     XDG_CONFIG_HOME=/tmp/signet-config \
     node node_modules/@signetai/connector-pi/bin/install.js install \
       --url http://host.docker.internal:3850 \
       --agent-id default \
  && test -s /src/mewa/dist/pi/extensions/signet-pi.js

FROM node:${NODE_VERSION} AS mewa-runtime-deps
WORKDIR /opt/synara/mewa
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts --legacy-peer-deps --no-audit --no-fund \
  && rm -rf node_modules/@earendil-works \
  && test ! -e node_modules/@earendil-works \
  && npm cache clean --force

FROM node:${NODE_VERSION} AS synara-build
ARG SYNARA_VERSION
ARG SYNARA_SHA256
ENV NODE_OPTIONS=--max-old-space-size=4096 \
    TURBO_TELEMETRY_DISABLED=1
COPY --from=bun-runtime /usr/local/bin/bun /usr/local/bin/bun
RUN apt-get update \
  && apt-get install -y --no-install-recommends \
    ca-certificates curl g++ git make python3 \
  && rm -rf /var/lib/apt/lists/*
WORKDIR /src/synara
RUN curl --fail --location --retry 3 \
    --output /tmp/synara.tar.gz \
    "https://github.com/Emanuele-web04/synara/archive/refs/tags/v${SYNARA_VERSION}.tar.gz" \
  && echo "${SYNARA_SHA256}  /tmp/synara.tar.gz" | sha256sum --check --strict \
  && tar -xzf /tmp/synara.tar.gz --strip-components=1 \
  && rm /tmp/synara.tar.gz \
  && bun install --frozen-lockfile --ignore-scripts \
  && bun run build --filter=@synara/web --filter=@synara/cli \
  && test -f apps/server/dist/index.mjs \
  && test -f apps/server/dist/client/index.html \
  && mkdir -p /out \
  && node -e 'const fs=require("node:fs");const root=require("./package.json");const server=require("./apps/server/package.json");const catalog=root.workspaces.catalog;const dependencies=Object.fromEntries(Object.entries(server.dependencies).map(([name,value])=>{if(value==="catalog:"){const resolved=catalog[name];if(typeof resolved!=="string")throw new Error(`Missing catalog dependency: ${name}`);return [name,resolved]}if(typeof value==="string"&&value.startsWith("workspace:"))throw new Error(`Unbundled workspace dependency: ${name}`);return [name,value]}));const runtime={name:server.name,version:server.version,private:true,type:server.type,engines:server.engines,dependencies};fs.writeFileSync("/out/package.json",JSON.stringify(runtime,null,2)+"\n")' \
  && rm -rf node_modules apps/*/node_modules packages/*/node_modules scripts/node_modules \
  && bun install --frozen-lockfile --ignore-scripts --filter @synara/cli --omit dev \
  && cd apps/server \
  && pty_dir="$(dirname "$(node -p "require.resolve('node-pty/package.json')")")" \
  && (cd "$pty_dir" && npm_config_nodedir=/usr/local node /usr/local/lib/node_modules/npm/node_modules/node-gyp/bin/node-gyp.js rebuild) \
  && node --input-type=module -e "await import('node-pty'); await import('@earendil-works/pi-coding-agent'); await import('effect'); await import('@effect/platform-node/NodeRuntime')"

FROM node:${NODE_VERSION}
RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates git openssh-client tini \
  && rm -rf /var/lib/apt/lists/*

ENV NODE_ENV=production \
    NODE_COMPILE_CACHE=/home/data/.cache/node-compile-cache \
    MEWA_STATE_DIR=/home/data \
    MEWA_EXTENSION_ROOT=/opt/synara/mewa/dist/pi/extensions \
    MEWA_EXA_ENABLED=1 \
    MEWA_RESTRICTED_PATHS=/home/data \
    SYNARA_ENTRY=/opt/synara/apps/server/dist/index.mjs \
    SYNARA_MODE=web \
    SYNARA_NO_BROWSER=1 \
    PI_CODING_AGENT_DIR=/home/data/pi \
    PI_CODING_AGENT_SESSION_DIR=/home/data/pi/sessions \
    PI_SUBAGENT_EXTRA_AGENT_DIRS=/opt/synara/mewa/pi/agents \
    SYNARA_HOME=/home/data/synara \
    XDG_CONFIG_HOME=/home/data/.config \
    XDG_DATA_HOME=/home/data/.local/share \
    XDG_STATE_HOME=/home/data/.local/state \
    XDG_CACHE_HOME=/home/data/.cache \
    NPM_CONFIG_CACHE=/home/data/.cache/npm \
    COREPACK_HOME=/home/data/.cache/corepack \
    NODE_REPL_HISTORY=/home/data/.local/state/node_repl_history

WORKDIR /opt/synara/apps/server
COPY --from=synara-build /out/package.json ./package.json
COPY --from=synara-build /src/synara/apps/server/dist ./dist
COPY --from=synara-build /src/synara/node_modules /opt/synara/node_modules
COPY --from=synara-build /src/synara/apps/server/node_modules ./node_modules
COPY --from=mewa-runtime-deps /opt/synara/mewa/package.json /opt/synara/mewa/package.json
COPY --from=mewa-runtime-deps /opt/synara/mewa/package-lock.json /opt/synara/mewa/package-lock.json
COPY --from=mewa-runtime-deps /opt/synara/mewa/node_modules /opt/synara/mewa/node_modules
COPY --from=extension-build /src/mewa/dist /opt/synara/mewa/dist
COPY pi/agents /opt/synara/mewa/pi/agents
COPY src/bootstrap.mjs /opt/synara/mewa/bootstrap.mjs
RUN set -eu \
  && mkdir -p /opt/synara/mewa/node_modules/@earendil-works \
  && for package in pi-agent-core pi-ai pi-coding-agent pi-tui; do \
       test -e "/opt/synara/apps/server/node_modules/@earendil-works/$package"; \
       test ! -e "/opt/synara/mewa/node_modules/@earendil-works/$package"; \
       ln -s "/opt/synara/apps/server/node_modules/@earendil-works/$package" "/opt/synara/mewa/node_modules/@earendil-works/$package"; \
     done \
  && test -s /opt/synara/mewa/dist/pi/extensions/signet-pi.js \
  && test -e /opt/synara/mewa/node_modules/pi-mcp-adapter/index.ts \
  && test -e /opt/synara/mewa/node_modules/pi-subagents/index.ts

USER node
EXPOSE 3773
ENTRYPOINT ["/usr/bin/tini", "-s", "--"]
CMD ["node", "/opt/synara/mewa/bootstrap.mjs"]
