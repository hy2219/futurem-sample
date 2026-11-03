FROM oven/bun:1.4.2 AS bun
FROM ghcr.io/casey/just:1.58.0 AS just
FROM mcr.microsoft.com/devcontainers/javascript-node:24-bookworm
COPY --from=bun /usr/local/bin/bun /usr/local/bin/bun
COPY --from=just /just /usr/local/bin/just
