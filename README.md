# Voice Room

Voice Room - голосовая комната по ссылке с демонстрацией экрана. Комната живет в URL вида `/r/<room-id>`, Node.js приложение хранит состояние комнат/сессий и выдает LiveKit JWT, а голос и экран идут через self-hosted LiveKit SFU.

## Возможности

- Комната по ссылке или короткому коду.
- Временная комната в один клик — без имени и регистрации.
- Аккаунты (логин + опциональное имя + пароль): постоянные комнаты привязываются к аккаунту и доступны с любого устройства. Имя из аккаунта автоподставляется в комнату.
- Лобби комнат на `/` для залогиненного пользователя: сетка карточек с названием, эмодзи-иконкой, кодом и статусом «в эфире», создание комнаты через диалог (Постоянная / Временная) и вход по коду. Гость видит лендинг.
- У комнаты есть название и эмодзи-иконка (из фиксированной палитры), выбираются при создании.
- Внутри комнаты: сетка участников (аватары, обводка говорящего, иконка мьюта), сворачиваемый чат-рейл справа (кнопка «Чат» в шапке) и плавающий док с индикатором связи. Шапка показывает название комнаты, чип кода с копированием и «Ссылку».
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
    src/lib/       серверные модули: config, db/migrations, pow, rate-limit, auth (users/sessions, scrypt)
    test/          unit/integration тесты API
  web/             SvelteKit frontend app
    src/routes/    тонкие SvelteKit routes: /, /login, /register, /r/[roomId]
    src/lib/api/   typed fetch client: rooms, auth, pow, common HTTP primitives
    src/lib/shared/
                   общие UI-компоненты, стили и утилиты
    src/lib/features/
      home/        «/»: лендинг для гостя и лобби комнат для залогиненного (плюс блок загрузки приложения)
      auth/        экраны входа/регистрации + клиентский session store
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

Самый простой dev-режим теперь Docker-first: root `npm run dev` поднимает PostgreSQL, API с `node --watch`, Vite dev server и LiveKit через `docker-compose.dev.yml`:

```bash
# Работает из коробки: все dev-значения зашиты дефолтами в docker-compose.dev.yml,
# поэтому .env для dev compose не нужен. Создавайте его только чтобы что-то переопределить.
npm run dev
```

Откройте `http://127.0.0.1:5180`. В dev compose Vite слушает `0.0.0.0:5180` внутри контейнера, проксирует `/api/*` на `http://api:3000`, а API использует PostgreSQL service `postgres`. Host-local запуск остаётся доступен через `dev:host:*`: без `VITE_DEV_HOST` Vite слушает `127.0.0.1`, а `/api` проксируется на `http://localhost:3000`.

Ручной запуск без dev compose:

```bash
source ~/.nvm/nvm.sh
nvm use
npm install

# Поднимите PostgreSQL и LiveKit отдельно. Например LiveKit без compose stack:
npm run dev:host:livekit

set -a
source .env
set +a

# DATABASE_URL обязателен: миграции применяются при bootstrap до listen.
npm run dev:host:api

# Во втором терминале:
npm run dev:host:web
```

Production frontend build создаётся командой `npm run build` и кладётся в `apps/web/dist`. Root `npm start` теперь запускает production-like Docker Compose stack; если нужен host-only API без compose, используйте `npm --workspace @voice-room/api start`. API перед первым listen применяет PostgreSQL migrations и отвечает только на `/api/*`; static frontend в production раздаёт Caddy.

Проверки:

```bash
npm run check   # node --check shared/api/worklets + tsc --noEmit клиента
TEST_DATABASE_URL=postgres://postgres:postgres@127.0.0.1:55432/postgres npm test
```

`TEST_DATABASE_URL` обязателен для API-тестов. Test harness создаёт отдельную временную PostgreSQL database на каждый integration test и удаляет её после завершения; silent skip для отсутствующей БД не используется.

## Environment и секреты

