# Voice Room

Voice Room - голосовая комната по ссылке с демонстрацией экрана. Комната живет в URL вида `/r/<room-id>`, Node.js приложение хранит состояние комнат/сессий и выдает LiveKit JWT, а голос и экран идут через self-hosted LiveKit SFU.

## Возможности

- Комната по ссылке или короткому коду.
- Голос через self-hosted LiveKit SFU.
- Демонстрация экрана без ручных настроек в вебе: старт по умолчанию `720p 30 FPS`, дальше приложение само снижает/возвращает качество по sender stats и состоянию соединения.
- Внутренние профили стрима для автоадаптации (`540p`, `720p`, `1080p` при `15/30 FPS`) без UI выбора качества в браузере.
- Просмотр стрима на основной сцене или сворачивание обратно в плитку.
- Noise suppression, mic gate, выбор input/output устройств и локальный meter микрофона.
- Защита создания комнат: rate limit, proof-of-work challenge и лимит пустых комнат.

## Архитектура

```
apps/
  api/             Node.js HTTP API + SSE, только строгий /api/* контракт
    src/server.js  API-сервер комнат, presence/state и LiveKit JWT
    src/lib/       серверные модули: config, pow, rate-limit
    test/          unit/integration тесты API
  web/             SvelteKit frontend app
    src/routes/    тонкие SvelteKit routes: /, /r/[roomId]
    src/lib/api/   typed fetch client: rooms, pow, common HTTP primitives
    src/lib/shared/
                   общие UI-компоненты, стили и утилиты
    src/lib/features/
      home/        стартовая страница на Svelte (вместе с блоком загрузки приложения)
      room/        Svelte room shell + room client/media layer
    static/        статика как есть: воркеты, rnnoise (wasm), icon, fonts
    dist/          production static build для Caddy
packages/
  shared/          общие contracts/validation для web и api
```

`/` не зависит от room/media кода. `/r/[roomId]` монтирует Svelte-разметку комнаты и lazy-загружает `features/room/client/main.ts`; сам `livekit-client` дополнительно загружается через `features/room/client/media/livekit-runtime.ts` только при подключении/публикации. Это держит стартовый route маленьким, а WebRTC-слой изолированным внутри room feature.

В production frontend и backend разделены: Caddy раздаёт SvelteKit static build из `/srv/web`, а запросы `/api/*` проксирует в `apps/api`. API не отдаёт HTML и не знает про frontend build.

## Требования

- Node.js `20.20.2`
- npm `10.8.2`
- Docker, если нужно локально поднять LiveKit или собрать production image

## Локальный запуск

Проект организован как npm workspaces. Frontend живет в `apps/web` (SvelteKit + Vite), backend — в `apps/api`, общая validation-логика — в `packages/shared`.

Терминал 1 — LiveKit в dev-режиме:

```bash
npm run dev:livekit
```

Терминал 2 — API-сервер:

```bash
source ~/.nvm/nvm.sh
nvm use
npm install

set -a
source .env
set +a

npm run dev
```

Терминал 3 — Vite dev-сервер клиента (проксирует API на :3000):

```bash
npm run dev:web
```

Откройте `http://127.0.0.1:5173`. Vite проксирует `/api/*` на API-сервер `http://localhost:3000`. `localhost` и `127.0.0.1` считаются безопасным browser context, поэтому микрофон и screen capture работают без HTTPS.

Production frontend build создаётся командой `npm run build` и кладётся в `apps/web/dist`. API запускается отдельно через `npm start` и отвечает только на `/api/*`; static frontend в production раздаёт Caddy.

Проверки:

```bash
npm run check   # node --check shared/api/worklets + tsc --noEmit клиента
npm test        # unit/integration тесты shared/api (node:test)
```

## Environment

Обязательные переменные для LiveKit:

```dotenv
LIVEKIT_URL=wss://livekit.example.com
LIVEKIT_API_KEY=change-me-livekit-key
LIVEKIT_API_SECRET=change-me-livekit-secret
```

Часто используемые настройки:

