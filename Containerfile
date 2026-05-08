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
ENV NODE_ENV=production HOST=0.0.0.0 PORT=3000 DATABASE_URL=/data/local.db ATTACHMENTS_DIR=/data/attachments ORIGIN=http://localhost:3000 PROTOCOL_HEADER=x-forwarded-proto HOST_HEADER=x-forwarded-host
COPY --from=build /app/build ./build
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/package.json ./package.json
COPY --from=build /app/src/lib/server/db/migrations ./migrations
COPY --from=build /app/scripts ./scripts
RUN mkdir -p /data && chown -R node:node /data /app
EXPOSE 3000
USER node
VOLUME ["/data"]
CMD ["sh", "-c", "node scripts/migrate.mjs && node scripts/seed-admin.mjs && node build"]
