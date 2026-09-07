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
RUN npm run build

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

FROM python:3.12.12-slim-bookworm AS musicbot

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1
WORKDIR /app

RUN apt-get update \
 && apt-get install -y --no-install-recommends ffmpeg \
 && rm -rf /var/lib/apt/lists/*

COPY apps/music-bot/pyproject.toml ./pyproject.toml
COPY apps/music-bot/src ./src
RUN pip install --no-cache-dir .

RUN useradd --create-home --uid 10001 musicbot
USER musicbot
EXPOSE 8080

CMD ["python", "-m", "music_bot"]

FROM caddy:2.11.3-alpine AS web

COPY Caddyfile /etc/caddy/Caddyfile
COPY --from=web-build /app/apps/web/dist /srv/web
