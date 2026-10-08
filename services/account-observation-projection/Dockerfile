# Pin the Node 22 base by digest. Build dependencies stay in this stage only.
FROM node@sha256:0a7108bf6c7bf5de370ffb1a3ed6be93d405b43ff159f681a8d18c0e2bc2e402 AS build
WORKDIR /src
COPY package.json pnpm-lock.yaml tsconfig.json ./
RUN corepack enable && corepack pnpm@10.28.1 install --frozen-lockfile --ignore-scripts
COPY scripts/trader/build-account-observation-projection.mjs ./scripts/trader/build-account-observation-projection.mjs
COPY scripts/trader/account-observation-projection-host.ts ./scripts/trader/account-observation-projection-host.ts
COPY lib/trader/account-observation/database-node-tls.ts ./lib/trader/account-observation/database-node-tls.ts
COPY lib/trader/account-observation/derivatives/types.ts ./lib/trader/account-observation/derivatives/types.ts
COPY lib/trader/account-observation/host-role-probe.ts ./lib/trader/account-observation/host-role-probe.ts
COPY lib/trader/account-observation/postgres-reader.ts ./lib/trader/account-observation/postgres-reader.ts
COPY lib/trader/account-observation/projection-dispatcher.ts ./lib/trader/account-observation/projection-dispatcher.ts
COPY lib/trader/account-observation/projection-http.ts ./lib/trader/account-observation/projection-http.ts
COPY lib/trader/account-observation/projection-protocol.ts ./lib/trader/account-observation/projection-protocol.ts
COPY lib/trader/account-observation/projection-service-config.ts ./lib/trader/account-observation/projection-service-config.ts
COPY lib/trader/account-observation/projection-service.ts ./lib/trader/account-observation/projection-service.ts
COPY lib/trader/account-observation/types.ts ./lib/trader/account-observation/types.ts
COPY lib/trader/account-observation/validation.ts ./lib/trader/account-observation/validation.ts
RUN node scripts/trader/build-account-observation-projection.mjs /out

FROM node@sha256:0a7108bf6c7bf5de370ffb1a3ed6be93d405b43ff159f681a8d18c0e2bc2e402 AS runtime
ARG WAIA_IMAGE_RELEASE_SHA
RUN apk add --no-cache flock \
  && addgroup -S -g 10001 waia-observation-socket \
  && adduser -S -D -H -u 10001 -G waia-observation-socket waia-projection \
  && install -d -m 2750 -o 10001 -g 10001 /run/waia-observation-projection /run/secrets/waia-projection /app
RUN printf '%s\n' "$WAIA_IMAGE_RELEASE_SHA" | grep -Eq '^[0-9a-f]{40}$' \
  && printf '%s\n' "$WAIA_IMAGE_RELEASE_SHA" > /app/release-sha \
  && chown 0:0 /app/release-sha \
  && chmod 0644 /app/release-sha
COPY --from=build /out/account-observation-projection-host.mjs /app/account-observation-projection-host.mjs
COPY --from=build /out/dependency-manifest.json /app/dependency-manifest.json
COPY services/account-observation-projection/entrypoint.sh /usr/local/bin/waia-observation-projection-entrypoint
RUN chown 0:0 /app \
  && chmod 0555 /app /usr/local/bin/waia-observation-projection-entrypoint
USER 10001:10001
WORKDIR /app
ENTRYPOINT ["/usr/local/bin/waia-observation-projection-entrypoint"]
