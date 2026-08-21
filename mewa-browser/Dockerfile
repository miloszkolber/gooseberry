FROM node:24-bookworm-slim

RUN apt-get update \
  && apt-get install -y --no-install-recommends chromium ca-certificates \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY package.json ./
RUN npm install --omit=dev
COPY src ./src

ENV NODE_ENV=production \
    PORT=8787 \
    BROWSER_ARTIFACT_ROOT=/artifacts

USER node
EXPOSE 8787
CMD ["node", "src/server.mjs"]
