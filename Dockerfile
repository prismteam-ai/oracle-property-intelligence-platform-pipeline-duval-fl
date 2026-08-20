# Deterministic build for Railway.
# Railway resolves only a root-level ./Dockerfile, so the build is driven from the
# monorepo root and scoped to a single workspace package via pnpm --filter.
FROM node:22-slim

ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH
RUN corepack enable && corepack prepare pnpm@10.28.2 --activate

WORKDIR /repo
COPY . .
RUN pnpm install --frozen-lockfile
RUN pnpm --filter @duval-oracle/web build

ENV NODE_ENV=production
ENV PORT=3000 HOSTNAME=0.0.0.0
EXPOSE 3000
CMD ["pnpm", "--filter", "@duval-oracle/web", "start"]
