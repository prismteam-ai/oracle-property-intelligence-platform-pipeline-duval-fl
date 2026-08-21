FROM node:22.18-alpine AS builder

WORKDIR /app

# Copy package files
COPY package.json tsconfig.json ./
RUN npm install

# Copy source
COPY src/ src/

# Build
RUN npm run build

# Production stage
FROM node:22.18-alpine

WORKDIR /app

COPY --from=builder /app/package.json ./
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist
COPY data/ data/

ENV NODE_ENV=production
ENV PORT=9080

EXPOSE 9080

CMD ["node", "dist/index.js"]
