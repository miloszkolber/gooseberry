# syntax=docker/dockerfile:1

ARG PASEO_VERSION=0.5.0-beta.4
ARG PI_VERSION=0.81.1

FROM node:24-bookworm-slim AS extension-build
WORKDIR /src/mewa-code
COPY mewa-code/package.json mewa-code/tsconfig.check.json mewa-code/tsconfig.build.json ./
RUN npm install
COPY mewa-code/src ./src
COPY mewa-code/pi ./pi
RUN npm run build \
  && npm prune --omit=dev \
  && npm cache clean --force

FROM ghcr.io/getpaseo/paseo:${PASEO_VERSION}

ARG PI_VERSION
USER root
RUN npm install -g --ignore-scripts "@earendil-works/pi-coding-agent@${PI_VERSION}" \
  && npm cache clean --force

COPY --from=extension-build /src/mewa-code/dist /opt/mewa/dist
COPY --from=extension-build /src/mewa-code/node_modules /opt/mewa/node_modules
COPY variants/paseo-pi/bootstrap.mjs /opt/mewa/bootstrap.mjs

ENV MEWA_STATE_DIR=/home/data \
    PASEO_HOME=/home/data/paseo \
    PASEO_LISTEN=0.0.0.0:6767 \
    PASEO_WEB_UI_ENABLED=true \
    PI_COMMAND=/usr/local/bin/pi \
    PI_CODING_AGENT_DIR=/home/data/pi \
    PI_CODING_AGENT_SESSION_DIR=/home/data/pi/sessions \
    PI_SKIP_VERSION_CHECK=1 \
    PI_TELEMETRY=0 \
    XDG_CONFIG_HOME=/home/data/.config \
    XDG_DATA_HOME=/home/data/.local/share \
    XDG_STATE_HOME=/home/data/.local/state \
    XDG_CACHE_HOME=/home/data/.cache \
    NPM_CONFIG_CACHE=/home/data/.cache/npm \
    NPM_CONFIG_USERCONFIG=/home/data/.config/npm/npmrc \
    COREPACK_HOME=/home/data/.cache/corepack \
    NODE_REPL_HISTORY=/home/data/.local/state/node_repl_history

EXPOSE 6767
CMD ["node", "/opt/mewa/bootstrap.mjs"]
