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
- Демонстрация экрана без ручных настроек в вебе: старт по умолчанию `720p 30 FPS`, выбранный перед захватом профиль остаётся стабильным до остановки трансляции, а реакцию на congestion выполняют libwebrtc и LiveKit без переключения profile ID приложением.
- Внутренние профили стрима (`540p`, `720p`, `1080p` при `5/15/30 FPS`) задают ограничения захвата и encoder ceiling; для зрителя LiveKit выбирает слой по режиму preview/stage, без UI выбора качества в браузере.
- Просмотр стрима на основной сцене или сворачивание обратно в плитку.
- Noise suppression, mic gate, выбор input/output устройств, локальный meter и входной gain микрофона `0–200%` после шумодава/гейта с защитой от клиппинга.
- Единый WebAudio-микшер для голосов, демонстрации экрана и сигналов: индивидуальная и мастер-громкость `0–200%`, limiter и переключение устройства вывода там, где это поддерживает браузер.
- Защита создания комнат: rate limit, proof-of-work challenge и лимит пустых комнат.
- Модерация постоянной комнаты владельцем: kick, ban по аккаунту/IP и быстрое снятие только что созданного бана.
- Безопасность аккаунта: список устройств (браузер или приложение, ОС, город по IP и последний визит) с завершением чужих сеансов и одноразовые коды восстановления, по которым можно войти, если пароль забыт.
- Удаление сообщений: свои — везде; владелец постоянной комнаты также может удалить сообщение комнаты. Свои сообщения комнаты и ЛС можно редактировать без ограничения по времени, с realtime-обновлением и отметкой «изменено».
- Ring друзьям из комнаты с realtime-тостом, звуковым сигналом и переходом в комнату.
- Уведомления в открытом приложении и Web Push для Ring, ЛС, заявок в друзья и их принятия. Поддерживаются DND, серверный mute ЛС, локальный mute комнат и отдельное включение push для текущего браузера.
- Многострочный чат + кликабельные ссылки (http/https/www) в чате комнаты и ЛС.
- Настраиваемые хоткеи для микрофона, звука приложения и Push-to-talk. Веб-PTT работает, пока вкладка активна, и отпускает микрофон с короткой задержкой, чтобы не обрезать конец фразы.

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

- Node.js `24.18.0`
- npm `11.16.0`
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
| `LIVEKIT_API_KEY` | API / LiveKit | Ключ LiveKit. |
| `LIVEKIT_API_SECRET` | API / LiveKit | Секрет LiveKit. Сгенерировать случайным значением. |
| `LIVEKIT_GATE_SECRET` | API / LiveKit gate | Отдельный случайный секрет длиной не менее 32 символов. Не должен совпадать с `LIVEKIT_API_SECRET`. |
| `VAPID_PRIVATE_KEY` | API / Web Push | Приватная часть стабильной VAPID-пары. Никогда не публиковать и не хранить в Git. |
| `GITHUB_TOKEN` | API desktop release endpoint, optional | Нужен только если хочется повысить лимит GitHub API. |
| `POW_SECRET` | API production/staging, optional | Стабильный secret для proof-of-work challenge; если не задан, генерируется на процесс и challenge'и инвалидируются при рестарте. |

**Variables** — не секреты, но окружение-зависимые настройки:

