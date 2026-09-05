FROM node:22-alpine AS dependencies

WORKDIR /app
RUN corepack enable
COPY package.json pnpm-lock.yaml ./
RUN corepack pnpm@10.28.1 install --frozen-lockfile

FROM node:22-alpine

ARG WAIA_IMAGE_RELEASE_SHA
RUN case "$WAIA_IMAGE_RELEASE_SHA" in (*[!0-9a-f]*|'') exit 1;; esac \
    && test "${#WAIA_IMAGE_RELEASE_SHA}" -eq 40
LABEL org.opencontainers.image.revision="${WAIA_IMAGE_RELEASE_SHA}" \
      org.opencontainers.image.title="waia-ai-trader-historical-execution-host"

RUN addgroup -S waia && adduser -S waia -G waia

WORKDIR /app

COPY --from=dependencies /app/node_modules ./node_modules
COPY package.json tsconfig.json ./
COPY db ./db
COPY lib ./lib
COPY scripts/trader/historical-simulation-v2-prepare-proposal.ts ./scripts/trader/historical-simulation-v2-prepare-proposal.ts
COPY scripts/trader/historical-simulation-v2-launch-approved.ts ./scripts/trader/historical-simulation-v2-launch-approved.ts
COPY services/ai-trader-execution-host ./services/ai-trader-execution-host

USER waia

EXPOSE 8080

ENV EXECUTION_HOST_PORT=8080 \
    NODE_ENV=production \
    WAIA_IMAGE_RELEASE_SHA="${WAIA_IMAGE_RELEASE_SHA}"

CMD ["node", "services/ai-trader-execution-host/entrypoint.mjs"]
