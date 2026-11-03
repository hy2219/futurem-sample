FROM oven/bun:1.4.2 AS bun

FROM node:24-bookworm-slim AS build
COPY --from=bun /usr/local/bin/bun /usr/local/bin/bun
WORKDIR /workshop/mcp
COPY mcp/package.json mcp/bun.lock ./
RUN bun install --frozen-lockfile --ignore-scripts
COPY mcp/tsconfig.json mcp/vitest.config.mts ./
COPY mcp/auth ./auth
COPY mcp/http ./http
COPY mcp/protocol ./protocol
COPY mcp/resources ./resources
COPY mcp/*.ts ./
COPY mcp/integration ./integration
COPY mcp/test_utils ./test_utils
COPY mcp/__mocks__ ./__mocks__
COPY external_resources /workshop/external_resources
RUN bun run test && bun run test:integration && find dist -name '*.test.js' -delete && rm -rf dist/integration dist/test_utils dist/__mocks__

FROM node:24-bookworm-slim AS dependencies
COPY --from=bun /usr/local/bin/bun /usr/local/bin/bun
WORKDIR /workshop
COPY mcp/package.json mcp/bun.lock ./
RUN bun install --production --frozen-lockfile --ignore-scripts

FROM node:24-bookworm-slim
ENV NODE_ENV=production PORT=8080
WORKDIR /workshop
COPY mcp/package.json ./
COPY --from=dependencies /workshop/node_modules ./node_modules
COPY --from=build /workshop/mcp/dist ./dist
USER node
EXPOSE 8080
HEALTHCHECK --interval=10s --timeout=5s --start-period=10s \
  CMD node -e "fetch('http://127.0.0.1:8080/ready').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "dist/main.js"]
