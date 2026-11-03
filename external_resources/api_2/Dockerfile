FROM oven/bun:1.4.2 AS bun

FROM node:24-bookworm-slim AS builder
COPY --from=bun /usr/local/bin/bun /usr/local/bin/bun
WORKDIR /app
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile --ignore-scripts
COPY tsconfig.json vitest.config.mts ./
COPY resource.json ./
COPY auth ./auth
COPY resources ./resources
COPY *.ts ./
COPY integration ./integration
COPY test_utils ./test_utils
COPY __mocks__ ./__mocks__
RUN bun run test && find dist -name '*.test.js' -delete && rm -rf dist/integration dist/test_utils dist/__mocks__

FROM node:24-bookworm-slim AS dependencies
COPY --from=bun /usr/local/bin/bun /usr/local/bin/bun
WORKDIR /app
COPY package.json bun.lock ./
RUN bun install --production --frozen-lockfile --ignore-scripts

FROM node:24-bookworm-slim
ENV NODE_ENV=production PORT=8080
WORKDIR /app
COPY package.json ./
COPY resource.json ./
COPY --from=dependencies /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist
USER node
EXPOSE 8080
HEALTHCHECK --interval=15s --timeout=5s --start-period=10s --retries=3 CMD node -e "fetch('http://127.0.0.1:8080/health').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"
CMD ["node", "dist/main.js"]
