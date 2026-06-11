FROM node:20.20.2-alpine3.23 AS build

WORKDIR /app

COPY package.json package-lock.json ./
COPY apps/api/package.json ./apps/api/package.json
COPY apps/web/package.json ./apps/web/package.json
COPY packages/shared/package.json ./packages/shared/package.json
RUN npm ci

COPY apps ./apps
COPY packages ./packages
RUN npm run build

FROM node:20.20.2-alpine3.23

ENV NODE_ENV=production
WORKDIR /app

COPY package.json package-lock.json ./
COPY apps/api/package.json ./apps/api/package.json
COPY apps/web/package.json ./apps/web/package.json
COPY packages/shared/package.json ./packages/shared/package.json
RUN npm ci --omit=dev

COPY apps/api ./apps/api
COPY packages/shared ./packages/shared
COPY --from=build /app/apps/web/build ./apps/web/build

USER node
EXPOSE 3000

CMD ["npm", "start"]
