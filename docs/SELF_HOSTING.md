# Self-hosting и эксплуатация

Как поднять VoiceRoom на своём сервере: окружение и секреты, Docker, TURN, CI/CD и миграции. Обзор продукта и быстрый локальный запуск — в [`README.md`](../README.md).

Для временных видеовстреч используйте [установщик VoiceRoom Meet](../apps/docs/src/content/docs/self-hosting/install.md). На чистом Linux-сервере он настраивает домен, создаёт `.env` и запускает готовые образы. Для аккаунтов, постоянных комнат, истории чатов и админки см. [установку полного стека](#установка-полного-стека).

Адрес `get.voiceroom.ru` использует отдельную конфигурацию [Caddy](../apps/get/Caddyfile) с перенаправлением на `install.sh` из последнего релиза приложения в GitHub. Для работы команды установки нужны этот HTTPS-хост и релиз с файлом `install.sh`, манифестом и `docker-compose.personal.yml`.

Для DuckDNS и deSEC установщик читает A- и AAAA-записи перед изменением DNS. Если адрес отличается от публичного IPv4 сервера, для установки, `voiceroom domain set` и настройки нового имени TURN при обновлении требуется подтверждение в терминале. По умолчанию ответ «нет». При запуске без терминала передайте `--replace-dns`, только если намерены заменить эти записи. После подтверждения установщик направит A-записи на сервер и удалит существующие AAAA-записи для настраиваемых имён. Скачивание образов при установке и обновлении повторяется до трёх попыток. При окончательном сбое команда выводит последние строки диагностики Compose с удалёнными секретами.

## Ручная установка Meet

`docker-compose.personal.yml` поднимает отдельный сервер для временных видеовстреч Meet. Personal-серверу нужны собственный Compose-проект и собственная база PostgreSQL.

В отдельном `.env.personal` задайте `PERSONAL_DOMAIN` и `PERSONAL_LIVEKIT_API_KEY`, а также отдельные случайные значения для `PERSONAL_POSTGRES_PASSWORD`, `PERSONAL_LIVEKIT_API_SECRET` и `PERSONAL_GATE_SECRET` (например, `openssl rand -hex 32` для каждого).

Для `PERSONAL_DOMAIN=meet.example.com` создайте A-записи `meet.example.com` и `turn.meet.example.com` на публичный IPv4 сервера. Используйте режим «только DNS» у DNS-провайдера. На сервере с одним IPv4 оставьте оба имени без AAAA-записей. Caddy автоматически получит сертификаты для обоих имён и передаст сигналинг через auth-gate на домене Meet.

Откройте входящие порты в файрволе сервера и в панели хостинга.

| Порт | Для чего |
| --- | --- |
| `80/TCP` | HTTP и получение сертификатов |
| `443/TCP` | HTTPS, сигналинг LiveKit и TURN/TLS через Caddy |
| `7881/TCP`, `7882/UDP` | Прямая передача медиа LiveKit |
| `3478/UDP` | TURN по UDP |
| `30000–30099/UDP` | Порты ретрансляции медиа LiveKit |

TURN включён по умолчанию. Если сеть участника блокирует прямые медиапорты, браузер может подключиться к `turn.<домен>` на `443/TCP`. Caddy выбирает маршрут по TLS SNI и передаёт соединение встроенному TURN-серверу LiveKit.

Для HTTPS персональный Caddy использует HTTP/1.1 и HTTP/2 по TCP. Открывать `443/UDP` не требуется.

```sh
docker compose --env-file .env.personal -f docker-compose.personal.yml up -d --build --wait
docker compose --env-file .env.personal -f docker-compose.personal.yml exec -T api node apps/api/src/scripts/owner-link.ts
# Для ротации
docker compose --env-file .env.personal -f docker-compose.personal.yml exec -T api node apps/api/src/scripts/owner-link.ts --rotate
```

Откройте в браузере ссылку из команды `owner-link.ts`, нажмите «Создать встречу» и скопируйте ссылку на встречу. Откройте эту ссылку сами, если хотите участвовать, и отправьте её гостям. Каждый участник вводит своё имя, нажимает «Присоединиться к встрече» и разрешает браузеру доступ к микрофону. В звонке можно включить камеру и поделиться экраном.

В чате встречи можно отправлять текст. Сообщения получают только участники, подключённые к этой встрече в момент отправки. Сервер не хранит сообщения. История видна только в той вкладке, где сообщения были получены, и очищается при выходе из встречи. Новые участники не видят предыдущие сообщения. Пропущенные сообщения после переподключения не доставляются.

Секрет владельца хранится в томе `owner`. Ссылка владельца обменивается один раз на разрешение создавать комнаты на пять минут. Когда потребуется новая ссылка владельца, выполните команду с `--rotate`. Ротация отзывает старые ссылки и разрешения владельца. Медиадоступ гостей сохраняется. Гостям передавайте только ссылку на комнату.

Personal-сервер не записывает историю пребывания в звонках, аналитику или замеры использования и не выполняет поиск по IP или геолокации. Отображаемые имена живут в памяти. PostgreSQL хранит рабочие записи комнаты, идентификаторы участников с хешами токенов и данные допуска к LiveKit до закрытия комнаты. После ухода последнего участника и окончания срока ожидания переподключения пустую комнату удаляет проверка по таймеру. При старте сервер удаляет рабочие записи оставшихся Meet-комнат. Удаление физическое на уровне таблиц. Журналы стека не содержат имён участников, текста сообщений или токенов. Docker хранит до трёх файлов журнала по 10 МБ на контейнер.

Сам сервер не создаёт резервных копий. При обновлении через `voiceroom upgrade` CLI останавливает приём звонков и создаёт закрытую временную копию PostgreSQL для отката миграций. Копия удаляется после успешного обновления или отката, а при прерванном или неудачном восстановлении сохраняется для следующей попытки. Копии `.env` и манифеста релиза остаются в `/opt/voiceroom/backups`. Если вы самостоятельно копируете PostgreSQL или его том, копия хранится по вашей политике. Копии базы могут содержать рабочие записи, существовавшие на момент копирования.

## Установка полного стека

Полный VoiceRoom запускается через `docker-compose.yml`. Понадобится Linux-сервер `x86_64` с публичным IPv4, Docker Engine с плагином `docker compose`, Git и OpenSSL. Порты `80/TCP`, `443/TCP`, `7881/TCP` и `7882/UDP` должны быть свободны на сервере и доступны через файрвол. HTTPS и сигналинг LiveKit обслуживает Caddy, медиа проходит на `7882/UDP` или `7881/TCP`.

Создайте A-записи `voice.example.com`, `livekit.voice.example.com` и, если нужна админка, `admin.voice.example.com` на IP сервера. Замените `voice.example.com` своим доменом. У DNS-провайдера выберите режим «только DNS», если он предлагает проксирование трафика. Добавляйте AAAA-записи, только если сервер доступен по IPv6.

Скачайте тег приложения, для которого опубликованы образы API, воркера и веб-приложения. В примере используется `v2.15.0`.

```sh
git clone --depth 1 --branch v2.15.0 https://github.com/dazeGG/VoiceRoom.git
cd VoiceRoom
```

В этом блоке замените только `voice.example.com`. Если `.env` уже существует, блок остановится и сохранит его содержимое.

```sh
(
  set -euC
  umask 077
  domain=voice.example.com
  release_sha=$(git rev-parse HEAD)
  postgres_password=$(openssl rand -hex 32)
  livekit_key=$(openssl rand -hex 16)
  livekit_secret=$(openssl rand -hex 32)
  gate_secret=$(openssl rand -hex 32)
  cursor_key=$(openssl rand -hex 32)

  cat > .env <<EOF
DOMAIN=$domain
POSTGRES_PASSWORD=$postgres_password
LIVEKIT_API_KEY=$livekit_key
LIVEKIT_API_SECRET=$livekit_secret
LIVEKIT_GATE_SECRET=$gate_secret
VOICE_ROOM_CURSOR_HMAC_KEYS=$cursor_key
VOICEROOM_API_IMAGE=ghcr.io/dazegg/voiceroom-api:$release_sha
VOICEROOM_WORKER_IMAGE=ghcr.io/dazegg/voiceroom-worker:$release_sha
VOICEROOM_WEB_IMAGE=ghcr.io/dazegg/voiceroom-web:$release_sha
EOF
)
```

Сохраните `.env` в закрытой резервной копии. Compose выводит `LIVEKIT_DOMAIN` и `ADMIN_DOMAIN` из `DOMAIN`. Если выбрали другие имена, добавьте их в `.env` явно.

```sh
docker compose config --quiet &&
  docker compose pull &&
  docker compose up -d --wait
```

Откройте `https://voice.example.com/app`, создайте комнату и проверьте звук с собеседником в обе стороны. Если страница открывается, а звонок не соединяется, проверьте DNS имени LiveKit и доступность `7882/UDP` и `7881/TCP` из внешней сети. Для сетей, которые пропускают только веб-трафик, см. [настройку TURN/TLS](#turntls-на-443).

```sh
docker compose ps -a
curl -fsS https://voice.example.com/api/healthz
docker compose logs --tail=100 caddy migrate api livekit livekit-gate
```

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
| `VOICE_ROOM_CURSOR_HMAC_KEYS` | API production | Стабильный ключ подписи курсоров. Для новой установки подойдёт отдельное значение `openssl rand -hex 32`. |
| `VAPID_PRIVATE_KEY` | API / Web Push | Приватная часть стабильной VAPID-пары. Никогда не публиковать и не хранить в Git. |
| `RUSTORE_PUSH_SERVICE_TOKEN` | API и notification worker / RuStore Push | Сервисный ключ проекта push-уведомлений из консоли RuStore. Никогда не публиковать и не хранить в Git. |
| `GITHUB_TOKEN` | API desktop release endpoint, optional | Нужен только если хочется повысить лимит GitHub API. |
| `POW_SECRET` | API production/staging, optional | Стабильный secret для proof-of-work challenge; если не задан, генерируется на процесс и challenge'и инвалидируются при рестарте. |

**Variables** — не секреты, но окружение-зависимые настройки:

| Name | Default/пример | Комментарий |
| --- | --- | --- |
| `DOMAIN` | `voice.example.com` | Публичный домен VoiceRoom. По умолчанию также обслуживает веб-приложение. |
| `APP_DOMAIN` | optional | Отдельный хост веб-приложения. Укажите после настройки DNS и проверки ссылок и клиентов. |
| `DOCS_DOMAIN` | optional | Отдельный хост статической документации. Укажите после настройки DNS. |
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
| `CANONICAL_HOST` | `voiceroom.ru` | Единственный хост, который поисковикам можно индексировать. На любом другом хосте (dev-стенд, своя копия) Caddy добавляет ко всем ответам `X-Robots-Tag: noindex`. Публичный сайт (`apps/site`) указывает canonical-адреса на `https://voiceroom.ru`; своей копии, которую нужно индексировать, задайте здесь свой домен и поменяйте `SITE_ORIGIN` в `apps/site/src/site.ts`. |
| `ANDROID_RELEASE_CERT_SHA256` | пусто | SHA-256 отпечаток ключа подписи Android-приложения (`AA:BB:…`, 32 байта, верхний регистр, через двоеточие; только шестнадцатеричные цифры и двоеточия, иначе Caddy не загрузит конфиг). Caddy отдаёт по нему `/.well-known/assetlinks.json` для пакета `voiceroom.app`, и ссылки `https://<DOMAIN>/r/<id>` открываются в приложении. Пусто или неверный формат — 404. На dev-стенде указывают отпечаток отладочного ключа: `FA:C6:17:45:DC:09:03:78:6F:B9:ED:E6:2A:96:2B:39:9F:73:48:F0:BB:6F:89:9B:83:32:66:75:91:03:3B:9C`. |
| `DESKTOP_RELEASE_REPO` | `dazeGG/VoiceRoomDesktop` | Repo для latest desktop release. |
| `DESKTOP_RELEASE_CACHE_MS` | `600000` | Cache TTL для desktop release metadata. |
| `GEOIP_DB_PATH` | empty (host) / `/data/geoip/dbip-city-lite.mmdb` (compose) | Локальная база [DB-IP City Lite](https://db-ip.com) (CC BY 4.0) для города и страны в списке устройств. Скачивается командой `node scripts/geoip/fetch-dbip-city-lite.mjs geoip/dbip-city-lite.mmdb` в каталог деплоя; обновлять раз в месяц, `api` подхватит новый файл при следующем поиске без перезапуска. Без файла список устройств показывается без города. |

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

Для первого запуска production Compose нужны:

```text
DOMAIN
POSTGRES_PASSWORD
LIVEKIT_API_KEY
LIVEKIT_API_SECRET
LIVEKIT_GATE_SECRET
VOICE_ROOM_CURSOR_HMAC_KEYS
VOICEROOM_API_IMAGE
VOICEROOM_WORKER_IMAGE
VOICEROOM_WEB_IMAGE
```

`LIVEKIT_DOMAIN` по умолчанию равен `livekit.${DOMAIN}`. Версии трёх образов должны соответствовать одному релизу и используемому файлу Compose.

`DATABASE_URL` в compose соберётся автоматически из `POSTGRES_DB`, `POSTGRES_USER`, `POSTGRES_PASSWORD` и service name `postgres`. Если деплой не через compose — задайте `DATABASE_URL` явно как secret.
Если Web Push намеренно не используется, `VAPID_*` можно опустить — API продолжит работать,
но `/api/push/config` вернёт `enabled: false` и клиент отключит переключатель push-уведомлений.

## CI/CD (GitHub Actions)

Пайплайн описан в `.github/workflows/ci.yml`. Проверки запускаются для pull request в `develop` и `main`. После push в `develop` повторный CI приложения пропускается, если успешный PR в `develop` проверил то же Git-дерево на той же базе. При прямом push, изменении базы или отсутствии подтверждения запускается полный набор проверок приложения для push. Сайт и документация по-прежнему проверяются и собираются независимо по затронутым компонентам. Production-релиз приложения запускается по тегу в `.github/workflows/release.yml`. Ветки, PR, коммиты, hotfix и релизы ведутся по [`GIT_FLOW.md`](./GIT_FLOW.md):

- **policy** — проверяет допустимый Git Flow маршрут PR и Conventional Commit формат PR title.
- **check** — `npm ci`, `npm run check` (tsc, vue-tsc, ESLint и Prettier по shared, api и web), `npm run build` (Vite).
- **test** — тесты shared и API против эфемерного PostgreSQL service-контейнера. На PR этот же прогон собирает покрытие G08 и проверяет пороги для изменённого кода. CI запускает API-тесты с параллелизмом 4, каждый интеграционный тест получает копию шаблонной базы. **test-web** — тесты веба (Vitest) отдельным job параллельно с API. `TEST_DATABASE_URL` задаётся прямо в workflow одноразовым значением — секрет для этого **не нужен** (test harness создаёт/удаляет временную БД на каждый тест).
- **voice-join** — проверка входа в голосовую комнату через LiveKit.
- **G05** — строгий LiveKit-профиль.

**Деплой** (`.github/workflows/deploy.yml`, вызывается после публикации образов; на `develop` сборка образов начинается после подтверждения проверенного Git-дерева или успешных `check`, `test`, `test-web`, `voice-join` и G05 на push):

- **images** — для изменений приложения в `develop` и тегов приложения `v*` собирает таргеты `api`, `worker`, `web` и публикует `ghcr.io/dazegg/voiceroom-<target>:<commit-sha>`.
- **deploy-production** — тег `v*` на коммите, влитом в `main` (первый родитель), совпадающий с версией в `package.json`, сразу выкатывается на прод без ручного подтверждения: environment `production` только ограничивает деплой тегами `v*` (https://voiceroom.ru).

Выкатку делает `scripts/cd/remote-deploy.sh` на сервере по SSH: бэкап `.env` и `pg_dump` в `deploy-backups/ci/` (хранятся 5 последних, а дампы и копии `.env` старше 30 дней удаляются и в `deploy-backups/ci/`, и в `deploy-backups/manual/`), `git checkout` коммита, `docker pull` образов, подстановка `VOICEROOM_*_IMAGE` в `.env`, `docker compose config`, `docker compose up -d --wait`. Если любой шаг падает, возвращаются прежние коммит, `.env` и контейнеры. Миграции при этом **не откатываются** — после неудачной миграции восстанавливайте БД из дампа (см. «Миграции» ниже).

Каждый environment хранит свои secrets `SSH_HOST`, `SSH_USER`, `SSH_KEY` и variables `DEPLOY_PATH`, `SSH_FINGERPRINT` (ED25519-отпечаток хоста; без совпадения деплой не стартует). Серверный `.env` (как минимум `DOMAIN`, `POSTGRES_PASSWORD`, `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET`, `LIVEKIT_GATE_SECRET`, `VOICE_ROOM_CURSOR_HMAC_KEYS`) живёт на сервере, а не в Actions.

Прочие рекомендации:

- Для protected branches включите required reviewers; сделайте `policy`, `check` и `test` обязательными проверками для PR в `develop` и `main`.
- Не печатайте secrets в workflow logs; передавайте их через `with:`/`env:` только в нужные jobs/steps.

### Static site and documentation

Caddy serves the public site from `static/site/current` and documentation from
`static/docs/current` in the deploy checkout. The static publication workflow uploads
the built files and atomically points `current` at `releases/<commit>`. Publishing static
files leaves the running containers and database in place. The first application
rollout copies the public site out of the legacy Caddy image when a site release has
yet to be published.

To add the public landing page to a self-hosted instance, build and publish the site files:

```bash
npm ci
npm --workspace @voice-room/site run build
tar -cf - -C apps/site/dist . | bash scripts/cd/publish-static.sh "$PWD" site "$(git rev-parse HEAD)"
```

To serve documentation, add its DNS record and set `DOCS_DOMAIN` in Compose. Supply
the build from `apps/docs/dist` using the same publisher with `docs` as the component.
For the hosted project, the static workflows use the existing `dev` and `production`
environments and their SSH settings. Set the environment's `DOCS_URL` or `SITE_URL` if
the public health check for that dev component should use a custom URL.

Set `APP_DOMAIN` after verifying the new host's TLS, sign-in, voice, admin handoff and
native clients. Existing sessions remain scoped to the old host and users sign in
again at the new host. The public widget loader and frame keep the public site's
origin. Leave both optional hosts unset for an installation using only the public
domain.

## Миграции

```bash
npm --workspace @voice-room/api run db:migrate
npm --workspace @voice-room/api run db:rollback
```

`DATABASE_URL` — основное хранилище комнат, сообщений и аккаунтов. В production миграции применяет одноразовый сервис `migrate` до старта `api`, а API только проверяет, что схема готова. Вне production API сам применяет миграции при старте (`MIGRATE_ON_START`). Для compose можно не задавать `DATABASE_URL` явно: он собирается из `POSTGRES_DB`, `POSTGRES_USER`, `POSTGRES_PASSWORD` и service name `postgres`.

Сервис `migrate` берёт advisory lock репозитория с таймаутом 5 секунд, отмечает прогон как `running`, выполняет миграции по порядку в одной транзакции, проверяет, что lock всё ещё у него, и отмечает `clean`. Ошибка или потеря lock оставляет отметку `dirty`, и production API с ней не стартует. Снять диагностированную отметку можно только явной командой `--clear-dirty`, которой тоже нужен lock. В production запрещены `--no-lock`, автоматические миграции при старте API и down-миграции: откат — это предыдущий образ приложения на расширенной схеме.

## Docker

Production diagnostics must outlive containers. Install and verify the isolated,
bounded host journal profile in [`LOGGING.md`](./LOGGING.md#storage-across-deployments)
before activating the production retention policy. It survives deploys/rollbacks;
the portable JSON-log fallback below does not. First activation also recreates
LiveKit, so schedule it with no active calls. No Docker daemon restart is needed.

Production compose запускает образы `api`, `worker` и `web` из одного Dockerfile:

- `postgres` — PostgreSQL с volume `postgres_data` и healthcheck;
- `migrate` — одноразовый прогон миграций до старта остальных сервисов;
- `api` — Node.js API на `:3000`, хранит аватарки в volume `uploads`, вложения в volume `media` и отвечает только на `/api/*`;
- воркеры `message-delivery`, `notification-delivery`, `media-processing`, `media-maintenance` и `media-reconciliation` — доставка сообщений и уведомлений и обработка медиа;
- `caddy` — frontend static build из `apps/web/dist`, reverse proxy для `/api/*` и отдельный reverse proxy для LiveKit domain. JS-чанки прошлых релизов он держит в volume `web_archive` 30 дней, чтобы вкладки, открытые до выкатки, продолжали работать;
- `livekit` — LiveKit SFU, `livekit-gate` — auth-gate перед ним (см. [`LIVEKIT_GATE.md`](./LIVEKIT_GATE.md)).

Запуск после подготовки `.env`:

```bash
docker compose config --quiet
docker compose up -d --wait
```

Остановить стек:

```bash
docker compose stop
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

### Дополнительные сайты через Caddy

Caddy VoiceRoom единственный слушает 80/443, поэтому чужие сайты на этом же хосте можно отдавать через него без пересборки образа. Положите `<имя>.caddy` в `config/caddy/sites.d` на хосте (в git эти файлы не попадают, деплой их не трогает). Файл подключается на верхнем уровне Caddyfile, это обычные блоки сайтов:

```caddy
app.example.com {
  reverse_proxy my-app:8080
}
```

DNS-запись домена должна указывать на этот хост, а контейнер-апстрим должен делить с Caddy сеть Docker, например подключиться к внешней сети `voiceroom_default`. Ошибка синтаксиса остановит Caddy, поэтому сначала проверьте, потом применяйте:

```bash
docker compose exec caddy caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile
docker compose exec caddy caddy reload --config /etc/caddy/Caddyfile --adapter caddyfile
```

Каталог смонтирован только для чтения; пока в нём нет `*.caddy`, Caddy работает как раньше.

### Дев-стенд на хосте прода

The permanent dev stack uses `/home/daze/VoiceRoom-dev` on the production host,
with Compose project `voiceroom-dev`. It has independent PostgreSQL, uploads,
media, web archives and secrets. Production data is never copied into dev.
The production Caddy terminates HTTPS for the dev site, app, docs, admin and
LiveKit hosts. Their A records point at the same host. The inner Caddy serves
HTTP without publishing host ports.

Use this non-secret part of the dev `.env`, plus fresh independent values for
`POSTGRES_PASSWORD`, `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET`,
`LIVEKIT_GATE_SECRET`, `VOICE_ROOM_CURSOR_HMAC_KEYS` and `POW_SECRET`:

```dotenv
COMPOSE_PROJECT_NAME=voiceroom-dev
COMPOSE_FILE=docker-compose.yml:docker-compose.behind-edge.yml
DOMAIN=dev.voiceroom.ru
APP_DOMAIN=app.dev.voiceroom.ru
DOCS_DOMAIN=docs.dev.voiceroom.ru
ADMIN_DOMAIN=admin.dev.voiceroom.ru
LIVEKIT_DOMAIN=livekit.dev.voiceroom.ru
LIVEKIT_RTC_TCP_PORT=7891
LIVEKIT_RTC_UDP_PORT=7892
LIVEKIT_TURN_UDP_PORT=3488
LIVEKIT_RELAY_PORT_FIRST=30100
LIVEKIT_RELAY_PORT_LAST=30119
LIVEKIT_METRICS_PORT=6790
TURN_ENABLED=false
MAX_ROOMS=10
MAX_ROOM_PEERS=6
MAX_VOICE_PEERS=12
```

Set the three `VOICEROOM_*_IMAGE` values to images from the same verified commit.
The overlay caps each service's memory and CPU and raises its OOM score. It
bind-mounts the checkout's Caddyfile and `behind-edge.headers`, so infrastructure
configuration also works when bootstrapping from existing immutable images.
The dev media ports must be allowed by the host/provider firewall. TURN/TLS on
443 remains production-only; dev uses direct ICE on 7891/TCP and 7892/UDP.

Create the external `voiceroom-edge` Docker network once. Attach only the two
Caddys to it; do not attach dev services to `voiceroom_default`, where service
names would collide. On the production host, keep this ignored file as
`docker-compose.edge.yml`:

```yaml
services:
  caddy:
    networks:
      default:
      edge:
networks:
  edge:
    name: voiceroom-edge
    external: true
```

Preserve production's logging overlay by setting its `.env` to
`COMPOSE_FILE=docker-compose.yml:docker-compose.override.yml:docker-compose.edge.yml`.
For first activation, `docker network connect voiceroom-edge <prod-caddy-id>`
attaches the running Caddy without restarting it. The overlay preserves that
membership when a future deployment recreates it.

Add `config/caddy/sites.d/voiceroom-dev.caddy` in the production checkout:

```caddy
dev.voiceroom.ru, app.dev.voiceroom.ru, docs.dev.voiceroom.ru, admin.dev.voiceroom.ru, livekit.dev.voiceroom.ru {
  reverse_proxy voiceroom-dev-edge:80 {
    header_up X-VoiceRoom-Client-IP {remote_host}
  }
}
```

Validate and reload Caddy using the commands above. The outer edge replaces
the dedicated client-IP header; the inner edge converts it to a single trusted
`X-Forwarded-For` value and removes the dedicated header before proxying.
This preserves per-client rate limits through both proxies, including when a
client supplies spoofed forwarding headers.

The GitHub `dev` environment needs its own `SSH_HOST`, `SSH_USER`, `SSH_KEY`,
`DEPLOY_PATH=/home/daze/VoiceRoom-dev` and the production host's verified
`SSH_FINGERPRINT`. Once the CI change reaches `develop`, successful pushes
publish images and call the existing deployment workflow. The first bootstrap
uses `docker compose up -d --wait`; later rollouts use `remote-deploy.sh`, which
first backs up this stack's database and environment. Its image cleanup keeps
both current and previous releases of every detected stack and only prunes
untagged images globally. Rollouts sharing the same deploy account also hold
`~/.cache/voiceroom/deploy.lock` to serialize pulls and cleanup. Both dev and production deployment workflows must
use this corrected cleanup before either is allowed to clean the shared host.

Check `https://dev.voiceroom.ru/api/healthz`, the admin host, LiveKit gate,
container health, resource limits and production health after activation.
Stop only dev with `cd /home/daze/VoiceRoom-dev && docker compose stop`;
`docker compose down` also removes its containers/network but preserves data
volumes unless explicitly passed `--volumes`.

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

- `voice_sessions` — одна строка на каждый заход в войс: комната, аккаунт или гость, вход и выход, клиент, система и браузер, ключ адреса. Как шёл голос, лежит по минутам в `voice_session_samples`: это оценка сервера по тому, что слышали все участники (хорошо, нестабильно или плохо; админка красит этим полосы звонка). Пороги и их обоснование — в `packages/shared/src/voice-quality.ts`. Город не хранится: его видно только у тех, кто в звонке сейчас;
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