`.env`, `.env.*` и любые реальные значения окружения не хранятся в Git. Для локального запуска создайте `.env` вручную из защищённого источника: password manager, серверный vault или приватная заметка владельца проекта. GitHub Secrets/Variables используйте для CI/CD и protected deploy environments; после сохранения GitHub не показывает secret-значения обратно, поэтому это не удобный источник для локального копирования.

### Где хранить значения

GitHub-аналог GitLab CI/CD variables находится здесь:

1. Repository → **Settings** → **Secrets and variables** → **Actions**.
2. Для production/staging лучше использовать **Environments**: `production`, `staging`.
3. Секреты кладите в **Secrets**, обычные настройки — в **Variables**.

**Secrets** — значения, которые нельзя показывать в логах и PR:

| Name | Где нужно | Комментарий |
| --- | --- | --- |
| `POSTGRES_PASSWORD` | docker compose / production | Пароль PostgreSQL. |
| `DATABASE_URL` | API host-only / non-compose deploy | Полная PostgreSQL URL. В compose обычно собирается из `POSTGRES_*`. |
| `TEST_DATABASE_URL` | Локальные/внешние API tests | Admin-capable PostgreSQL URL для test harness. В CI **не нужен**: workflow поднимает эфемерный Postgres service и задаёт URL сам. |
| `SSH_HOST` / `SSH_USER` / `SSH_KEY` / `SSH_PORT` | CD (deploy job) | Доступ к серверу для SSH-деплоя. `SSH_PORT` опционален (по умолчанию `22`). |
| `LIVEKIT_API_KEY` | API / LiveKit | Ключ LiveKit. |
| `LIVEKIT_API_SECRET` | API / LiveKit | Секрет LiveKit. Сгенерировать случайным значением. |
| `GITHUB_TOKEN` | API desktop release endpoint, optional | Нужен только если хочется повысить лимит GitHub API. |

**Variables** — не секреты, но окружение-зависимые настройки:

| Name | Default/пример | Комментарий |
| --- | --- | --- |
| `DOMAIN` | `voice.example.com` | Основной домен web-приложения. |
| `LIVEKIT_DOMAIN` | `livekit.${DOMAIN}` | Домен LiveKit. |
| `LIVEKIT_URL` | `wss://livekit.example.com` | Browser-facing LiveKit URL. В production не используйте `127.0.0.1`. |
| `LIVEKIT_PUBLIC_URL` | optional | Для dev compose, если внешний LiveKit port отличается. |
| `TRUST_PROXY` | `true` в compose/proxy | Включать только за доверенным reverse proxy. |
| `LIVEKIT_TOKEN_TTL_SECONDS` | `21600` | TTL LiveKit token. |
| `LIVEKIT_ROOM_PREFIX` | `voice-room-` | Prefix room id в LiveKit. |
| `MAX_ROOM_PEERS` | `12` | Max peers per room. |
| `MAX_ROOMS` | `100` | Общий лимит комнат. |
| `MAX_EMPTY_ROOMS_PER_IP` | `3` | Legacy лимит временных empty rooms на IP. |
| `MAX_TEMP_ROOMS_PER_IP` | optional | Новый явный лимит temporary rooms на IP. |
| `MAX_STATIC_ROOMS_PER_USER` | `3` | Лимит постоянных комнат на аккаунт. |
| `ROOM_IDLE_TTL_MS` | `900000` | TTL пустой dynamic room. |
| `ROOM_PRUNE_INTERVAL_MS` | `60000` | Интервал cleanup. |
| `ROOM_CHAT_TTL_MS` | `604800000` | TTL chat history. |
| `ROOM_CHAT_MAX_MESSAGES` | `500` | Max chat messages per room. |
| `ROOM_CHAT_RATE_LIMIT` | `60` | Room chat rate limit. |
| `ROOM_CHAT_RATE_WINDOW_MS` | `60000` | Room chat rate window. |
| `ROOM_CREATE_POW_DIFFICULTY` | `14` | Proof-of-work difficulty. Для dev/test можно `0`. |
| `ROOM_CREATE_POW_TTL_MS` | `120000` | Proof-of-work TTL. |
| `ROOM_CREATE_RATE_LIMIT` | `20` | Room create rate limit. |
| `ROOM_CREATE_RATE_WINDOW_MS` | `60000` | Room create rate window. |
| `SESSION_TTL_MS` | `2592000000` | Session lifetime. |
| `SESSION_COOKIE_SECURE` | auto in production | Обычно не задавать; true при HTTPS/prod. |
| `AUTH_RATE_LIMIT` | `30` | Auth rate limit. |
| `AUTH_RATE_WINDOW_MS` | `60000` | Auth rate window. |
| `DM_RATE_LIMIT` | `30` | DM send rate limit per user. |
| `DM_RATE_WINDOW_MS` | `10000` | DM rate window. |
| `FRIEND_REQUEST_RATE_LIMIT` | `20` | Friend request rate limit per user. |
| `FRIEND_REQUEST_RATE_WINDOW_MS` | `60000` | Friend request rate window. |
| `MAX_REALTIME_STREAMS_PER_USER` | `8` | Max concurrent SSE streams per user. |
| `HOST` | `127.0.0.1` | Host for host-only API. Compose sets `0.0.0.0`. |
| `PORT` | `3000` | API port. |
| `SOCKET_PATH` | empty | Unix socket вместо TCP, если нужен. |
| `DESKTOP_RELEASE_REPO` | `dazeGG/VoiceRoomDesktop` | Repo для latest desktop release. |
| `DESKTOP_RELEASE_CACHE_MS` | `600000` | Cache TTL для desktop release metadata. |
| `DEPLOY_PATH` | `/srv/voiceroom` | Путь к git-клону репозитория на сервере для CD (deploy job). |

