FROM node:22.18-alpine AS builder

WORKDIR /app

# Copy package files and tsconfig
COPY pipeline/package.json pipeline/tsconfig.json ./
COPY tsconfig.base.json /tsconfig.base.json
RUN npm install

# Copy source
COPY pipeline/src/ src/

# Build — exclude duckdb files (native dep not needed at runtime)
RUN printf '{\n  "extends": "./tsconfig.json",\n  "exclude": ["node_modules", "dist", "tests", "src/lib/duckdb.ts", "src/scripts/query.ts", "src/scripts/deploy.ts", "src/seeds/load-seed.ts"]\n}\n' > tsconfig.build.json && \
    npx tsc -p tsconfig.build.json

# Production stage
FROM node:22.18-alpine

WORKDIR /app

COPY --from=builder /app/package.json ./
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist
COPY pipeline/data/ data/

ENV NODE_ENV=production
ENV PORT=9080

EXPOSE 9080

CMD ["node", "dist/index.js"]
