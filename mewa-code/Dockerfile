ARG NODE_VERSION=24-bookworm-slim
ARG BUN_VERSION=1.3.12
ARG SYNARA_VERSION=0.6.3

FROM docker.io/oven/bun:${BUN_VERSION} AS bun-runtime

FROM node:${NODE_VERSION} AS extension-build

WORKDIR /src/mewa
COPY package.json tsconfig.check.json tsconfig.build.json ./
RUN npm install --no-audit --no-fund
COPY src ./src
COPY pi ./pi
RUN npm run build

FROM node:${NODE_VERSION} AS mewa-runtime-deps

WORKDIR /opt/synara/mewa
RUN printf '%s\n' \
    '{' \
    '  "name": "@mewa/runtime",' \
    '  "private": true,' \
    '  "type": "module",' \
    '  "dependencies": {' \
    '    "ssh2": "1.17.0"' \
    '  }' \
    '}' > package.json \
  && npm install --omit=dev --ignore-scripts --no-audit --no-fund \
  && npm cache clean --force

FROM node:${NODE_VERSION} AS synara-build

ARG SYNARA_VERSION
ENV NODE_OPTIONS=--max-old-space-size=4096 \
    TURBO_TELEMETRY_DISABLED=1
COPY --from=bun-runtime /usr/local/bin/bun /usr/local/bin/bun
RUN apt-get update \
  && apt-get install -y --no-install-recommends \
    ca-certificates \
    curl \
    g++ \
    git \
    make \
    python3 \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /src/synara
RUN curl --fail --location --retry 3 \
    "https://github.com/Emanuele-web04/synara/archive/refs/tags/v${SYNARA_VERSION}.tar.gz" \
    | tar -xz --strip-components=1 \
  && bun install --frozen-lockfile --ignore-scripts \
  && bun run build --filter=@synara/web --filter=@synara/cli \
  && test -f apps/server/dist/index.mjs \
  && test -f apps/server/dist/client/index.html \
  && mkdir -p /out \
  && cp -a apps/server/dist /out/dist \
  && node -e 'const fs=require("node:fs");const root=require("./package.json");const server=require("./apps/server/package.json");const catalog=root.workspaces.catalog;const dependencies=Object.fromEntries(Object.entries(server.dependencies).map(([name,value])=>{if(value==="catalog:"){const resolved=catalog[name];if(typeof resolved!=="string")throw new Error(`Missing catalog dependency: ${name}`);return [name,resolved]}if(typeof value==="string"&&value.startsWith("workspace:"))throw new Error(`Unbundled workspace dependency: ${name}`);return [name,value]}));const runtime={name:server.name,version:server.version,private:true,type:server.type,engines:server.engines,dependencies};fs.writeFileSync("/out/package.json",JSON.stringify(runtime,null,2)+"\n")' \
  && rm -rf node_modules apps/*/node_modules packages/*/node_modules scripts/node_modules \
  && bun install --frozen-lockfile --ignore-scripts --filter @synara/cli --omit dev --linker hoisted \
  && npm_config_nodedir=/usr/local npm_config_build_from_source=true npm rebuild node-pty --foreground-scripts --no-audit --no-fund \
  && node --input-type=module -e "await import('node-pty'); await import('@earendil-works/pi-coding-agent'); await import('typebox')"

FROM node:${NODE_VERSION}

RUN apt-get update \
  && apt-get install -y --no-install-recommends \
    ca-certificates \
    git \
    tini \
  && rm -rf /var/lib/apt/lists/*

ENV NODE_ENV=production \
    NODE_COMPILE_CACHE=/home/data/.cache/node-compile-cache \
    MEWA_STATE_DIR=/home/data \
    MEWA_EXTENSION_ROOT=/opt/synara/mewa/dist/pi/extensions \
    SYNARA_ENTRY=/opt/synara/dist/index.mjs \
    SYNARA_MODE=web \
    SYNARA_NO_BROWSER=1 \
    PI_CODING_AGENT_DIR=/home/data/pi \
    PI_CODING_AGENT_SESSION_DIR=/home/data/pi/sessions \
    SYNARA_HOME=/home/data/synara \
    XDG_CONFIG_HOME=/home/data/.config \
    XDG_DATA_HOME=/home/data/.local/share \
    XDG_STATE_HOME=/home/data/.local/state \
    XDG_CACHE_HOME=/home/data/.cache \
    NPM_CONFIG_CACHE=/home/data/.cache/npm \
    COREPACK_HOME=/home/data/.cache/corepack \
    NODE_REPL_HISTORY=/home/data/.local/state/node_repl_history

WORKDIR /opt/synara
COPY --from=synara-build /out/package.json ./package.json
COPY --from=synara-build /out/dist ./dist
COPY --from=synara-build /src/synara/node_modules ./node_modules
COPY --from=mewa-runtime-deps /opt/synara/mewa/package.json ./mewa/package.json
COPY --from=mewa-runtime-deps /opt/synara/mewa/node_modules ./mewa/node_modules
COPY --from=extension-build /src/mewa/dist ./mewa/dist
COPY src/bootstrap.mjs ./mewa/bootstrap.mjs

USER node
EXPOSE 3773
ENTRYPOINT ["/usr/bin/tini", "-s", "--"]
CMD ["node", "/opt/synara/mewa/bootstrap.mjs"]
