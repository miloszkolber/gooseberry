ARG NODE_VERSION=24-bookworm-slim

FROM node:${NODE_VERSION}

RUN apt-get update \
  && apt-get install -y --no-install-recommends \
    ca-certificates \
    chromium \
    tini \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY package.json ./
RUN npm install --omit=dev \
  && npm cache clean --force
COPY config.json ./config.json
COPY src ./src

ENV NODE_ENV=production \
    PORT=8787 \
    BROWSER_ARTIFACT_ROOT=/state/artifacts \
    AGENT_BROWSER_CONFIG=/app/config.json

USER node
EXPOSE 8787
ENTRYPOINT ["/usr/bin/tini", "-s", "--"]
CMD ["node", "src/server.mjs"]
