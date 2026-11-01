# Chamber — production image
# Node 24 + Debian slim (OpenSSL is required by Prisma query engines).
FROM node:24-bookworm-slim

RUN apt-get update \
  && apt-get install -y --no-install-recommends openssl ca-certificates \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app
ENV NODE_ENV=production
ENV SERVE_WEB=true

# `prisma generate` reads the datasource block, so DATABASE_URL must resolve even
# though no connection is opened at build time. It is scoped to this RUN only, so
# the finished image carries no placeholder credential.

COPY package.json package-lock.json ./
COPY apps/server/package.json apps/server/package.json
COPY apps/web/package.json apps/web/package.json
COPY packages/db/package.json packages/db/package.json
COPY packages/shared/package.json packages/shared/package.json

RUN npm ci --include=dev --no-audit --no-fund

# The lockfile can be resolved on Windows, where npm records only the win32
# Rollup binary; restore the binding for this image's platform before building.
COPY scripts/ensure-rollup-binding.mjs ./scripts/ensure-rollup-binding.mjs
RUN node scripts/ensure-rollup-binding.mjs

COPY packages packages
COPY apps apps
COPY scripts scripts

RUN DATABASE_URL="postgresql://build:build@localhost:5432/build" \
  node node_modules/prisma/build/index.js generate --schema packages/db/prisma/schema.prisma
RUN npm run build -w @chamber/web

# Uploads land on a writable volume-backed directory owned by the runtime user.
RUN mkdir -p storage && chown -R node:node /app
USER node

EXPOSE 3000

CMD ["sh", "-c", "node node_modules/prisma/build/index.js migrate deploy --schema packages/db/prisma/schema.prisma && node packages/db/prisma/seed.js && node apps/server/src/index.js"]
