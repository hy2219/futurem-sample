FROM oven/bun:1.4.2 AS bun

FROM node:24-bookworm-slim AS builder
COPY --from=bun /usr/local/bin/bun /usr/local/bin/bun
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
COPY package.json bun.lock ./
COPY vendor ./vendor
RUN bun install --frozen-lockfile --ignore-scripts
COPY . .
RUN bun run test && bun run build

FROM node:24-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production PORT=8080 HOSTNAME=0.0.0.0 NEXT_TELEMETRY_DISABLED=1
COPY --from=builder --chown=node:node /app/.next/standalone ./
COPY --from=builder --chown=node:node /app/.next/static ./.next/static
USER node
EXPOSE 8080
HEALTHCHECK --interval=5s --timeout=5s --start-period=5s --retries=10 \
  CMD node --input-type=module -e "const r = await fetch('http://127.0.0.1:' + process.env.PORT + '/health', { signal: AbortSignal.timeout(4000) }); if (r.status !== 200 || (await r.json()).status !== 'ok') process.exit(1);"
CMD ["sh", "-c", "APP_RUNTIME_NODE_ENV=\"$NODE_ENV\" exec node server.js"]
