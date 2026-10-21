# syntax=docker/dockerfile:1
#
# Imagen linux/arm64 del panel admin (Raspberry Pi).
# Se construye desde la raíz del monorepo:
#
#   docker build -f apps/admin/Dockerfile -t nfc-admin:latest .
#   # desde x86 (QEMU/buildx):
#   docker buildx build --platform linux/arm64 -f apps/admin/Dockerfile -t nfc-admin:latest --load .
#
# Ambas etapas son arm64 porque better-sqlite3 es un módulo nativo.

ARG NODE_IMAGE=node:24-bookworm-slim

FROM --platform=linux/arm64 ${NODE_IMAGE} AS build
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
# Toolchain por si better-sqlite3 no encuentra binario precompilado y debe compilar.
RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ \
  && rm -rf /var/lib/apt/lists/* \
  && corepack enable
WORKDIR /repo

# Manifiestos primero para aprovechar la caché de capas.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/shared/package.json packages/shared/
COPY apps/admin/package.json apps/admin/
RUN --mount=type=cache,id=pnpm,target=/pnpm/store \
  pnpm install --frozen-lockfile --filter admin...

COPY tsconfig.base.json ./
COPY packages/shared packages/shared
COPY apps/admin apps/admin
RUN pnpm --filter admin build \
  && pnpm --filter admin deploy --prod --legacy /out

FROM --platform=linux/arm64 ${NODE_IMAGE} AS runtime
ENV NODE_ENV=production \
  PORT=3000 \
  DATABASE_PATH=/data/admin.db
WORKDIR /app
COPY --from=build --chown=node:node /out ./
RUN mkdir -p /data && chown node:node /data
USER node
VOLUME ["/data"]
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:'+process.env.PORT+'/health').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"]
CMD ["node", "--enable-source-maps", "dist/index.js"]