```dotenv
PORT=3000
LIVEKIT_TOKEN_TTL_SECONDS=21600
LIVEKIT_ROOM_PREFIX=voice-room-

# Доверять заголовку X-Forwarded-For (последний хоп) для определения IP клиента.
# Включайте ТОЛЬКО когда приложение стоит за доверенным reverse proxy (Caddy в docker-compose).
# По умолчанию false: IP берётся из реального соединения (socket.remoteAddress).
TRUST_PROXY=false

MAX_ROOM_PEERS=12
MAX_ROOMS=100
MAX_EMPTY_ROOMS_PER_IP=3

# Где API хранит durable registry комнат и chat history.
# По умолчанию: apps/api/data/voice-room-state.json в dev/runtime-контейнере.
ROOM_DATA_DIR=
ROOM_IDLE_TTL_MS=900000

# Чат доступен по ссылке/коду комнаты без входа в голос. Сообщения хранятся
# durable, но ограничены TTL, количеством сообщений на комнату и rate limit.
ROOM_CHAT_TTL_MS=604800000
ROOM_CHAT_MAX_MESSAGES=500
ROOM_CHAT_RATE_LIMIT=60
ROOM_CHAT_RATE_WINDOW_MS=60000

ROOM_CREATE_POW_DIFFICULTY=14
ROOM_CREATE_POW_TTL_MS=120000
ROOM_CREATE_RATE_LIMIT=20
ROOM_CREATE_RATE_WINDOW_MS=60000

# Для reverse proxy / systemd можно слушать Unix socket вместо TCP.
# Если SOCKET_PATH пустой, API слушает HOST:PORT.
HOST=127.0.0.1
SOCKET_PATH=

# Блок «Десктоп-приложение» на главной берёт ссылки из latest-релиза GitHub
# через эндпоинт GET /api/desktop/latest (метаданные кэшируются на сервере).
DESKTOP_RELEASE_REPO=dazeGG/VoiceRoomDesktop
DESKTOP_RELEASE_CACHE_MS=600000
# Необязательный токен — поднимает лимит запросов к GitHub API (репо публичный,
# при кэше в 10 минут хватает и анонимных 60 запросов/час).
GITHUB_TOKEN=
```

Для локального LiveKit dev server используйте:

```dotenv
LIVEKIT_URL=ws://127.0.0.1:7880
LIVEKIT_API_KEY=devkey
LIVEKIT_API_SECRET=secret
```

## Docker

Production compose собирает два runtime-образа из одного Dockerfile:

- `api` — Node.js API на `:3000`, только `/api/*`;
- `caddy` — frontend static build из `apps/web/dist`, reverse proxy для `/api/*` и отдельный reverse proxy для LiveKit domain.

Запуск:

```bash
docker compose up --build
```

Для Docker/production используйте отдельный prod-like `.env`: `LIVEKIT_URL` должен быть публичным URL из браузера, обычно `wss://$LIVEKIT_DOMAIN`. Локальный dev `.env` с `LIVEKIT_URL=ws://127.0.0.1:7880` предназначен для запуска через `npm run dev`, внутри Docker-контейнера такой адрес будет указывать на сам контейнер.

В production приложение должно стоять за HTTPS, а LiveKit должен иметь публично доступные ICE/TCP и ICE/UDP порты. Если пользователи часто сидят за строгими корпоративными сетями, следующим шагом стоит добавить TURN/TLS в LiveKit deployment.

## Desktop

Desktop-оболочка живет в соседнем проекте `VoiceRoomDesktop`. Это веб-приложение остается основным продуктом, а desktop-проект отвечает за нативный выбор окна/экрана, desktop capture audio, управление fullscreen-окном и packaging.

```bash
cd ../VoiceRoomDesktop
cp .env.example .env
npm run desktop
```

## Безопасность

Комнаты приватны только за счет ссылки. Любой, у кого есть URL или код комнаты, может войти. Backend выдает LiveKit tokens только для существующих room sessions, но это не заменяет авторизацию, пароли комнат или аккаунты. Чат следует той же модели доступа: писать можно по ссылке/коду комнаты без входа в голосовую сессию.

Static rooms не удаляются по idle TTL, поэтому они считаются в `MAX_EMPTY_ROOMS_PER_IP`: это защищает `MAX_ROOMS` от постоянного заполнения пустыми static-комнатами одним IP. Список «Мои статичные комнаты» в браузере — локальная bookmark-память (`localStorage`), а не аккаунтный серверный реестр.

История чата хранится в durable state до `ROOM_CHAT_TTL_MS`, но на комнату сохраняется не больше `ROOM_CHAT_MAX_MESSAGES` последних сообщений. Отправка чата ограничена `ROOM_CHAT_RATE_LIMIT` на пару IP+room за `ROOM_CHAT_RATE_WINDOW_MS`. Для production важно монтировать `ROOM_DATA_DIR` на постоянный volume. Инвариант текущей реализации: durable JSON-store рассчитан на ровно один API writer/container; не запускайте несколько API-инстансов, которые одновременно пишут в один state-файл. Если нужен multi-writer/high-throughput режим, этот слой надо заменить на БД или append-only storage.

LiveKit снимает mesh-нагрузку с браузеров: каждый участник публикует микрофон и экран один раз в SFU, а остальные клиенты подписываются на tracks через LiveKit.

## Лицензия

MIT License. Vendored RNNoise assets в `apps/web/static/rnnoise/` распространяются под собственной MIT-лицензией в `apps/web/static/rnnoise/LICENSE`.
