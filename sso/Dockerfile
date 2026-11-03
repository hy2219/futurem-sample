FROM oven/bun:1.4.2 AS bun

FROM node:24-bookworm-slim AS builder
COPY --from=bun /usr/local/bin/bun /usr/local/bin/bun
WORKDIR /build
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile --ignore-scripts
COPY tsconfig.json vitest.config.mts ./
COPY auth ./auth
COPY http ./http
COPY *.ts ./
COPY integration ./integration
COPY test_utils ./test_utils
COPY __mocks__ ./__mocks__
RUN bun run test && bun run test:integration && find dist -name '*.test.js' -delete && rm -rf dist/integration dist/test_utils dist/__mocks__

FROM node:24-bookworm-slim AS dependencies
COPY --from=bun /usr/local/bin/bun /usr/local/bin/bun
WORKDIR /app
COPY package.json bun.lock ./
RUN bun install --production --frozen-lockfile --ignore-scripts

FROM node:24-bookworm-slim AS runtime
ENV NODE_ENV=production PORT=8080
WORKDIR /app
COPY package.json ./
COPY --from=dependencies /app/node_modules ./node_modules
COPY --from=builder /build/dist ./dist
USER node
EXPOSE 8080
HEALTHCHECK --interval=10s --timeout=3s --start-period=5s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||8080)+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "dist/main.js"]
