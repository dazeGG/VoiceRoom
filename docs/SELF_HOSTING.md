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
| `RUSTORE_PUSH_SERVICE_TOKEN` | API и notification worker / RuStore Push | Сервисный ключ проекта push-уведомлений из консоли RuStore. Никогда не публиковать и не хранить в Git. |
| `GITHUB_TOKEN` | API desktop release endpoint, optional | Нужен только если хочется повысить лимит GitHub API. |
| `POW_SECRET` | API production/staging, optional | Стабильный secret для proof-of-work challenge; если не задан, генерируется на процесс и challenge'и инвалидируются при рестарте. |

**Variables** — не секреты, но окружение-зависимые настройки:

| Name | Default/пример | Комментарий |
| --- | --- | --- |
| `DOMAIN` | `voice.example.com` | Основной домен web-приложения. |
| `LIVEKIT_DOMAIN` | `livekit.${DOMAIN}` | Домен LiveKit. |
| `LIVEKIT_GATE_PUBLIC_URL` | `wss://livekit.example.com` | Публичный browser-facing URL auth-gate. По умолчанию собирается из `LIVEKIT_DOMAIN`. |
| `LIVEKIT_INTERNAL_URL` | `ws://livekit:7880` | Внутренний адрес LiveKit SFU для API при запуске без production compose. Production compose фиксирует service URL сам. |
| `LIVEKIT_METRICS_URL` | `http://livekit:6789/metrics` | Prometheus-метрики LiveKit, которые API раз в минуту записывает для страницы «Система» в админке: трафик, потери пакетов в обе стороны, повторные отправки, процессор и память LiveKit. Production compose задаёт адрес внутри своей сети сам; без него эти графики пустые. |
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
| `MAX_VOICE_PEERS` | `0` | Сколько человек может быть в голосе на всём сервере сразу; `0` — без лимита. Сверх лимита новый участник получает `server.full` («Сервер сейчас заполнен»), а те, кто уже в звонке, и переподключения не страдают. Значение для хоста — см. «Ёмкость сервера». |
| `MEDIA_BUDGET_MBPS` | `0` | Бюджет видео на весь сервер, Мбит/с; `0` — без лимита. Каждая демонстрация экрана и камера стоит свой битрейт, умноженный на число остальных людей в комнате (1080p60 — 10 Мбит/с зрителю, 720p30 — 5, камера — 0,45). Перед стартом клиент спрашивает сервер (`room.media.request`): когда бюджет занят, демонстрации предлагается качество ниже (720p с той же частотой кадров, затем меньше кадров), а если не помещается и оно, демонстрация или камера получает отказ. Идущие стримы не трогаются. Проверка идёт в момент старта, поэтому новый стрим оплачивается минимум за комнату из 9 человек: комната может вырасти уже после него. Сверх этого страхуют `LIVEKIT_LIMIT_BYTES_PER_SEC` и то, что LiveKit при перегрузке жертвует видео, а не голосом. Камеры клиентов старше этой версии в бюджет не попадают. |
| `MEDIA_BUDGET_VOICE_PEERS` | `0` | При скольких людях в голосе на сервере бюджет видео кончается; `0` — голос бюджет не уменьшает. Голос и видео делят процессор LiveKit, и при нехватке он сохраняет голос, поэтому загруженный голосом сервер ломает стримы задолго до своих пределов. Бюджет уменьшается линейно: при половине этого числа людей остаётся половина `MEDIA_BUDGET_MBPS`. |
| `MAX_ROOM_SCREENS` | `0` | Сколько демонстраций экрана может идти в одной комнате одновременно; `0` — без лимита. |
| `MAX_ROOMS` | `100` | Лимит живых временных комнат. Постоянные комнаты в него не входят: они ограничены `MAX_STATIC_ROOMS_PER_USER`. |
| `LIVEKIT_MEMORY_LIMIT` | `0` | Лимит памяти контейнера LiveKit (`2500m`); `0` — без лимита. Без него нехватка памяти на хосте без swap вешает весь сервер, с ним OOM killer перезапускает только LiveKit. |
| `LIVEKIT_LIMIT_BYTES_PER_SEC` | `0` | Страховка LiveKit поверх `MAX_VOICE_PEERS`: когда медиатрафик (вход + выход) превышает это число байт в секунду, новые входы получают 503, идущие звонки остаются. `0` — выключено. |
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
| `PLATFORM_ADMIN_USER_IDS` | empty | Id аккаунтов через запятую, которые всегда суперадминистраторы админки. Остальным роли (модератор, администратор, суперадминистратор) выдаёт суперадминистратор в разделе «Сотрудники». Пусто и без выданных ролей — админку не открывает никто, жалобы копятся неразобранными. См. `docs/LEGAL.md`. |
| `ADMIN_DOMAIN` | `admin.${DOMAIN}` | Домен админки (`apps/admin`). Нужна DNS-запись A/AAAA на этот сервер, как для `DOMAIN`; Caddy сам получит сертификат. Без записи основной сайт работает, админка просто не открывается. API получает `SITE_ORIGIN` и `ADMIN_ORIGIN` из compose, задавать их не нужно. |
| `REPORT_RATE_LIMIT` / `REPORT_RATE_WINDOW_MS` | `10` / `60000` | Лимит жалоб от одного аккаунта за окно. |
| `CALL_FEEDBACK_RATE_LIMIT` / `CALL_FEEDBACK_RATE_WINDOW_MS` | `5` / `600000` | Лимит ответов «Как прошёл звонок?» от одного аккаунта (гостя — с одного адреса) за окно. |
| `VAPID_PUBLIC_KEY` / `VAPID_SUBJECT` | empty | Публичная часть и контакт Web Push; вместе с secret `VAPID_PRIVATE_KEY` образуют полный VAPID-конфиг. Если любое значение отсутствует, push выключается без остановки API. |
| `RUSTORE_PUSH_PROJECT_ID` | empty | ID проекта push-уведомлений RuStore для Android-приложения. Вместе с `RUSTORE_PUSH_SERVICE_TOKEN` включает доставку пушей в приложение; если любое значение пустое, доставка в приложение выключена, Web Push работает как раньше. Отладочная и релизная сборки — разные проекты в консоли. |
| `ANDROID_MIN_VERSION` | empty | Минимальная поддерживаемая версия Android-приложения (`x.y.z`). Приложение старее получает на любой запрос к API ответ 426 `client_outdated`, его WebSocket закрывается с кодом 4426, а звонки (Ring) ему не приходят; остальные пуши приходят, потому что версия токена обновляется только при запуске приложения. Приложение показывает экран «Обновите приложение». Порог узнаётся через `GET /api/client/policy`. Пусто — ограничения нет. Неверный формат — API и воркер не стартуют. |
| `MAX_PUSH_SUBSCRIPTIONS_PER_USER` | `10` | Maximum retained Web Push subscriptions per account, and separately the Android app's push tokens; older entries are pruned transactionally. |
| `PUSH_SUBSCRIPTION_RATE_LIMIT` | `20` | Maximum Web Push subscription create/delete mutations per account per window. |
| `PUSH_SUBSCRIPTION_RATE_WINDOW_MS` | `60000` | Web Push subscription mutation rate-limit window. |
| `RING_RATE_LIMIT` / `RING_RATE_WINDOW_MS` | `1` / `30000` | Лимит Ring-приглашений от одного пользователя другому за окно. |
| `RING_TTL_MS` | `30000` | Время жизни Ring-приглашения в realtime, toast и Web Push. |
| `WS_MAX_PAYLOAD_BYTES` | `65536` | Max inbound WebSocket frame payload. |
| `HOST` | `127.0.0.1` | Host for host-only API. Compose sets `0.0.0.0`. |
| `PORT` | `3000` | API port. |
| `SOCKET_PATH` | empty | Unix socket вместо TCP, если нужен. |
| `API_METRICS_ALLOWED_REMOTE` | `127.0.0.1` | Caddy allowlist для публичного пути `/api/metrics`; задайте адрес или диапазон, с которого собираются метрики, иначе endpoint закрыт снаружи. Несколько адресов — через пробел. |
| `ANDROID_RELEASE_CERT_SHA256` | пусто | SHA-256 отпечаток ключа подписи Android-приложения (`AA:BB:…`, 32 байта, верхний регистр, через двоеточие; только шестнадцатеричные цифры и двоеточия, иначе Caddy не загрузит конфиг). Caddy отдаёт по нему `/.well-known/assetlinks.json` для пакета `voiceroom.app`, и ссылки `https://<DOMAIN>/r/<id>` открываются в приложении. Пусто или неверный формат — 404. На dev-стенде указывают отпечаток отладочного ключа: `FA:C6:17:45:DC:09:03:78:6F:B9:ED:E6:2A:96:2B:39:9F:73:48:F0:BB:6F:89:9B:83:32:66:75:91:03:3B:9C`. |
| `DESKTOP_RELEASE_REPO` | `dazeGG/VoiceRoomDesktop` | Repo для latest desktop release. |
| `DESKTOP_RELEASE_CACHE_MS` | `600000` | Cache TTL для desktop release metadata. |
| `GEOIP_DB_PATH` | empty (host) / `/data/geoip/dbip-city-lite.mmdb` (compose) | Локальная база [DB-IP City Lite](https://db-ip.com) (CC BY 4.0) для города и страны в списке устройств. Скачивается командой `node scripts/geoip/fetch-dbip-city-lite.mjs geoip/dbip-city-lite.mmdb` в каталог деплоя; обновлять раз в месяц и перезапускать `api`. Без файла список устройств показывается без города. |

Целочисленные переменные окружения API (лимиты, TTL, интервалы) должны быть целыми числами: если переменная задана, но не является целым числом (или меньше допустимого минимума), API не стартует, а не откатывается к значению по умолчанию. Неустановленная или пустая переменная по-прежнему берёт default из таблиц выше.

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
- **check** — `npm ci`, `npm run check` (tsc, vue-tsc, ESLint и Prettier по shared, api и web), `npm run build` (Vite).
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
- `caddy` — frontend static build из `apps/web/dist`, reverse proxy для `/api/*` и отдельный reverse proxy для LiveKit domain. JS-чанки прошлых релизов он держит в volume `web_archive` 30 дней, чтобы вкладки, открытые до выкатки, продолжали работать;
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

### UDP-буферы для LiveKit

Всё медиа LiveKit идёт через один UDP-сокет (`7882`). Ядро Ubuntu по умолчанию даёт сокету 212 КБ (`net.core.rmem_max`), и LiveKit пишет при старте `UDP receive buffer is too small for a production set-up`. Под нагрузкой такой буфер переполняется, и входящие пакеты стримеров пропадают ещё до SFU. Поднимите лимиты на хосте (параметры не относятся к сетевому namespace, поэтому задаются на хосте, а не в compose):

```bash
printf 'net.core.rmem_max=16777216\nnet.core.wmem_max=16777216\n' | sudo tee /etc/sysctl.d/90-livekit-udp.conf
sudo sysctl --system
docker compose restart livekit
```

После перезапуска предупреждения в `docker compose logs livekit` быть не должно. На нагрузочном тесте это удвоило число комнат с камерами без потерь (с 8 до 16 полных комнат): без буферов сброшенные пакеты публикующих вызывали лавину повторных запросов и ключевых кадров.

### Ёмкость сервера

Нагрузочный тест на копии хоста с 2 vCPU (AMD Ryzen 9 9950X) и 4 ГБ, без swap (`scripts/load/README.md`, октябрь 2026):

| Нагрузка | Предел без потерь | Что кончается первым |
| --- | --- | --- |
| Голос, комнаты по 9 человек | ~1100 участников (125 комнат), CPU 92 % | CPU |
| Голос, комнаты по 16–24 человека | ~800 участников | память (~2 МБ на участника в LiveKit) |
| Демонстрация экрана 1080p60 (~10 Мбит/с зрителю) | ~70 зрителей | CPU на пересылке пакетов, ~1 Гбит/с исходящего |
| Демонстрация экрана 720p30 (~6 Мбит/с зрителю) | ~130 зрителей | то же |
| Камеры у всех, сетка 3×3 | ~70 участников, ~140 с поднятыми UDP-буферами | CPU (без буферов — на повторных запросах потерянных пакетов), затем память |

Комнаты по 25 человек (повторный тест с этими лимитами, 3 человека в каждой голосовой комнате говорят без пауз):

| Нагрузка | Без потерь | Ломается |
| --- | --- | --- |
| Голос | 600 участников, CPU 80 %, потери 0,4 % | 750: потери 6 % |
| Стрим 1080p60 на 24 зрителя | 2 комнаты, 580 Мбит/с | 3 комнаты: потери 17 % |
| Стрим 720p30 на 24 зрителя | 3 комнаты, 520 Мбит/с | 4 комнаты: потери 6 % |
| 9 камер на 25 зрителей | 6 комнат | 8 комнат: потери 0,8 % |
| 226 в голосе + стрим 1080p60 на 24 | без потерь | — |
| 376 в голосе + стрим 720p30 на 24 | — | стрим теряет 33 %, голос 0 % |
| 200 в голосе + два стрима 1080p60 на 24 | — | стримы теряют 28 %, голос 0 % |

При перегрузке LiveKit первым жертвует видео: голос рядом с разваливающимися стримами теряет 0–0,5 % пакетов. Но поэтому голос и видео нельзя ограничивать порознь: сервер, где в голосе 400 человек, ломает даже один стрим на полную комнату. Нехватка памяти, наоборот, роняет всё: за ~1300 участников OOM killer забирает LiveKit, а хост без swap минутами не отвечает даже по SSH. Для такого хоста:

- `MAX_VOICE_PEERS=600`: голос в комнатах по 25 держит 600 почти без потерь;
- `MEDIA_BUDGET_MBPS=550`, `MEDIA_BUDGET_VOICE_PEERS=480` и `MAX_ROOM_SCREENS=3`: на пустом сервере влезают две полные комнаты со стримом 1080p, при 226 в голосе одна, с 480 в голосе видео нет совсем. Формула пропускает каждый чистый шаг из таблицы и не пропускает ни один сломанный;
- `MAX_ROOM_PEERS=25` и `LIVEKIT_MAX_PARTICIPANTS=50`: большие комнаты держатся голосом, а их стримы ограничивает бюджет;
- `MAX_ROOMS=300`: комната сама почти ничего не стоит, лимит только от спама;
- `LIVEKIT_MEMORY_LIMIT=2500m`, `LIVEKIT_LIMIT_BYTES_PER_SEC=110000000` (~880 Мбит/с вход + выход) как страховка.

Другой хост пересчитайте по тем же сценариям.


## Продуктовая аналитика

API пишет для дашбордов три вещи:

- `voice_sessions` — одна строка на каждый заход в войс: комната, аккаунт или гость, вход и выход, клиент, система и браузер, ключ адреса и как шла сеть по оценке самого клиента (хорошо, нестабильно или плохо; админка красит этим полосы звонка). Город не хранится: его видно только у тех, кто в звонке сейчас;
- `user_activity_days` — в какие дни аккаунт был активен и с какого клиента (десктоп-приложение, телефон, браузер). День считается по Москве;
- `product_snapshots` — пики каждой четверти часа: аккаунтов онлайн, гостевых подключений, людей и комнат в войсе.

По людям это хранится 90 дней (`VOICE_HISTORY_KEEP_DAYS`). Раз в сутки API сворачивает более старые дни в счётчики `product_days` и замораживает удержание каждой недели регистраций в `retention_weeks`, затем удаляет отметки активности и стирает у старых заходов в войс аккаунт, устройство, комнату, ключ адреса и данные о сети: остаётся только время. Пики `product_snapshots` обезличены и хранятся бессрочно.

Логи всех контейнеров ограничены: `json-file`, 3 файла по 10 МБ на сервис (`x-logging` в `docker-compose.yml`). Ограничение применяется при пересоздании контейнера. Первый деплой с ним меняет конфигурацию всех сервисов, и `docker compose up -d` пересоздаёт их все, включая `livekit`: идущие звонки на минуту прервутся, поэтому такой релиз лучше выкатывать, когда звонков мало. Следующие деплои снова не трогают `livekit`.

Их показывает админка (`https://ADMIN_DOMAIN`, ссылка рядом с логотипом у сотрудников): разделы «Обзор» и «Продукт», для роли администратора и выше. Отдельного дашборда и доступа к базе снаружи для этого не нужно.

## Админка

Админка — отдельное приложение `apps/admin` на своём домене `ADMIN_DOMAIN`. Пароля у неё нет: сотрудник открывает её, уже войдя на основной сайт, и основной сайт передаёт вход одноразовым кодом (`/api/staff/handoff`). У админки своя cookie, только для её домена; выход на основном сайте или «выйти со всех устройств» закрывает и её. Тем, кто не сотрудник, весь домен отвечает 404: Caddy спрашивает API (`forward_auth`, `/api/staff/check`) до того, как отдать любой файл. Код живёт 60 секунд в памяти API: если API перезапустился ровно в этот момент, сотрудник увидит 404 и просто откроет админку ещё раз.

Роли: модератор разбирает жалобы, видит комнаты и блокирует на время; администратор видит ещё статистику и откуда заходили (ключ адреса и город), блокирует навсегда, удаляет и ставит отметки; суперадминистратор раздаёт роли.

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