### Переопределение dev-значений (опционально)

Для dev compose `.env` **не требуется** — `docker-compose.dev.yml` задаёт все нужные значения дефолтами (`devkey`/`devsecret` для LiveKit, локальный PostgreSQL, POW и create rate limit выключены). Сервис LiveKit получает `LIVEKIT_KEYS` из тех же переменных, что и API, поэтому ключи всегда совпадают и голос работает из коробки.

Файл `.env` нужен только чтобы что-то переопределить (например, занятые порты или внешний LiveKit). Создайте его локально и не коммитьте:

```dotenv
# Любая из этих строк опциональна — задавайте только то, что меняете.
LIVEKIT_API_KEY=devkey
LIVEKIT_API_SECRET=devsecret
POSTGRES_PASSWORD=<local-random-password>
POSTGRES_PORT=5432
WEB_PORT=5180
API_PORT=3000
```

Для host-only API добавьте `DATABASE_URL`, потому что вне compose она не собирается автоматически:

```dotenv
DATABASE_URL=postgres://voice_room:<local-random-password>@127.0.0.1:5432/voice_room
```

### Минимальный production набор

Для production compose обычно достаточно задать:

```text
DOMAIN
LIVEKIT_DOMAIN
POSTGRES_PASSWORD
LIVEKIT_API_KEY
LIVEKIT_API_SECRET
```

`DATABASE_URL` в compose соберётся автоматически из `POSTGRES_DB`, `POSTGRES_USER`, `POSTGRES_PASSWORD` и service name `postgres`. Если деплой не через compose — задайте `DATABASE_URL` явно как secret.

### CI/CD (GitHub Actions)

Пайплайн описан в `.github/workflows/ci.yml` и триггерится на pull request в `main` и push в `main`:

- **check** — `npm ci`, `npm run check` (shared+api+web: `node --check`, `svelte-kit sync`, `tsc --noEmit`), `npm run build` (Vite).
- **test** — `npm test` против эфемерного PostgreSQL service-контейнера. `TEST_DATABASE_URL` задаётся прямо в workflow одноразовым значением — секрет для этого **не нужен** (test harness создаёт/удаляет временную БД на каждый тест).
- **deploy** — только на push в `main` и только после зелёных `check`+`test`. По SSH делает `git reset --hard origin/main` и `docker compose up -d --build` в каталоге деплоя. Миграции применяются API на bootstrap, отдельного шага нет.

