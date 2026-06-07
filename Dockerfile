FROM node:20.20.2-alpine3.23

ENV NODE_ENV=production
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY server.js ./
COPY public ./public

USER node
EXPOSE 3000

CMD ["node", "server.js"]
