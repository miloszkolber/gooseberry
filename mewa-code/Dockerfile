ARG NODE_VERSION=24-bookworm-slim
ARG SYNARA_VERSION=0.7.1

FROM node:${NODE_VERSION} AS extension-build

WORKDIR /src/mewa
COPY package.json tsconfig.check.json tsconfig.build.json ./
RUN npm install
COPY src ./src
COPY pi ./pi
RUN npm run build

FROM node:${NODE_VERSION} AS synara-package

ARG SYNARA_VERSION
RUN apt-get update \
  && apt-get install -y --no-install-recommends \
    ca-certificates \
    curl \
    g++ \
    make \
    python3 \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /opt/synara
RUN curl --fail --location --retry 3 \
    "https://github.com/Emanuele-web04/synara/releases/download/v${SYNARA_VERSION}/synara-server-${SYNARA_VERSION}.tar.gz" \
    | tar -xz \
  && node -e 'const fs=require("node:fs");const p=require("./package.json");delete p.scripts;fs.writeFileSync("package.json",JSON.stringify(p,null,2)+"\n")' \
  && npm install --omit=dev \
  && npm install --no-save ssh2@1.17.0 typebox@1.0.40 \
  && npm cache clean --force

COPY --from=extension-build /src/mewa/dist /opt/synara/mewa/dist

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
COPY --from=synara-package /opt/synara /opt/synara
COPY src/bootstrap.mjs /opt/mewa/bootstrap.mjs

USER node
EXPOSE 3773
ENTRYPOINT ["/usr/bin/tini", "-s", "--"]
CMD ["node", "/opt/mewa/bootstrap.mjs"]
