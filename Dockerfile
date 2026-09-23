FROM node:24.18.0-alpine3.23 AS deps

WORKDIR /app

COPY package.json package-lock.json ./
COPY apps/api/package.json ./apps/api/package.json
COPY apps/web/package.json ./apps/web/package.json
COPY packages/shared/package.json ./packages/shared/package.json
RUN npm ci

FROM deps AS web-build

COPY apps/web ./apps/web
COPY packages ./packages
RUN npm run build \
  && node apps/web/scripts/emit-caddy-csp.mjs apps/web/dist/index.html > /app/csp.caddy

FROM node:24.18.0-alpine3.23 AS api

ENV NODE_ENV=production
WORKDIR /app

COPY package.json package-lock.json ./
COPY apps/api/package.json ./apps/api/package.json
COPY apps/web/package.json ./apps/web/package.json
COPY packages/shared/package.json ./packages/shared/package.json
RUN npm ci --omit=dev

COPY apps/api ./apps/api
COPY packages/shared ./packages/shared
COPY config ./config

RUN mkdir -p /data/uploads /data/media && chown node:node /data/uploads /data/media

USER node
EXPOSE 3000

CMD ["node", "apps/api/src/server.js"]

FROM api AS worker

CMD ["node", "apps/api/src/workers/main.js"]

# Caddy with the layer4 app, so TURN/TLS can share :443 with the web origin
# (config/caddy/turn.options). Versions are pinned together: caddy-l4 v0.1.2
# requires Caddy 2.11.4.
FROM caddy:2.11.4-builder-alpine AS caddy-build

RUN xcaddy build v2.11.4 --with github.com/mholt/caddy-l4@v0.1.2

FROM caddy:2.11.4-alpine AS web

COPY --from=caddy-build /usr/bin/caddy /usr/bin/caddy
COPY Caddyfile /etc/caddy/Caddyfile
COPY config/caddy/turn.options config/caddy/turn.site /etc/caddy/turn-available/
COPY --chmod=0755 config/caddy/entrypoint.sh /usr/local/bin/voiceroom-caddy
COPY --from=web-build /app/csp.caddy /etc/caddy/csp.caddy
COPY --from=web-build /app/apps/web/dist /srv/web

CMD ["voiceroom-caddy"]
