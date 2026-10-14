# Self-hosting и эксплуатация

Как поднять VoiceRoom на своём сервере: окружение и секреты, Docker, TURN, CI/CD и миграции. Обзор продукта и быстрый локальный запуск — в [`README.md`](../README.md).

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
| `LIVEKIT_TOKEN_TTL_SECONDS` | `600` | TTL LiveKit JWT. Нужен только на время входа: подключённому участнику LiveKit сам продлевает токен, поэтому короткий TTL ограничивает жизнь утёкшего токена. |
| `LIVEKIT_GATE_CREDENTIAL_TTL_SECONDS` | `21600` | TTL пропуска auth-gate. Пропуск отзывается на сервере (kick/ban/mute/выход) и нужен для resume и переподключений внутри звонка. |
| `LIVEKIT_ROSTER_WAIT_MS` | `5000` | Сколько `/api/livekit-token` ждёт, пока realtime-join участника дойдёт до ростера комнаты. Токен выдаётся только участнику ростера. |
| `TURN_ENABLED` | `false` | Включает TURN/TLS на общем `:443` и TURN/UDP на `3478` (см. «TURN/TLS на 443»). |
| `TURN_DOMAIN` | пусто | DNS-имя TURN, обязательно при `TURN_ENABLED=true`. |
| `LIVEKIT_MAX_PARTICIPANTS` | `24` | Лимит участников на стороне SFU — страховка поверх `MAX_ROOM_PEERS` с запасом на переподключения. Держите его не меньше `2 × MAX_ROOM_PEERS`, иначе LiveKit откажет во входе раньше API. |
| `LIVEKIT_ROOM_PREFIX` | `voice-room-` | Prefix room id в LiveKit. Должен совпадать у API и auth-gate: gate сверяет комнату в JWT с комнатой пропуска. |
| `MAX_ROOM_PEERS` | `12` | Max peers per room. |
| `MAX_ROOMS` | `100` | Общий лимит комнат. |
| `MAX_EMPTY_ROOMS_PER_IP` | `3` | Legacy лимит временных empty rooms на IP. |
| `MAX_TEMP_ROOMS_PER_IP` | optional | Новый явный лимит temporary rooms на IP. |
| `MAX_STATIC_ROOMS_PER_USER` | `3` | Лимит постоянных комнат на аккаунт. |
| `ROOM_IDLE_TTL_MS` | `900000` | TTL пустой dynamic room. |
| `ROOM_PRUNE_INTERVAL_MS` | `60000` | Интервал soft-cleanup expired messages / idle dynamic rooms. |
| `RETENTION_PURGE_INTERVAL_MS` | `3600000` | Интервал физического удаления старых soft-deleted rows. `0` выключает purge. |
| `RETENTION_KEEP_DELETED_MS` | `2592000000` | Сколько хранить soft-deleted rows перед hard-delete. |
| `LINK_PREVIEWS_ENABLED` | `false` (в `docker-compose.yml` — `true`) | Превью первой ссылки в сообщении. API сам открывает страницу только в публичном интернете (http/https на портах 80 и 443, без внутренних адресов на каждом редиректе), берёт заголовок, описание и картинку и хранит картинку в `uploads/link-previews`, так что читатели ничего не загружают со стороннего сайта. |
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
| `LOGIN_FAILURE_LIMIT` | `10` | Попыток входа на один логин за окно, с любых адресов (попытка засчитывается до проверки пароля, успешный вход сбрасывает счётчик). Компромисс: подбором можно на окно заблокировать вход в чужой аккаунт; восстановление по коду при этом работает. |
| `LOGIN_FAILURE_WINDOW_MS` | `900000` | Окно счётчика неудачных входов на логин. |
| `DM_RATE_LIMIT` | `30` | DM send rate limit per user. |
| `DM_RATE_WINDOW_MS` | `10000` | DM rate window. |
| `FRIEND_REQUEST_RATE_LIMIT` | `20` | Friend request rate limit per user. |
| `FRIEND_REQUEST_RATE_WINDOW_MS` | `60000` | Friend request rate window. |
| `AVATAR_UPLOAD_RATE_LIMIT` | `10` | Максимум загрузок аватарок на аккаунт за окно. |
| `AVATAR_UPLOAD_RATE_WINDOW_MS` | `60000` | Окно rate limit загрузки аватарок. |
| `MAX_REALTIME_STREAMS_PER_USER` | `8` | Max concurrent WebSocket streams per authenticated user. |
| `MAX_GUEST_STREAMS_PER_IP` | `8` | Max concurrent guest WebSocket streams per client IP. |
| `MAX_ROOM_BANS` | `100` | Максимум активных блокировок на постоянную комнату. |
| `PLATFORM_ADMIN_USER_IDS` | empty | Id аккаунтов через запятую, которые разбирают жалобы на `/admin/reports` и могут удалить любое сообщение. Пусто — жалобы копятся, но разбирать их в приложении некому. См. `docs/LEGAL.md`. |
| `REPORT_RATE_LIMIT` / `REPORT_RATE_WINDOW_MS` | `10` / `60000` | Лимит жалоб от одного аккаунта за окно. |
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
| `API_METRICS_ALLOWED_REMOTE` | `127.0.0.1` | Caddy allowlist для публичного пути `/api/metrics`; задайте адрес или диапазон, с которого собираются метрики, иначе endpoint закрыт снаружи. |
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