**Secrets для деплоя** (Settings → Secrets and variables → Actions → Secrets):

| Name | Назначение |
| --- | --- |
| `SSH_HOST` | Хост сервера. |
| `SSH_USER` | SSH-пользователь с доступом к docker compose. |
| `SSH_KEY` | Приватный SSH-ключ (PEM). Публичный — в `authorized_keys` сервера. |
| `SSH_PORT` | Опционально, по умолчанию `22`. |

**Variables для деплоя**: `DEPLOY_PATH` — путь к клону репозитория на сервере (по умолчанию `/srv/voiceroom`).

На сервере должен быть git-клон репозитория в `DEPLOY_PATH` со своим production `.env` (как минимум `DOMAIN`, `POSTGRES_PASSWORD`, `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET`) — деплой пересобирает стек из исходников, app-секреты живут на сервере, а не в Actions.

Прочие рекомендации:

- Для protected production включите Environment protection rules и required reviewers; в Settings → Branches сделайте `check` и `test` обязательными проверками для merge в `main`.
- Не печатайте secrets в workflow logs; передавайте их через `with:`/`env:` только в нужные jobs/steps.
- Для supply-chain harden можно запинить `appleboy/ssh-action` на commit SHA вместо тега `v1.2.5`.

Миграции:

```bash
npm --workspace @voice-room/api run db:migrate
npm --workspace @voice-room/api run db:rollback
```

`DATABASE_URL` — основной durable storage для registry комнат и истории чата. API валидирует его на bootstrap, применяет migrations через `node-pg-migrate` до первого listen и не имеет runtime fallback на JSON-файл. Для compose можно не задавать `DATABASE_URL` явно: он собирается из `POSTGRES_DB`, `POSTGRES_USER`, `POSTGRES_PASSWORD` и service name `postgres`.

## Docker

Production compose собирает runtime-образы из одного Dockerfile и поднимает durable services:

- `postgres` — PostgreSQL с volume `postgres_data` и healthcheck;
- `api` — Node.js API на `:3000`, ждёт healthy Postgres, применяет migrations и отвечает только на `/api/*`;
- `caddy` — frontend static build из `apps/web/dist`, reverse proxy для `/api/*` и отдельный reverse proxy для LiveKit domain;
- `livekit` — LiveKit SFU.

Production-like запуск:

```bash
# Создайте production .env на сервере из приватного vault/секретов деплоя, затем:
npm start
```

Остановить production-like stack:

```bash
npm run stop
```

Dev compose через npm scripts:

```bash
npm run dev       # foreground
npm run dev:up    # background
npm run dev:logs
npm run dev:down
```

Он публикует Vite на `127.0.0.1:${WEB_PORT:-5180}`, API на `${API_PORT:-3000}`, PostgreSQL на `${POSTGRES_PORT:-5432}` и LiveKit на `7880/7881/7882`. Внутри compose Vite проксирует `/api` на `http://api:3000`; вне compose дефолты остаются host-local. Если меняете `LIVEKIT_HTTP_PORT`, задайте и browser-facing `LIVEKIT_PUBLIC_URL` (например `ws://localhost:17880`), потому что это значение API отдаёт клиенту.

Для Docker/production используйте отдельный prod-like `.env`: `LIVEKIT_URL` должен быть публичным URL из браузера, обычно `wss://$LIVEKIT_DOMAIN`. Локальный dev `.env` с `LIVEKIT_URL=ws://127.0.0.1:7880` предназначен для host/dev compose сценария; в production контейнере такой URL будет неверен для внешних браузеров.

В production приложение должно стоять за HTTPS, PostgreSQL volume нужно бэкапить, а LiveKit должен иметь публично доступные ICE/TCP и ICE/UDP порты. Если пользователи часто сидят за строгими корпоративными сетями, следующим шагом стоит добавить TURN/TLS в LiveKit deployment.