| Name | Default/пример | Комментарий |
| --- | --- | --- |
| `DOMAIN` | `voice.example.com` | Основной домен web-приложения. |
| `LIVEKIT_DOMAIN` | `livekit.${DOMAIN}` | Домен LiveKit. |
| `LIVEKIT_GATE_PUBLIC_URL` | `wss://livekit.example.com` | Публичный browser-facing URL auth-gate. По умолчанию собирается из `LIVEKIT_DOMAIN`. |
| `LIVEKIT_INTERNAL_URL` | `ws://livekit:7880` | Внутренний адрес LiveKit SFU для API при запуске без production compose. Production compose фиксирует service URL сам. |
| `LIVEKIT_URL` | optional | Legacy fallback для host/dev запуска. В production не используйте его как публичный URL; задавайте `LIVEKIT_GATE_PUBLIC_URL`. |
| `LIVEKIT_PUBLIC_URL` | optional | Для dev compose, если внешний LiveKit port отличается. |
| `TRUST_PROXY` | `true` в compose/proxy | Включать только за доверенным reverse proxy. |
| `LOG_LEVEL` | `info` в production compose | Уровень JSON-логов API (`debug`, `info`, `warn`, `error`; `silent`/`off` выключают). Health-check запросы не пишутся в request-log. |
| `LIVEKIT_TOKEN_TTL_SECONDS` | `21600` | TTL LiveKit token. |
| `LIVEKIT_ROOM_PREFIX` | `voice-room-` | Prefix room id в LiveKit. |
| `MAX_ROOM_PEERS` | `12` | Max peers per room. |
| `MAX_ROOMS` | `100` | Общий лимит комнат. |
| `MAX_EMPTY_ROOMS_PER_IP` | `3` | Legacy лимит временных empty rooms на IP. |
| `MAX_TEMP_ROOMS_PER_IP` | optional | Новый явный лимит temporary rooms на IP. |
| `MAX_STATIC_ROOMS_PER_USER` | `3` | Лимит постоянных комнат на аккаунт. |
| `ROOM_IDLE_TTL_MS` | `900000` | TTL пустой dynamic room. |
| `ROOM_PRUNE_INTERVAL_MS` | `60000` | Интервал soft-cleanup expired messages / idle dynamic rooms. |
| `RETENTION_PURGE_INTERVAL_MS` | `3600000` | Интервал физического удаления старых soft-deleted rows. `0` выключает purge. |
| `RETENTION_KEEP_DELETED_MS` | `2592000000` | Сколько хранить soft-deleted rows перед hard-delete. |
| `ROOM_CHAT_RATE_LIMIT` | `60` | Room chat rate limit. |
| `ROOM_CHAT_RATE_WINDOW_MS` | `60000` | Room chat rate window. |
| `UPLOADS_DIR` | `apps/api/uploads` (host) / `/data/uploads` (compose) | Каталог нормализованных WebP-аватарок. В production должен находиться на persistent volume. |
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
| `AVATAR_UPLOAD_RATE_LIMIT` | `10` | Максимум загрузок аватарок на аккаунт за окно. |
| `AVATAR_UPLOAD_RATE_WINDOW_MS` | `60000` | Окно rate limit загрузки аватарок. |
| `MAX_REALTIME_STREAMS_PER_USER` | `8` | Max concurrent WebSocket streams per authenticated user. |
| `MAX_GUEST_STREAMS_PER_IP` | `8` | Max concurrent guest WebSocket streams per client IP. |
| `MAX_ROOM_BANS` | `100` | Максимум активных блокировок на постоянную комнату. |
| `VAPID_PUBLIC_KEY` / `VAPID_SUBJECT` | empty | Публичная часть и контакт Web Push; вместе с secret `VAPID_PRIVATE_KEY` образуют полный VAPID-конфиг. Если любое значение отсутствует, push выключается без остановки API. |
| `MAX_PUSH_SUBSCRIPTIONS_PER_USER` | `10` | Maximum retained Web Push subscriptions per account; older entries are pruned transactionally. |
| `PUSH_SUBSCRIPTION_RATE_LIMIT` | `20` | Maximum Web Push subscription create/delete mutations per account per window. |
| `PUSH_SUBSCRIPTION_RATE_WINDOW_MS` | `60000` | Web Push subscription mutation rate-limit window. |
| `RING_RATE_LIMIT` / `RING_RATE_WINDOW_MS` | `1` / `30000` | Лимит Ring-приглашений от одного пользователя другому за окно. |
| `RING_TTL_MS` | `30000` | Время жизни Ring-приглашения в realtime, toast и Web Push. |
| `WS_MAX_PAYLOAD_BYTES` | `65536` | Max inbound WebSocket frame payload. |
| `HOST` | `127.0.0.1` | Host for host-only API. Compose sets `0.0.0.0`. |
| `PORT` | `3000` | API port. |
| `SOCKET_PATH` | empty | Unix socket вместо TCP, если нужен. |
| `API_METRICS_ALLOWED_REMOTE` | `127.0.0.1` | Caddy allowlist для публичного пути `/api/metrics`; задайте Tailscale IP/range status-сервера, иначе endpoint закрыт снаружи. |
| `DESKTOP_RELEASE_REPO` | `dazeGG/VoiceRoomDesktop` | Repo для latest desktop release. |
| `DESKTOP_RELEASE_CACHE_MS` | `600000` | Cache TTL для desktop release metadata. |
| `GEOIP_DB_PATH` | empty (host) / `/data/geoip/dbip-city-lite.mmdb` (compose) | Локальная база [DB-IP City Lite](https://db-ip.com) (CC BY 4.0) для города и страны в списке устройств. Скачивается командой `node scripts/geoip/fetch-dbip-city-lite.mjs geoip/dbip-city-lite.mmdb` в каталог деплоя; обновлять раз в месяц и перезапускать `api`. Без файла список устройств показывается без города. |

### Переопределение dev-значений (опционально)

Для dev compose `.env` **не требуется** — `docker-compose.dev.yml` задаёт все нужные значения дефолтами (`devkey`/`devsecret` для LiveKit, локальный PostgreSQL, POW и create rate limit выключены). Сервис LiveKit получает `LIVEKIT_KEYS` из тех же переменных, что и API, поэтому ключи всегда совпадают и голос работает из коробки.

Файл `.env` нужен только чтобы что-то переопределить (например, занятые порты или внешний LiveKit). Создайте его локально и не коммитьте:

```dotenv
# Любая из этих строк опциональна — задавайте только то, что меняете.
LIVEKIT_API_KEY=devkey
LIVEKIT_API_SECRET=devsecret
VAPID_PUBLIC_KEY=<stable-public-key>
VAPID_PRIVATE_KEY=<stable-private-key>
VAPID_SUBJECT=mailto:admin@example.com
POSTGRES_PASSWORD=<local-random-password>
POSTGRES_PORT=5432
WEB_PORT=5180
API_PORT=3000
```

Для Web Push нужны все три `VAPID_*` значения. Один раз создайте стабильную пару командой
`npx web-push generate-vapid-keys --json`, сохраните её в защищённом источнике и используйте
одинаковую пару после перезапусков и деплоев. Приватный ключ нельзя коммитить.

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
LIVEKIT_GATE_SECRET
VAPID_PUBLIC_KEY
VAPID_PRIVATE_KEY
VAPID_SUBJECT
```

`DATABASE_URL` в compose соберётся автоматически из `POSTGRES_DB`, `POSTGRES_USER`, `POSTGRES_PASSWORD` и service name `postgres`. Если деплой не через compose — задайте `DATABASE_URL` явно как secret.
Если Web Push намеренно не используется, `VAPID_*` можно опустить — API продолжит работать,
но `/api/push/config` вернёт `enabled: false` и клиент отключит переключатель push-уведомлений.

### CI/CD (GitHub Actions)

Пайплайн описан в `.github/workflows/ci.yml`. Проверки запускаются для pull request и push в `develop`/`main`. Ветки, PR, коммиты, hotfix и релизы ведутся по [`docs/GIT_FLOW.md`](./docs/GIT_FLOW.md):

- **policy** — проверяет допустимый Git Flow маршрут PR и Conventional Commit формат PR title.
- **check** — `npm ci`, `npm run check` (shared+api+web: `node --check`, `svelte-kit sync`, `tsc --noEmit`), `npm run build` (Vite).
- **test** — `npm test` против эфемерного PostgreSQL service-контейнера. `TEST_DATABASE_URL` задаётся прямо в workflow одноразовым значением — секрет для этого **не нужен** (test harness создаёт/удаляет временную БД на каждый тест).
- **voice-join** — проверка входа в голосовую комнату через LiveKit.
- **G05 / G08** — строгий LiveKit-профиль и порог покрытия изменённого кода.

**Деплой** (`.github/workflows/deploy.yml`, вызывается из `ci.yml` только после зелёных `check`, `test`, `voice-join` и G05):

- **images** — на каждый push в `develop`, `main` и тег `v*` собирает таргеты `api`, `worker`, `web` и публикует `ghcr.io/dazegg/voiceroom-<target>:<commit-sha>`.
- **deploy-dev** — push в `develop` сразу выкатывается на dev (environment `dev`, https://dev.voiceroom.ru).
- **deploy-production** — тег `v*` на коммите из `main`, совпадающий с версией в `package.json`; job ждёт Approve в environment `production` (https://voiceroom.ru).

Выкатку делает `scripts/cd/remote-deploy.sh` на сервере по SSH: бэкап `.env` и `pg_dump` в `deploy-backups/ci/` (хранятся 5 последних; ручные бэкапы рядом не трогаются), `git checkout` коммита, `docker pull` образов, подстановка `VOICEROOM_*_IMAGE` в `.env`, `docker compose config`, `docker compose up -d --wait`. Если любой шаг падает, возвращаются прежние коммит, `.env` и контейнеры. Миграции при этом **не откатываются** — после неудачной миграции восстанавливайте БД из дампа (см. [`docs/operations/PREDEPLOY_MIGRATIONS.md`](./docs/operations/PREDEPLOY_MIGRATIONS.md)).

Каждый environment хранит свои secrets `SSH_HOST`, `SSH_USER`, `SSH_KEY` и variables `DEPLOY_PATH`, `SSH_FINGERPRINT` (ED25519-отпечаток хоста; без совпадения деплой не стартует). Серверный `.env` (как минимум `DOMAIN`, `POSTGRES_PASSWORD`, `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET`, `LIVEKIT_GATE_SECRET`, `VOICE_ROOM_CURSOR_HMAC_KEYS`) живёт на сервере, а не в Actions.

Прочие рекомендации:

- Для protected branches включите required reviewers; сделайте `policy`, `check` и `test` обязательными проверками для PR в `develop` и `main`.
- Не печатайте secrets в workflow logs; передавайте их через `with:`/`env:` только в нужные jobs/steps.

Миграции:

```bash
npm --workspace @voice-room/api run db:migrate
npm --workspace @voice-room/api run db:rollback
```

`DATABASE_URL` — основной durable storage для registry комнат и истории чата. API валидирует его на bootstrap, применяет migrations через `node-pg-migrate` до первого listen и не имеет runtime fallback на JSON-файл. Для compose можно не задавать `DATABASE_URL` явно: он собирается из `POSTGRES_DB`, `POSTGRES_USER`, `POSTGRES_PASSWORD` и service name `postgres`.

## Docker

Production compose собирает runtime-образы из одного Dockerfile и поднимает durable services:

- `postgres` — PostgreSQL с volume `postgres_data` и healthcheck;
- `api` — Node.js API на `:3000`, ждёт healthy Postgres, применяет migrations, хранит аватарки в volume `uploads` и отвечает только на `/api/*`;
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

Для Docker/production используйте отдельный prod-like `.env`: браузеры подключаются к `LIVEKIT_GATE_PUBLIC_URL` (по умолчанию `wss://$LIVEKIT_DOMAIN`), а API обращается к SFU по внутреннему `ws://livekit:7880`, зафиксированному в compose. Не задавайте публичный адрес через legacy-переменную `LIVEKIT_URL`: старое значение может оставаться в `.env`, но production API больше не использует его вместо внутреннего service URL.

В production приложение должно стоять за HTTPS, volumes `postgres_data` и `uploads` нужно бэкапить как единый согласованный набор, а LiveKit должен иметь публично доступные ICE/TCP и ICE/UDP порты. `postgres_data` содержит ключи аватарок, а `uploads` — соответствующие WebP-файлы; потеря одного из volumes делает резервную копию неполной. Для файловой копии volumes остановите оба изменяющих их сервиса (`docker compose stop api postgres`), сохраните `postgres_data` и `uploads`, затем запустите Postgres, дождитесь healthy-состояния и запустите API. Если Postgres останавливать нельзя, остановите API, сделайте согласованный `pg_dump`/`pg_basebackup`, отдельно заархивируйте неизменяемый в этот момент `uploads` и только после этого верните API. Альтернатива — атомарный snapshot обоих volumes на уровне хранилища. Если пользователи часто сидят за строгими корпоративными сетями, следующим шагом стоит добавить TURN/TLS в LiveKit deployment.


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

Когда VoiceRoom открыт внутри desktop-оболочки, web-клиент отправляет open-app уведомления через узкий preload bridge `window.voiceRoomDesktopNotifications.show(...)`. Electron main process валидирует payload и показывает native OS notification; если bridge недоступен или сообщает `unsupported`, web-клиент откатывается к обычному browser `Notification`. Этот bridge сам по себе не является offline-доставкой. Для залогиненных пользователей веб-клиент отдельно поддерживает Web Push через service worker и VAPID, если push включён для браузера и сервер настроен соответствующими ключами.

Мьют микрофона, мьют всего звука и push-to-talk синхронизируются с `window.voiceRoomDesktopHotkeys`: desktop-оболочка запускает native listener только после подключения к голосу и снимает его при выходе, завершённой навигации, падении renderer или завершении приложения. Listener работает с физическими кодами клавиш, поэтому сочетания не зависят от активной раскладки, а push-to-talk получает настоящие события нажатия и отпускания поверх других вкладок и приложений. На macOS при первом использовании может понадобиться разрешить Voice Room «Мониторинг ввода» и переподключиться к голосу. При блокировке экрана или сне desktop отпускает push-to-talk и безопасно перезапускает listener после возврата. Если native helper не запустился, desktop временно откатывает мьют микрофона и звука на Electron `globalShortcut`, а push-to-talk безопасно остаётся локальным. В обычной браузерной вкладке все сочетания остаются локальными, поскольку страница не получает клавиатурные события вне фокуса.

```bash
cd ../VoiceRoomDesktop
# Создайте .env для desktop по документации VoiceRoomDesktop
npm run desktop
```

## Безопасность

Комнаты приватны только за счет ссылки. Любой, у кого есть URL или код комнаты, может войти. Backend выдает LiveKit tokens только для существующих room sessions, но это не заменяет авторизацию или пароли на сами комнаты. Чат следует модели presence: читать можно по ссылке/коду комнаты, а писать может только активный участник комнаты с валидной peer-сессией или залогиненный пользователь.

Аккаунты служат для владения постоянными комнатами, а не для контроля доступа к ним. Пароли хешируются `scrypt` (встроенный `node:crypto`), сессия живёт в HttpOnly + SameSite=Lax cookie (`vr_session`) до `SESSION_TTL_MS`; попытки входа/регистрации ограничены `AUTH_RATE_LIMIT` на IP. Логин нормализуется в нижний регистр и уникален. При создании постоянной комнаты залогиненным пользователем она получает `owner_id`, и список «Мои комнаты» приходит с сервера (`GET /api/auth/rooms`). Временные комнаты остаются ownerless.

Во вкладке «Безопасность» видны все активные сеансы аккаунта: браузер или приложение, ОС, последний визит и город с страной, определённые по IP через локальную базу DB-IP. Сам IP-адрес в сеансе не хранится и никуда не отправляется; последний визит обновляется не чаще раза в час. Чужой сеанс можно завершить: его cookie перестаёт работать, WebSocket закрывается с кодом `4401`, а голос этого устройства обрывается сразу — отзываются только gate-credentials его peer, поэтому другие устройства аккаунта остаются в звонке. Смена пароля и восстановление доступа завершают все сеансы аккаунта.

Коды восстановления — десять одноразовых кодов по 16 символов Crockford base32 (80 бит). Создание набора требует текущий пароль, коды показываются один раз, а новый набор отменяет старый. В базе хранится только SHA-256 от `<id пользователя>:<код>`. Вход по коду (`POST /api/auth/recover`) задаёт новый пароль и ограничен `AUTH_RATE_LIMIT` отдельно по IP и по логину. Пока у аккаунта нет неиспользованных кодов, над комнатами в лобби висит напоминание; крестик скрывает его на 3 дня на всех устройствах (`users.metadata.recoveryCodesReminderSnoozedUntil`).

Каждый вход записывается в `account_login_events` (устройство, город, время; хранится 90 дней). Если браузер, ОС и город не подтверждены за последние 30 дней, остальные устройства аккаунта получают модалку «Новый вход в аккаунт»: сразу по WebSocket, push-уведомлением даже в режиме «Не беспокоить» и при следующем заходе, если ничего не было открыто. «Это я» подтверждает устройство; «Это не я» сразу завершает тот сеанс (cookie, сокеты, голос) и предлагает сменить пароль или обновить коды восстановления. Неотвеченный или отклонённый вход не делает устройство знакомым, ответ на одном устройстве закрывает вопрос на всех, а без ответа он пропадает через 14 дней.

Аккаунт можно удалить во вкладке «Безопасность» после ввода пароля. Он сразу скрывается: все сеансы и сокеты завершаются, имя везде становится «Удалённый аккаунт», его нельзя найти, написать ему или пригласить. Вход с паролем в течение 7 дней предлагает восстановить аккаунт в прежнем виде. По истечении срока таймер обслуживания API завершает удаление: каждая постоянная комната переходит самому давнему участнику, который не удаляется и не забанен в ней (комната без такого участника удаляется), удаляются друзья, заявки, блокировки, участие в комнатах, настройки уведомлений, push, коды восстановления и история входов. Строка пользователя остаётся обезличенной, поэтому личные сообщения и сообщения в комнатах у других людей не пропадают, а прежний логин хранится хешем в `reserved_logins` и больше не регистрируется.

Модалка «Что нового в Voice Room» показывается один раз на релиз: аккаунт хранит последнюю просмотренную версию объявления (`users.metadata.whatsNewSeen`), а новые аккаунты сразу получают текущую. К следующему релизу поднимите `WHATS_NEW_VERSION` в `packages/shared/src/account-security.js` и обновите список пунктов в `apps/web/src/lib/features/home/model/whats-new.ts`.

Владелец постоянной комнаты может исключить участника или создать бан. Бан сопоставляется с аккаунтом участника, если он залогинен, и с IP текущей peer-сессии; он проверяется при входе, получении LiveKit-токена, отправке сообщения и подписке на preview. Kick/ban инвалидирует peer-сессию и удаляет участника из LiveKit. Это инструмент модерации, а не режим приватной комнаты: любой не заблокированный пользователь со ссылкой или кодом по-прежнему может войти.

Web Push доступен только залогиненным пользователям и выключен без полного набора VAPID-ключей. Подписки хранятся на сервере; DND глушит push целиком, а mute треда ЛС — push только этого диалога. Mute комнаты хранится в серверных настройках аккаунта, синхронизируется между его устройствами и глушит системные уведомления и звуковые сигналы этой комнаты.

Постоянные комнаты больше не считаются в IP-квоту: создавать их могут только авторизованные пользователи, а владение ограничено `MAX_STATIC_ROOMS_PER_USER` (по умолчанию 3). Временные ownerless-комнаты остаются ограничены по IP через `MAX_TEMP_ROOMS_PER_IP` (legacy `MAX_EMPTY_ROOMS_PER_IP` используется только как fallback для старых env-файлов), чтобы один IP не заполнял `MAX_ROOMS` пустыми временными комнатами.

История чата хранится в PostgreSQL бессрочно: сообщения не протухают и не обрезаются по количеству, настройки для этого нет. Сообщение пропадает, только если его удалил автор или владелец постоянной комнаты либо удалена сама комната; через `RETENTION_KEEP_DELETED_MS` такое сообщение стирается из базы, а его вложения помечаются удалёнными, и их файлы убирает очистка медиа. Отправка чата ограничена `ROOM_CHAT_RATE_LIMIT` на пару IP+room за `ROOM_CHAT_RATE_WINDOW_MS`. Для production важно совместно бэкапить volumes `postgres_data` и `uploads` и не терять `DATABASE_URL`/credentials. Cleanup of idle dynamic rooms runs on a process-local `ROOM_PRUNE_INTERVAL_MS` timer; old soft-deleted rows are physically purged by `RETENTION_PURGE_INTERVAL_MS` after `RETENTION_KEEP_DELETED_MS`. API currently assumes exactly one running instance: presence (including peer IP for moderation), WebSocket registry, Ring, POW challenges, cleanup timers and non-durable rate-limit state are process-local. Durable rooms/messages/users, bans and push subscriptions live in PostgreSQL, avatar files live on the API `uploads` volume, and room quota/capacity enforcement is transactional in PostgreSQL at room creation time. Horizontal scaling requires sticky WebSocket routing, shared avatar storage such as S3 and moving other process-local state to shared storage such as Redis/pub-sub.

LiveKit снимает mesh-нагрузку с браузеров: каждый участник публикует микрофон и экран один раз в SFU, а остальные клиенты подписываются на tracks через LiveKit.

## Лицензия

MIT License. Vendored RNNoise assets в `apps/web/static/rnnoise/` распространяются под собственной MIT-лицензией в `apps/web/static/rnnoise/LICENSE`.