## CI/CD (GitHub Actions)

Пайплайн описан в `.github/workflows/ci.yml`. Проверки запускаются для pull request и push в `develop`/`main`. Ветки, PR, коммиты, hotfix и релизы ведутся по [`GIT_FLOW.md`](./GIT_FLOW.md):

- **policy** — проверяет допустимый Git Flow маршрут PR и Conventional Commit формат PR title.
- **check** — `npm ci`, `npm run check` (tsc, svelte-check, ESLint и Prettier по shared, api и web), `npm run build` (Vite).
- **test** — тесты shared и API против эфемерного PostgreSQL service-контейнера, файлы API-тестов идут в 4 потока, каждый тест получает копию шаблонной базы. **test-web** — тесты веба (Vitest) отдельным job параллельно с API. `TEST_DATABASE_URL` задаётся прямо в workflow одноразовым значением — секрет для этого **не нужен** (test harness создаёт/удаляет временную БД на каждый тест).
- **voice-join** — проверка входа в голосовую комнату через LiveKit.
- **G05 / G08** — строгий LiveKit-профиль и порог покрытия изменённого кода.

**Деплой** (`.github/workflows/deploy.yml`, вызывается из `ci.yml` только после зелёных `check`, `test`, `test-web`, `voice-join` и G05):

