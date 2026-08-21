FROM node:24-bookworm-slim AS build
WORKDIR /app
COPY package.json ./
RUN npm install --omit=dev
COPY src ./src
COPY pi ./pi

# Prototype image: keep a slim Debian runtime until Synara's native/runtime
# requirements are proven against a distroless final stage.
FROM node:24-bookworm-slim
ENV NODE_ENV=production \
    PI_CODING_AGENT_DIR=/var/lib/mewa/pi \
    SYNARA_HOME=/var/lib/mewa/synara
WORKDIR /app
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/src ./src
COPY --from=build /app/pi ./pi
USER node
EXPOSE 3773
CMD ["/app/node_modules/.bin/synara", "--host", "0.0.0.0", "--port", "3773", "--no-browser"]
