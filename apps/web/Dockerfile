# Deterministic build for Railway. Nixpacks guesses wrong on pnpm workspaces, so the
# image is built explicitly from the monorepo root.
FROM node:22-slim AS base
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH
RUN corepack enable

FROM base AS build
WORKDIR /repo
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml turbo.json tsconfig.base.json ./
COPY apps/web/package.json ./apps/web/
RUN pnpm install --frozen-lockfile --filter @duval-oracle/web...
COPY . .
RUN pnpm --filter @duval-oracle/web build

FROM base AS runtime
WORKDIR /app
ENV NODE_ENV=production
# Next.js standalone bundles only the traced server deps.
COPY --from=build /repo/apps/web/.next/standalone ./
COPY --from=build /repo/apps/web/.next/static ./apps/web/.next/static
COPY --from=build /repo/apps/web/public ./apps/web/public
EXPOSE 3000
ENV PORT=3000 HOSTNAME=0.0.0.0
CMD ["node", "apps/web/server.js"]
