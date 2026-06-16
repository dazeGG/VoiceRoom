FROM node:20.20.2-alpine3.23 AS deps

WORKDIR /app

COPY package.json package-lock.json ./
COPY apps/api/package.json ./apps/api/package.json
COPY apps/web/package.json ./apps/web/package.json
COPY packages/shared/package.json ./packages/shared/package.json
RUN npm ci

FROM deps AS web-build

COPY apps/web ./apps/web
COPY packages ./packages
RUN npm run build

FROM node:20.20.2-alpine3.23 AS api

ENV NODE_ENV=production
WORKDIR /app

COPY package.json package-lock.json ./
COPY apps/api/package.json ./apps/api/package.json
COPY apps/web/package.json ./apps/web/package.json
COPY packages/shared/package.json ./packages/shared/package.json
RUN npm ci --omit=dev

COPY apps/api ./apps/api
COPY packages/shared ./packages/shared

USER node
EXPOSE 3000

CMD ["npm", "--workspace", "@voice-room/api", "start"]

FROM caddy:2.11.3-alpine AS web

COPY Caddyfile /etc/caddy/Caddyfile
COPY --from=web-build /app/apps/web/dist /srv/web