## Ручной release smoke: static room + chat persist after API restart

Сценарий проверяет главный persistence contract без входа в голос:

1. Запустите prod или dev compose с PostgreSQL.
2. Откройте `http://127.0.0.1:5180` в dev compose или production domain.
3. Создайте static room и откройте её ссылку `/r/<room-id>`.
4. Не подключаясь к голосу, отправьте сообщение в чат комнаты.
5. Перезапустите только API:

   ```bash
   docker compose restart api
   # или для dev compose через npm script:
   npm run dev:restart
   ```

6. Снова откройте `/r/<room-id>` и проверьте, что room существует, static flag сохранился, а отправленное сообщение осталось в истории чата.

Автоматизированный аналог покрыт тестом `manual static-room chat scenario survives API restart without voice join` в `apps/api/test/chat.test.js`.

## Desktop

Desktop-оболочка живет в соседнем проекте `VoiceRoomDesktop`. Это веб-приложение остается основным продуктом, а desktop-проект отвечает за нативный выбор окна/экрана, desktop capture audio, управление fullscreen-окном и packaging.

```bash
cd ../VoiceRoomDesktop
# Создайте .env для desktop по документации VoiceRoomDesktop
npm run desktop
```

## Безопасность

Комнаты приватны только за счет ссылки. Любой, у кого есть URL или код комнаты, может войти. Backend выдает LiveKit tokens только для существующих room sessions, но это не заменяет авторизацию или пароли на сами комнаты. Чат следует той же модели доступа: писать можно по ссылке/коду комнаты без входа в голосовую сессию.

Аккаунты служат для владения постоянными комнатами, а не для контроля доступа к ним. Пароли хешируются `scrypt` (встроенный `node:crypto`), сессия живёт в HttpOnly + SameSite=Lax cookie (`vr_session`) до `SESSION_TTL_MS`; попытки входа/регистрации ограничены `AUTH_RATE_LIMIT` на IP. Логин нормализуется в нижний регистр и уникален. При создании постоянной комнаты залогиненным пользователем она получает `owner_id`, и список «Мои комнаты» приходит с сервера (`GET /api/auth/rooms`). Временные комнаты остаются ownerless.

Постоянные комнаты больше не считаются в IP-квоту: создавать их могут только авторизованные пользователи, а владение ограничено `MAX_STATIC_ROOMS_PER_USER` (по умолчанию 3). Временные ownerless-комнаты остаются ограничены по IP через `MAX_TEMP_ROOMS_PER_IP` (legacy `MAX_EMPTY_ROOMS_PER_IP` используется только как fallback для старых env-файлов), чтобы один IP не заполнял `MAX_ROOMS` пустыми временными комнатами.

История чата хранится в PostgreSQL до `ROOM_CHAT_TTL_MS`, но на комнату сохраняется не больше `ROOM_CHAT_MAX_MESSAGES` последних сообщений. Отправка чата ограничена `ROOM_CHAT_RATE_LIMIT` на пару IP+room за `ROOM_CHAT_RATE_WINDOW_MS`. Для production важно бэкапить PostgreSQL volume и не терять `DATABASE_URL`/credentials. Cleanup expired chat/idle dynamic rooms runs on request paths and on a process-local `ROOM_PRUNE_INTERVAL_MS` timer. Горизонтальное масштабирование API возможно только с учётом того, что presence, SSE handles, session tokens, cleanup timers и non-durable rate limit state остаются process-local; durable комнаты и сообщения находятся в PostgreSQL, а room quota/capacity enforcement выполняется транзакционно в PostgreSQL при создании комнаты.

LiveKit снимает mesh-нагрузку с браузеров: каждый участник публикует микрофон и экран один раз в SFU, а остальные клиенты подписываются на tracks через LiveKit.

## Лицензия

MIT License. Vendored RNNoise assets в `apps/web/static/rnnoise/` распространяются под собственной MIT-лицензией в `apps/web/static/rnnoise/LICENSE`.
