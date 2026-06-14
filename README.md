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
    src/lib/       серверные модули: config, db/migrations, pow, rate-limit
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
- Docker, если нужно локально поднять PostgreSQL/LiveKit или собрать production image

## Локальный запуск

Проект организован как npm workspaces. Frontend живет в `apps/web` (SvelteKit + Vite), backend — в `apps/api`, общая validation-логика — в `packages/shared`.

Самый простой dev-режим через Docker Compose поднимает PostgreSQL, API с `node --watch`, Vite dev server и LiveKit:

```bash
cp .env.example .env
docker compose -f docker-compose.dev.yml up --build
```

Откройте `http://127.0.0.1:5173`. В dev compose Vite слушает `0.0.0.0:5173` внутри контейнера, проксирует `/api/*` на `http://api:3000`, а API использует PostgreSQL service `postgres`. Host-local запуск по-прежнему остаётся дефолтом: без `VITE_DEV_HOST` Vite слушает `127.0.0.1`, а `/api` проксируется на `http://localhost:3000`.

Ручной запуск без dev compose:

```bash
source ~/.nvm/nvm.sh
nvm use
npm install

# Поднимите PostgreSQL и LiveKit отдельно. Например LiveKit:
npm run dev:livekit

set -a
source .env
set +a

# DATABASE_URL обязателен: миграции применяются при bootstrap до listen.
npm run dev

# Во втором терминале:
npm run dev:web
```

Production frontend build создаётся командой `npm run build` и кладётся в `apps/web/dist`. API запускается отдельно через `npm start`, перед первым listen применяет PostgreSQL migrations и отвечает только на `/api/*`; static frontend в production раздаёт Caddy.

Проверки:

```bash
npm run check   # node --check shared/api/worklets + tsc --noEmit клиента
TEST_DATABASE_URL=postgres://postgres:postgres@127.0.0.1:55432/postgres npm test
```

`TEST_DATABASE_URL` обязателен для API-тестов. Test harness создаёт отдельную временную PostgreSQL database на каждый integration test и удаляет её после завершения; silent skip для отсутствующей БД не используется.

## Environment

Обязательные переменные для PostgreSQL persistence и LiveKit:

```dotenv
DATABASE_URL=postgres://voice_room:change-me-postgres-password@127.0.0.1:5432/voice_room
LIVEKIT_URL=wss://livekit.example.com
LIVEKIT_API_KEY=change-me-livekit-key
LIVEKIT_API_SECRET=change-me-livekit-secret
```

`DATABASE_URL` — основной durable storage для registry комнат и истории чата. API валидирует его на bootstrap, применяет migrations через `node-pg-migrate` до первого listen и не имеет runtime fallback на JSON-файл. `ROOM_DATA_DIR` больше не является primary persistence path. Для compose можно не задавать `DATABASE_URL` явно: он собирается из `POSTGRES_DB`, `POSTGRES_USER`, `POSTGRES_PASSWORD` и service name `postgres`.

Миграции:

```bash
npm --workspace @voice-room/api run db:migrate
npm --workspace @voice-room/api run db:rollback
```

Часто используемые настройки:

