# ---- build: install all deps, generate prisma client, build web + server ----
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY apps/server/package.json apps/server/package.json
COPY apps/web/package.json apps/web/package.json
COPY packages/shared/package.json packages/shared/package.json
RUN npm ci
COPY . .
RUN cd apps/server && npx prisma generate
RUN npm run build -w @overload/web
RUN npm run build -w @overload/server

# ---- deps: production node_modules only ----
FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
COPY apps/server/package.json apps/server/package.json
COPY apps/web/package.json apps/web/package.json
COPY packages/shared/package.json packages/shared/package.json
RUN npm ci --omit=dev

# ---- runtime ----
FROM node:22-alpine
RUN apk add --no-cache openssl
ENV NODE_ENV=production
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
# generated prisma client (engine binaries) from the build stage
COPY --from=build /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=build /app/node_modules/@prisma/client ./node_modules/@prisma/client
COPY package.json ./
COPY apps/server/package.json apps/server/package.json
COPY apps/server/prisma apps/server/prisma
COPY --from=build /app/apps/server/dist apps/server/dist
COPY --from=build /app/apps/web/dist apps/web/dist

WORKDIR /app/apps/server
EXPOSE 3001
# migrate -> idempotent catalog seed -> serve
CMD npx prisma migrate deploy && node dist/seed.js && node dist/index.js
