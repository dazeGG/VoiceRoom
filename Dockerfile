FROM node:24.18.0-alpine3.23 AS deps

WORKDIR /app

COPY package.json package-lock.json ./
COPY apps/api/package.json ./apps/api/package.json
COPY apps/web/package.json ./apps/web/package.json
COPY apps/widget/package.json ./apps/widget/package.json
COPY apps/admin/package.json ./apps/admin/package.json
COPY apps/site/package.json ./apps/site/package.json
COPY packages/shared/package.json ./packages/shared/package.json
COPY packages/ui/package.json ./packages/ui/package.json
COPY packages/call/package.json ./packages/call/package.json
RUN npm ci --workspace @voice-room/api --workspace @voice-room/web --workspace @voice-room/admin --workspace @voice-room/widget \
  --workspace @voice-room/shared --workspace @voice-room/ui --workspace @voice-room/call --include-workspace-root

FROM deps AS web-build

COPY apps/web ./apps/web
COPY apps/widget ./apps/widget
COPY apps/admin ./apps/admin
COPY packages ./packages
COPY scripts/build ./scripts/build
RUN npm --workspace @voice-room/web run build \
  && npm --workspace @voice-room/widget run build \
  && npm --workspace @voice-room/admin run build \
  && node apps/web/scripts/emit-caddy-csp.ts apps/web/dist/index.html > /app/csp.caddy \
  && node apps/web/scripts/emit-caddy-csp.ts apps/widget/dist/embed/v1/index.html "" https: > /app/widget-csp.caddy

FROM node:24.18.0-alpine3.23 AS api
LABEL org.voiceroom.capabilities="widget-boundary-v1"

ENV NODE_ENV=production
WORKDIR /app

COPY package.json package-lock.json ./
COPY apps/api/package.json ./apps/api/package.json
COPY apps/web/package.json ./apps/web/package.json
COPY apps/admin/package.json ./apps/admin/package.json
COPY apps/site/package.json ./apps/site/package.json
COPY packages/shared/package.json ./packages/shared/package.json
COPY packages/ui/package.json ./packages/ui/package.json
COPY packages/call/package.json ./packages/call/package.json
RUN npm ci --omit=dev --workspace @voice-room/api --workspace @voice-room/shared

COPY apps/api ./apps/api
COPY packages/shared ./packages/shared
COPY config ./config

RUN mkdir -p /data/uploads /data/media /data/personal/owner \
  && chown node:node /data/uploads /data/media /data/personal/owner \
  && chmod 0700 /data/personal/owner

USER node
EXPOSE 3000

CMD ["node", "apps/api/src/server.ts"]

FROM api AS worker

CMD ["node", "apps/api/src/workers/main.ts"]

# Caddy with the layer4 app, so TURN/TLS can share :443 with the web origin
# (config/caddy/turn.options). Versions are pinned together: caddy-l4 v0.1.2
# requires Caddy 2.11.4.
FROM caddy:2.11.4-builder-alpine AS caddy-build

RUN xcaddy build v2.11.4 --with github.com/mholt/caddy-l4@v0.1.2

FROM caddy:2.11.4-alpine AS web
LABEL org.voiceroom.capabilities="widget-boundary-v1"

COPY --from=caddy-build /usr/bin/caddy /usr/bin/caddy
COPY Caddyfile /etc/caddy/Caddyfile
COPY config/caddy/turn.options config/caddy/turn.site /etc/caddy/turn-available/
COPY config/caddy/domains-available /etc/caddy/domains-available
COPY --chmod=0755 config/caddy/entrypoint.sh /usr/local/bin/voiceroom-caddy
COPY --chmod=0755 config/caddy/archive-assets.sh /usr/local/bin/voiceroom-archive-assets
COPY --from=web-build /app/csp.caddy /etc/caddy/csp.caddy
COPY --from=web-build /app/widget-csp.caddy /etc/caddy/widget-csp.caddy
COPY config/caddy/admin-csp.caddy /etc/caddy/admin-csp.caddy
COPY --from=web-build /app/apps/web/dist /srv/web
COPY --from=web-build /app/apps/widget/dist /srv/web
# The admin app, served only on ADMIN_DOMAIN behind the staff gate (Caddyfile).
COPY --from=web-build /app/apps/admin/dist /srv/admin

CMD ["voiceroom-caddy"]

FROM node:24.18.0-alpine3.23 AS meet-build
WORKDIR /app
COPY package.json package-lock.json ./
COPY apps/meet/package.json ./apps/meet/package.json
COPY packages/shared/package.json ./packages/shared/package.json
COPY packages/ui/package.json ./packages/ui/package.json
COPY packages/call/package.json ./packages/call/package.json
RUN npm ci --workspace @voice-room/meet --workspace @voice-room/shared --workspace @voice-room/ui --workspace @voice-room/call

COPY apps/meet ./apps/meet
COPY packages ./packages
COPY scripts/build ./scripts/build
COPY apps/web/scripts/emit-caddy-csp.ts ./emit-caddy-csp.mts
RUN npm --workspace @voice-room/meet run build \
  && node emit-caddy-csp.mts apps/meet/dist/index.html "'self' {\$PERSONAL_SIGNAL_URL} stun: turn: turns:" > /app/csp.caddy

FROM caddy:2.11.4-alpine AS personal-web
COPY config/personal/Caddyfile /etc/caddy/Caddyfile
COPY --from=meet-build /app/csp.caddy /etc/caddy/personal-csp.caddy
COPY --from=meet-build /app/apps/meet/dist /srv/meet
