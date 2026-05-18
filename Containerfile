# syntax=docker/dockerfile:1.7
FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

FROM node:22-alpine AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build && npm prune --omit=dev

FROM node:22-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production HOST=0.0.0.0 PORT=3000 DATABASE_URL=/data/db/local.db ATTACHMENTS_DIR=/data/attachments PROTOCOL_HEADER=x-forwarded-proto HOST_HEADER=x-forwarded-host
# Note: ORIGIN is intentionally NOT set here. Behind a TLS-terminating proxy
# (OpenShift Route, nginx, etc.) adapter-node derives the origin from the
# x-forwarded-* headers above. For local podman dev with no proxy, pass
# `-e ORIGIN=http://localhost:3000` (or whichever host/port is exposed).
COPY --from=build /app/build ./build
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/package.json ./package.json
COPY --from=build /app/src/lib/server/db/migrations ./migrations
COPY --from=build /app/scripts ./scripts
# Phase 3: keyword list for OCR. Edit and rebuild to change.
COPY --from=build /app/config ./config
# OpenShift's Restricted SCC overrides the image USER with an arbitrary high UID
# and adds it to GID 0. Make /data/{db,attachments} and /app owned by root
# group with group-write so the container can run as either `node` (local
# podman/docker) or an arbitrary OpenShift UID. See
# https://docs.openshift.com/container-platform/latest/openshift_images/create-images.html#use-uid_create-images
RUN mkdir -p /data/db /data/attachments /app/attachments && \
    chown -R node:0 /data /app && \
    chmod -R g=u /data /app
EXPOSE 3000
USER 1000
VOLUME ["/data/db", "/data/attachments"]
CMD ["sh", "-c", "node scripts/migrate.mjs && node scripts/seed-admin.mjs && node build"]
