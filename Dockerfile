FROM node:24.18.0-alpine3.23 AS deps

WORKDIR /app

COPY package.json package-lock.json ./
COPY apps/api/package.json ./apps/api/package.json
COPY apps/web/package.json ./apps/web/package.json
COPY apps/widget/package.json ./apps/widget/package.json
COPY apps/admin/package.json ./apps/admin/package.json
COPY apps/site/package.json ./apps/site/package.json
COPY apps/meet/package.json ./apps/meet/package.json
COPY packages/shared/package.json ./packages/shared/package.json
COPY packages/ui/package.json ./packages/ui/package.json
COPY packages/ui-kit/package.json ./packages/ui-kit/package.json
COPY packages/call/package.json ./packages/call/package.json
RUN npm ci --workspace @voiceroom/api --workspace @voiceroom/web --workspace @voiceroom/admin --workspace @voiceroom/widget \
  --workspace @voiceroom/shared --workspace @voiceroom/ui --workspace @voiceroom/ui-kit --workspace @voiceroom/call --include-workspace-root

FROM deps AS web-build

COPY apps/web ./apps/web
COPY packages ./packages
COPY scripts/build ./scripts/build
RUN npm --workspace @voiceroom/web run build \
  && node apps/web/scripts/emit-caddy-csp.ts apps/web/dist/index.html > /app/csp.caddy

FROM deps AS widget-build
COPY apps/widget ./apps/widget
COPY packages ./packages
COPY scripts/build ./scripts/build
COPY apps/web/scripts/emit-caddy-csp.ts ./emit-caddy-csp.mts
RUN npm --workspace @voiceroom/widget run build \
  && node emit-caddy-csp.mts apps/widget/dist/embed/v1/index.html "" https: > apps/widget/dist/csp.caddy

FROM scratch AS widget
COPY --from=widget-build /app/apps/widget/dist /dist

FROM deps AS admin-build
COPY apps/admin ./apps/admin
COPY packages ./packages
RUN npm --workspace @voiceroom/admin run build

FROM scratch AS admin
COPY --from=admin-build /app/apps/admin/dist /dist
COPY config/caddy/admin-csp.caddy /dist/csp.caddy

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
COPY packages/ui-kit/package.json ./packages/ui-kit/package.json
COPY packages/call/package.json ./packages/call/package.json
RUN npm ci --omit=dev --workspace @voiceroom/api --workspace @voiceroom/shared

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

FROM caddy:2.11.4-alpine AS caddy-runtime
COPY --from=caddy-build /usr/bin/caddy /usr/bin/caddy
COPY config/caddy/turn.options config/caddy/turn.site /etc/caddy/turn-available/
COPY --chmod=0755 config/caddy/entrypoint.sh /usr/local/bin/voiceroom-caddy
CMD ["voiceroom-caddy"]

FROM caddy-runtime AS web
LABEL org.voiceroom.capabilities="widget-boundary-v1"
LABEL org.voiceroom.requires-caddy-compose="1"

COPY Caddyfile /etc/caddy/Caddyfile
COPY config/caddy/domains-available /etc/caddy/domains-available
COPY --chmod=0755 config/caddy/prepare-web.sh /usr/local/bin/voiceroom-prepare-web
COPY --chmod=0755 config/caddy/archive-assets.sh /usr/local/bin/voiceroom-archive-assets
COPY --chmod=0755 config/caddy/archive-voice-assets.sh /usr/local/bin/voiceroom-archive-voice-assets
COPY --from=web-build /app/csp.caddy /etc/caddy/csp.caddy
COPY config/caddy/empty-client-csp.caddy /etc/caddy/empty-client-csp.caddy
COPY --from=web-build /app/apps/web/dist /srv/web

HEALTHCHECK --interval=10s --timeout=3s --start-period=10s --start-interval=1s --retries=3 \
  CMD wget -q -O /dev/null http://127.0.0.1:2019/config/ || exit 1
CMD ["voiceroom-caddy", "voiceroom-prepare-web"]

FROM node:24.18.0-alpine3.23 AS meet-build
WORKDIR /app
COPY package.json package-lock.json ./
COPY apps/meet/package.json ./apps/meet/package.json
COPY packages/shared/package.json ./packages/shared/package.json
COPY packages/ui/package.json ./packages/ui/package.json
COPY packages/ui-kit/package.json ./packages/ui-kit/package.json
COPY packages/call/package.json ./packages/call/package.json
RUN npm ci --workspace @voiceroom/meet --workspace @voiceroom/shared --workspace @voiceroom/ui --workspace @voiceroom/ui-kit --workspace @voiceroom/call

COPY apps/meet ./apps/meet
COPY packages ./packages
COPY scripts/build ./scripts/build
COPY apps/web/scripts/emit-caddy-csp.ts ./emit-caddy-csp.mts
RUN npm --workspace @voiceroom/meet run build \
  && node emit-caddy-csp.mts apps/meet/dist/index.html "'self' {\$PERSONAL_SIGNAL_URL} stun: turn: turns:" > /app/csp.caddy

FROM caddy-runtime AS personal-web
COPY config/personal/Caddyfile /etc/caddy/Caddyfile
COPY --from=meet-build /app/csp.caddy /etc/caddy/personal-csp.caddy
COPY --from=meet-build /app/apps/meet/dist /srv/meet
