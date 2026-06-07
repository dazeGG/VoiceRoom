FROM node:20.20.2-alpine3.23

ENV NODE_ENV=production
WORKDIR /app

RUN corepack enable && corepack prepare pnpm@10.23.0 --activate

COPY package.json pnpm-lock.yaml ./
RUN pnpm install --prod --frozen-lockfile

COPY server.js ./
COPY public ./public

USER node
EXPOSE 3000

CMD ["node", "server.js"]
