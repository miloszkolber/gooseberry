ARG NODE_VERSION=24-bookworm-slim
ARG BUN_VERSION=1.3.12
ARG SYNARA_VERSION=0.7.1

FROM docker.io/oven/bun:${BUN_VERSION} AS bun-runtime

FROM node:${NODE_VERSION} AS extension-build

WORKDIR /src/mewa
COPY package.json tsconfig.check.json tsconfig.build.json ./
RUN npm install
COPY src ./src
COPY pi ./pi
RUN npm run build

FROM node:${NODE_VERSION} AS synara-build

ARG SYNARA_VERSION
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
  && bun install --frozen-lockfile \
  && bunx turbo run build --filter=@synara/cli \
  && test -f apps/server/dist/index.mjs \
  && test -f apps/server/dist/client/index.html

FROM node:${NODE_VERSION}

RUN apt-get update \
  && apt-get install -y --no-install-recommends \
    ca-certificates \
    git \
    ripgrep \
    tini \
  && rm -rf /var/lib/apt/lists/*

ENV NODE_ENV=production \
    MEWA_STATE_DIR=/home/data \
    MEWA_EXTENSION_ROOT=/opt/mewa/dist/pi/extensions \
    SYNARA_ENTRY=/opt/synara/apps/server/dist/index.mjs \
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
COPY --from=synara-build /src/synara/package.json ./package.json
COPY --from=synara-build /src/synara/node_modules ./node_modules
COPY --from=synara-build /src/synara/packages ./packages
COPY --from=synara-build /src/synara/apps/server ./apps/server
COPY --from=extension-build /src/mewa/dist /opt/mewa/dist
COPY --from=extension-build /src/mewa/node_modules /opt/mewa/node_modules
COPY src/bootstrap.mjs /opt/mewa/bootstrap.mjs

USER node
EXPOSE 3773
ENTRYPOINT ["/usr/bin/tini", "-s", "--"]
CMD ["node", "/opt/mewa/bootstrap.mjs"]
