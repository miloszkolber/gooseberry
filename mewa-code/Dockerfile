FROM node:24-bookworm-slim AS build

WORKDIR /app
COPY package.json tsconfig.check.json tsconfig.build.json ./
RUN npm install
COPY src ./src
COPY pi ./pi
RUN npm run build \
  && npm prune --omit=dev \
  && npm cache clean --force

FROM node:24-bookworm-slim

RUN apt-get update \
  && apt-get install -y --no-install-recommends \
    ca-certificates \
    git \
    ripgrep \
    tini \
  && rm -rf /var/lib/apt/lists/*

ENV NODE_ENV=production \
    MEWA_STATE_DIR=/home/data \
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

WORKDIR /app
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/package.json ./package.json
COPY --from=build /app/dist ./dist
COPY --from=build /app/src/bootstrap.mjs ./src/bootstrap.mjs

USER node
EXPOSE 3773
ENTRYPOINT ["/usr/bin/tini", "-s", "--"]
CMD ["node", "src/bootstrap.mjs"]