```dotenv
PORT=3000
POSTGRES_DB=voice_room
POSTGRES_USER=voice_room
POSTGRES_PASSWORD=change-me-postgres-password
LIVEKIT_TOKEN_TTL_SECONDS=21600
LIVEKIT_ROOM_PREFIX=voice-room-

# Доверять заголовку X-Forwarded-For (последний хоп) для определения IP клиента.
# Включайте ТОЛЬКО когда приложение стоит за доверенным reverse proxy (Caddy в docker-compose).
# По умолчанию false: IP берётся из реального соединения (socket.remoteAddress).
TRUST_PROXY=false

MAX_ROOM_PEERS=12
MAX_ROOMS=100
MAX_EMPTY_ROOMS_PER_IP=3
ROOM_IDLE_TTL_MS=900000
ROOM_PRUNE_INTERVAL_MS=60000

# Чат доступен по ссылке/коду комнаты без входа в голос. Сообщения хранятся
# в PostgreSQL, но ограничены TTL, количеством сообщений на комнату и rate limit.
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

Production compose собирает runtime-образы из одного Dockerfile и поднимает durable services:

- `postgres` — PostgreSQL с volume `postgres_data` и healthcheck;
- `api` — Node.js API на `:3000`, ждёт healthy Postgres, применяет migrations и отвечает только на `/api/*`;
- `caddy` — frontend static build из `apps/web/dist`, reverse proxy для `/api/*` и отдельный reverse proxy для LiveKit domain;
- `livekit` — LiveKit SFU.

Запуск:

```bash
cp .env.example .env
# поменяйте DOMAIN, LIVEKIT_* и POSTGRES_PASSWORD
docker compose up --build
```

Dev compose:

```bash
docker compose -f docker-compose.dev.yml up --build
```

Он публикует Vite на `127.0.0.1:${WEB_PORT:-5173}`, API на `${API_PORT:-3000}`, PostgreSQL на `${POSTGRES_PORT:-5432}` и LiveKit на `7880/7881/7882`. Внутри compose Vite проксирует `/api` на `http://api:3000`; вне compose дефолты остаются host-local. Если меняете `LIVEKIT_HTTP_PORT`, задайте и browser-facing `LIVEKIT_PUBLIC_URL` (например `ws://localhost:17880`), потому что это значение API отдаёт клиенту.

Для Docker/production используйте отдельный prod-like `.env`: `LIVEKIT_URL` должен быть публичным URL из браузера, обычно `wss://$LIVEKIT_DOMAIN`. Локальный dev `.env` с `LIVEKIT_URL=ws://127.0.0.1:7880` предназначен для host/dev compose сценария; в production контейнере такой URL будет неверен для внешних браузеров.

В production приложение должно стоять за HTTPS, PostgreSQL volume нужно бэкапить, а LiveKit должен иметь публично доступные ICE/TCP и ICE/UDP порты. Если пользователи часто сидят за строгими корпоративными сетями, следующим шагом стоит добавить TURN/TLS в LiveKit deployment.


## Ручной release smoke: static room + chat persist after API restart

Сценарий проверяет главный persistence contract без входа в голос:

1. Запустите prod или dev compose с PostgreSQL.
2. Откройте `http://127.0.0.1:5173` в dev compose или production domain.
3. Создайте static room и откройте её ссылку `/r/<room-id>`.
4. Не подключаясь к голосу, отправьте сообщение в чат комнаты.
5. Перезапустите только API:

   ```bash
   docker compose restart api
   # или для dev compose:
   docker compose -f docker-compose.dev.yml restart api
   ```

6. Снова откройте `/r/<room-id>` и проверьте, что room существует, static flag сохранился, а отправленное сообщение осталось в истории чата.

Автоматизированный аналог покрыт тестом `manual static-room chat scenario survives API restart without voice join` в `apps/api/test/chat.test.js`.

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

История чата хранится в PostgreSQL до `ROOM_CHAT_TTL_MS`, но на комнату сохраняется не больше `ROOM_CHAT_MAX_MESSAGES` последних сообщений. Отправка чата ограничена `ROOM_CHAT_RATE_LIMIT` на пару IP+room за `ROOM_CHAT_RATE_WINDOW_MS`. Для production важно бэкапить PostgreSQL volume и не терять `DATABASE_URL`/credentials. Cleanup expired chat/idle dynamic rooms runs on request paths and on a process-local `ROOM_PRUNE_INTERVAL_MS` timer. Горизонтальное масштабирование API возможно только с учётом того, что presence, SSE handles, session tokens, cleanup timers и non-durable rate limit state остаются process-local; durable комнаты и сообщения находятся в PostgreSQL, а room quota/capacity enforcement выполняется транзакционно в PostgreSQL при создании комнаты.

LiveKit снимает mesh-нагрузку с браузеров: каждый участник публикует микрофон и экран один раз в SFU, а остальные клиенты подписываются на tracks через LiveKit.

## Лицензия

MIT License. Vendored RNNoise assets в `apps/web/static/rnnoise/` распространяются под собственной MIT-лицензией в `apps/web/static/rnnoise/LICENSE`.