- **images** — на каждый push в `develop`, `main` и тег `v*` собирает таргеты `api`, `worker`, `web` и публикует `ghcr.io/dazegg/voiceroom-<target>:<commit-sha>`.
- **deploy-dev** — push в `develop` сразу выкатывается на dev (environment `dev`, https://dev.voiceroom.ru).
- **deploy-production** — тег `v*` на коммите из `main`, совпадающий с версией в `package.json`, сразу выкатывается на прод без ручного подтверждения: environment `production` только ограничивает деплой тегами `v*` (https://voiceroom.ru).

Выкатку делает `scripts/cd/remote-deploy.sh` на сервере по SSH: бэкап `.env` и `pg_dump` в `deploy-backups/ci/` (хранятся 5 последних, а дампы и копии `.env` старше 30 дней удаляются и в `deploy-backups/ci/`, и в `deploy-backups/manual/`), `git checkout` коммита, `docker pull` образов, подстановка `VOICEROOM_*_IMAGE` в `.env`, `docker compose config`, `docker compose up -d --wait`. Если любой шаг падает, возвращаются прежние коммит, `.env` и контейнеры. Миграции при этом **не откатываются** — после неудачной миграции восстанавливайте БД из дампа (см. «Миграции» ниже).

Каждый environment хранит свои secrets `SSH_HOST`, `SSH_USER`, `SSH_KEY` и variables `DEPLOY_PATH`, `SSH_FINGERPRINT` (ED25519-отпечаток хоста; без совпадения деплой не стартует). Серверный `.env` (как минимум `DOMAIN`, `POSTGRES_PASSWORD`, `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET`, `LIVEKIT_GATE_SECRET`, `VOICE_ROOM_CURSOR_HMAC_KEYS`) живёт на сервере, а не в Actions.

Прочие рекомендации:

- Для protected branches включите required reviewers; сделайте `policy`, `check` и `test` обязательными проверками для PR в `develop` и `main`.
- Не печатайте secrets в workflow logs; передавайте их через `with:`/`env:` только в нужные jobs/steps.

## Миграции

```bash
npm --workspace @voice-room/api run db:migrate
npm --workspace @voice-room/api run db:rollback
```

`DATABASE_URL` — основное хранилище комнат, сообщений и аккаунтов. В production миграции применяет одноразовый сервис `migrate` до старта `api`, а API только проверяет, что схема готова. Вне production API сам применяет миграции при старте (`MIGRATE_ON_START`). Для compose можно не задавать `DATABASE_URL` явно: он собирается из `POSTGRES_DB`, `POSTGRES_USER`, `POSTGRES_PASSWORD` и service name `postgres`.

Сервис `migrate` берёт advisory lock репозитория с таймаутом 5 секунд, отмечает прогон как `running`, выполняет миграции по порядку в одной транзакции, проверяет, что lock всё ещё у него, и отмечает `clean`. Ошибка или потеря lock оставляет отметку `dirty`, и production API с ней не стартует. Снять диагностированную отметку можно только явной командой `--clear-dirty`, которой тоже нужен lock. В production запрещены `--no-lock`, автоматические миграции при старте API и down-миграции: откат — это предыдущий образ приложения на расширенной схеме.

## Docker

Production compose запускает образы `api`, `worker` и `web` из одного Dockerfile:

- `postgres` — PostgreSQL с volume `postgres_data` и healthcheck;
- `migrate` — одноразовый прогон миграций до старта остальных сервисов;
- `api` — Node.js API на `:3000`, хранит аватарки в volume `uploads`, вложения в volume `media` и отвечает только на `/api/*`;
- воркеры `message-delivery`, `notification-delivery`, `media-processing`, `media-maintenance` и `media-reconciliation` — доставка сообщений и уведомлений и обработка медиа;
- `caddy` — frontend static build из `apps/web/dist`, reverse proxy для `/api/*` и отдельный reverse proxy для LiveKit domain;
- `livekit` — LiveKit SFU, `livekit-gate` — auth-gate перед ним (см. [`LIVEKIT_GATE.md`](./LIVEKIT_GATE.md)).

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

В production приложение должно стоять за HTTPS, volumes `postgres_data` и `uploads` нужно бэкапить как единый согласованный набор, а LiveKit должен иметь публично доступные ICE/TCP и ICE/UDP порты. `postgres_data` содержит ключи аватарок, а `uploads` — соответствующие WebP-файлы; потеря одного из volumes делает резервную копию неполной. Для файловой копии volumes остановите оба изменяющих их сервиса (`docker compose stop api postgres`), сохраните `postgres_data` и `uploads`, затем запустите Postgres, дождитесь healthy-состояния и запустите API. Если Postgres останавливать нельзя, остановите API, сделайте согласованный `pg_dump`/`pg_basebackup`, отдельно заархивируйте неизменяемый в этот момент `uploads` и только после этого верните API. Альтернатива — атомарный snapshot обоих volumes на уровне хранилища. Вложения чата лежат в volume `media`.

Согласованный бэкап медиа — это дамп PostgreSQL вместе с деревом загрузок; половина пары не восстанавливается. Снимите дамп, пока запись медиа остановлена, и соберите снимок:

```sh
node scripts/backup/create-coordinated-snapshot.mts --database /safe/input/database.dump --uploads /safe/input/uploads --catalog /safe/input/media-catalog.json --output /safe/archive/snapshot-001 --namespace restore-drill-001
```

Скрипт копирует обе части в один каталог и пишет их размеры и SHA-256 в `manifest.json`. Восстанавливать можно только в новый каталог внутри изолированного корня; команда проверяет пути, размеры и хеши и отказывается от symlink, существующих целей и неполных пар:

```sh
node scripts/restore/restore-coordinated-snapshot.mts --snapshot /safe/archive/snapshot-001 --allowed-root /tmp/voice-room-restore-drill --target /tmp/voice-room-restore-drill/restored --namespace restore-drill-001
```

Каталог (`--catalog`) содержит `attachments` с `id`, `state`, `access`, `width`, `height` и массив `leases`. При восстановлении все захваченные задачи `leased` возвращаются в `pending` без владельца, а `restore-report.json` записывает их число. После `pg_restore` сверьте каталог со строками базы до запуска первого воркера и убедитесь, что очистка и обработка продолжились без дублей вложений. Для пользователей за строгими корпоративными сетями включите TURN (раздел ниже).

### TURN/TLS на 443

Без TURN медиа идёт только по UDP `7882` и TCP `7881`. Сети, где открыты лишь 80/443 (офисы, гостиницы, учебные заведения), не подключат голос вовсе. Встроенный TURN LiveKit закрывает этот случай, и ему не нужен отдельный IP: Caddy (собран с `caddy-l4`) смотрит TLS SNI на общем `:443`, соединения к `TURN_DOMAIN` расшифровывает и передаёт LiveKit на `5349`, остальные идут на сайты как раньше.

1. Создайте DNS-запись `TURN_DOMAIN` (например `turn.example.com`) на этот хост.
2. В `.env`: `TURN_ENABLED=true` и `TURN_DOMAIN=turn.example.com`. Caddy сам получит сертификат для этого имени.
3. Откройте на хосте `3478/udp` (TURN/UDP) и `30000-30099/udp` (relay-порты: ретранслированное медиа возвращается на IP ноды).
4. Проверка: откройте комнату с `?forceRelay=1`. Медиа тогда идёт только через TURN, в подсказке статуса голоса должно быть «через ретранслятор», и звук должен проходить.

Если relay через Docker-bridge не заработает (hairpin NAT до публичного IP ноды зависит от хоста), следующий шаг — `network_mode: host` для сервиса `livekit`.


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

Автоматизированный аналог покрыт тестом `manual static-room chat scenario survives API restart without voice join` в `apps/api/test/chat.test.ts`.
