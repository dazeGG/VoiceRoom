# План релиза 2.5.0 — Messaging Foundation

Статус: рабочий source of truth для релиза 2.5.0. Обновлён 2026-07-16.

Цель релиза — сделать историю общения предсказуемой: добавить cursor
pagination, ответы на сообщения, постоянное membership зарегистрированных
участников и единый desktop-only gate. Релиз одновременно создаёт
воспроизводимый test/release foundation, без которого следующие изменения
messaging и storage не выпускаются.

Документы следующих minor-релизов:

- [2.6.0 — Engagement & Notifications](./RELEASE_2.6.0_PLAN.md);
- [2.7.0 — Media & Moderation](./RELEASE_2.7.0_PLAN.md).

## SemVer и границы release train

| Версия | Новые возможности |
| --- | --- |
| 2.5.0 | test/release foundation, ограниченные модульные границы, desktop-only gate, pagination, replies, membership/roster |
| 2.6.0 | structured room content, `@mentions`, inbox/outbox, unread navigation, reactions |
| 2.7.0 | изображения, media lifecycle и owner moderation center |

`2.5.1`, `2.5.2` и другие patch-версии разрешены только для совместимых
исправлений дефектов, security, performance, observability, документации и
миграций, которые не открывают новую пользовательскую возможность. Функции из
2.6.0 и 2.7.0 нельзя частично включать в 2.5.x.

Для проверки незавершённого релиза используются SemVer prerelease-версии:
`2.5.0-dev.N`, `2.5.0-beta.N` и `2.5.0-rc.N`. Финальная версия `2.5.0`
появляется только на release-коммите в `main` и теге `v2.5.0`.

## Блокирующая предпосылка: закрыть 2.4.0

На дату этого плана:

- последний локальный release tag — `v2.3.4`;
- `package.json`, workspace manifests и `package-lock.json` содержат `2.4.0`;
- текущий `develop` находится на `296a168d725b76063b0e977d6f0116fb4f84c40f`;
- `/api/healthz` не сообщает version или Git SHA;
- фактический SHA production deployment из репозитория установить нельзя.

До начала release branch 2.5.0 необходимо:

1. Установить фактически развёрнутый production SHA.
2. Определить аудированный срез `develop`, который является 2.4.0.
3. Пройти release gates 2.4.0, слить release branch в `main`, создать
   `v2.4.0` и вернуть изменения в `develop`.
4. Не ставить `v2.4.0` на текущий `develop` без проверки состава.
5. Добавить version и Git SHA в health/metrics, чтобы следующие релизы были
   однозначно идентифицируемы.

Пока `v2.4.0` не существует как проверенный production baseline, финальный
`v2.5.0` выпускать нельзя.

## Подтверждённый scope

| № | Направление | Результат |
| --- | --- | --- |
| 1 | Test and release foundation | CI самостоятельно проверяет clean install, PostgreSQL, coverage и Chromium E2E |
| 2 | Ограниченные модульные границы | новый messaging/membership код не увеличивает связанность `server.js` |
| 3 | Desktop-only app-shell gate | мобильные route children и фоновые подсистемы не запускаются |
| 4 | Cursor pagination | room chat и DM открываются с последних сообщений и безопасно грузят историю |
| 5 | Replies | ответ, preview, tombstone и переход к оригиналу работают в room chat и DM |
| 6 | Membership and roster | успешный account admission создаёт member; presence и membership разделены |
| 7 | Ban correctness baseline | expired/duplicate bans не ломают admission и quota до появления UI 2.7 |

## Не входит в 2.5.0

- `@mentions`, notification inbox/outbox и reactions — [2.6.0](./RELEASE_2.6.0_PLAN.md);
- изображения и полный moderation center — [2.7.0](./RELEASE_2.7.0_PLAN.md);
- private rooms, роли moderator/co-host, поиск сообщений, pins и threads;
- физическое разделение на микросервисы или микрофронтенды;
- мобильная версия, PWA, GIF, slugs и управляемые коды — [BACKLOG.md](./BACKLOG.md).

## Фактический baseline репозитория

- CI слушает только `main` и выполняет check/build/test без coverage и E2E:
  `.github/workflows/ci.yml:3-56`.
- Playwright ожидает вручную поднятый full stack и запускает только Chromium:
  `apps/web/playwright.config.ts:3-19`.
- E2E helper использует устаревшие `#loginInput/#passwordInput`, тогда как
  актуальная форма использует `#authLoginInput/#authPasswordInput`:
  `apps/web/e2e/helpers.ts:14-30`,
  `apps/web/src/lib/features/auth/AuthDialog.svelte:126-175`.
- API test command намеренно требует `TEST_DATABASE_URL`; CI предоставляет
  PostgreSQL, но локальный `npm test` без этой переменной не является полным
  прогоном: `apps/api/package.json:9-13`, `.github/workflows/ci.yml:31-56`.
- Room history уже выбирает последние записи через `DESC` и возвращает их в
  `ASC`; DM history выбирает первые 100 записей через `ASC LIMIT`:
  `apps/api/src/lib/room-store.js:669-701`,
  `apps/api/src/lib/friend-store.js:351-361`.
- Room и DM handlers не принимают `before/around/limit`; DM GET одновременно
  помечает thread прочитанным. Отдельные room/DM read POST уже существуют, но
  high-water message cursor не принимают:
  `apps/api/src/server.js:1561-1572`, `apps/api/src/server.js:1991-2023`,
  `apps/api/src/server.js:2944`, `apps/api/src/server.js:2984`.
- `room_memberships` уже существует и имеет unique
  `(room_id, user_id)`, но runtime создаёт membership только владельцу
  постоянной комнаты: `apps/api/src/migrations/20260615140000_create_room_memberships_and_bookmarks.js:6-38`,
  `apps/api/src/lib/room-store.js:246-253`.
- LiveKit token и WebSocket voice join не создают membership:
  `apps/api/src/server.js:762-828`,
  `apps/api/src/realtime/room-runtime.js:277-380`.
- LiveKit bearer token сейчас действует 21 600 секунд; удаление participant
  отключает текущую connection, но не отзывает уже выданный JWT:
  `apps/api/src/server.js:59`, `apps/api/src/server.js:807`,
  `apps/api/src/server.js:1661`.
- Root layout отсутствует; service worker самостоятельно показывает push:
  `apps/web/src/routes`, `apps/web/src/service-worker.ts:15-32`.
- Push subscription уже сохраняет bounded `userAgent` в metadata, но не
  нормализованный platform class: `apps/api/src/server.js:2221-2232`.
- API автоматически применяет migrations до открытия listener, а production
  собирается непосредственно на сервере из `main`:
  `apps/api/src/server.js:3099-3103`, `.github/workflows/ci.yml:58-83`.
- Web build получает `DOMAIN`/LiveKit values через build args, поэтому один
  текущий image нельзя продвинуть между environments без runtime config:
  `Dockerfile:9-16`, `docker-compose.yml:80-86`.

## 1. Test and release foundation

### CI-контуры

PR и push в `develop` и `main` запускают:

1. `npm ci`, `npm run check` и `npm run build`;
2. unit и integration tests с отдельной временной PostgreSQL database;
3. coverage job;
4. Chromium Playwright smoke с автоматически поднятыми PostgreSQL, API, Web и
   readiness probes;
5. сборку immutable API/Web images, помеченных commit SHA.

Merge в `develop` и `main` блокируется при падении любого обязательного job.
Deploy запускается только для `main` после всех gates. Nightly дополнительно
проверяет Firefox/WebKit, reconnect/failure scenarios, accessibility и
стабильные visual snapshots.

CI сохраняет Playwright trace, screenshot и video для упавшего сценария.
Retry используется только для диагностики: прошедший после retry тест остаётся
flaky-дефектом и не считается зелёным gate.

До объявления images immutable environment-specific `DOMAIN`, LiveKit URL и
safe public config переносятся из Docker build args в versioned runtime config.
CI один раз собирает и публикует images в registry; staging и production делают
pull по одному и тому же digest, проверяют digest после запуска и не выполняют
`docker compose build` на deploy host.

### Покрытие

- сначала фиксируется измеренный baseline всего репозитория;
- общий coverage не может снижаться;
- для нового/изменённого бизнес-кода PR требует минимум 90% line coverage и
  85% branch coverage;
- auth/session/CSRF, permissions, ban enforcement, message edit/delete,
  cursor validation, reply target validation и idempotency имеют 100% branch
  coverage;
- source-regex tests не считаются заменой component tests с реальным Svelte
  DOM, keyboard/focus и accessibility assertions;
- framework glue исключается только явным комментарием в coverage config.

### Обязательный smoke

Chromium smoke в двух browser contexts покрывает:

- register/login/logout;
- создание и открытие постоянной комнаты;
- join account и guest;
- send/edit/delete room message и DM;
- realtime delivery, reconnect и duplicate event;
- pagination prepend;
- reply и переход к оригиналу;
- roster, leave-call и leave-room;
- desktop/mobile gate на всех entry routes.

### Критерии готовности

- clean CI runner не требует ручного запуска stack;
- все известные устаревшие selectors исправлены;
- обязательный Chromium smoke проходит два раза подряд без retry;
- PR pipeline укладывается в 10 минут; более тяжёлая browser/media matrix
  остаётся nightly/RC;
- branch protection для `develop` и `main` подтверждён screenshot/export
  настроек репозитория;
- staging и production report содержат одинаковые image digests, version и SHA;
- полный test report публикуется как artifact; число тестов не записывается в
  план как постоянная константа.

### Capability negotiation и reverse version skew

2.5.0 вводит два независимых стабильных endpoint:

```http
GET /runtime-config.json
GET /api/capabilities
```

```json
{
  "contractVersion": 1,
  "publicOrigin": "https://voice.example",
  "livekitUrl": "wss://livekit.voice.example"
}
```

```json
{
  "contractVersion": 1,
  "apiVersion": "2.5.0",
  "features": {
    "historyCursor": true,
    "readCursor": true,
    "replies": true,
    "membership": true,
    "engagement": false,
    "reactions": false,
    "mediaRead": false,
    "mediaUploads": false,
    "moderationCenter": false
  }
}
```

- неизвестный feature key трактуется как `false`;
- `404`, timeout или невалидный payload трактуются новым client как legacy
  2.4 profile: используются старые history/send/read paths, а новый UI скрыт;
- capability cache имеет короткий TTL и сбрасывается после reconnect/deploy;
- `/runtime-config.json` генерируется Web container/edge из environment при
  startup, не зависит от API binary и сохраняется при rollback API; поэтому Web
  image не пересобирается между staging/production;
- endpoints содержат только safe public runtime values/capabilities; secrets и
  environment internals в них не входят;
- compatibility smoke выполняется в обе стороны: `2.4 web ↔ 2.5 API` и
  `2.5 web ↔ 2.4 API`.

## 2. Архитектурная граница релиза

### Решение

Backend остаётся модульным монолитом, frontend — одним SvelteKit-приложением.
В 2.5.0 не выполняется full-repo rewrite и не вводятся Kafka, Redis,
RabbitMQ, отдельный media service или microfrontend runtime.

Рефакторинг ограничен seams, которые нужны pagination, replies, membership и
app-shell gate:

- composition/bootstrap;
- messaging contracts and reconciliation;
- rooms/membership admission;
- realtime adapters;
- frontend app shell и messaging models.

Новый domain code не добавляется непосредственно в `server.js`. Legacy routes
могут оставаться adapters, которые вызывают application services.

### Правила

- один app-scoped PostgreSQL pool передаётся repositories явно;
- у каждой таблицы один write-owner;
- multi-domain use case координируется application service/Unit of Work,
  который передаёт один transaction client владельцам таблиц;
- repository не создаёт скрытую cross-domain транзакцию;
- HTTP и realtime payloads описываются в `packages/shared`;
- внешние изменения additive; старый клиент игнорирует новые поля;
- architecture tests запрещают новые module globals, cycles и deep imports
  для затронутых модулей;
- перенос существующего кода и изменение поведения делаются отдельными PR.

### Критерии готовности

- новые pagination/reply/membership handlers вызывают application services, а
  не размножают SQL и state logic в route layer;
- transaction ownership видим в сигнатурах и тестируется rollback cases;
- существующие auth/social/voice модули не переписываются без необходимости;
- `server.js` может оставаться крупным: его полное уменьшение не является
  release gate;
- Web и API продолжают собираться и запускаться как два текущих deployable
  приложения.

### Наследуемый architecture contract для 2.6/2.7

Эта граница действует для всего release train, а не только для кода 2.5.0:

- notification/content/reaction code 2.6 и attachment/media/moderation code 2.7
  также добавляются через application services, repositories и shared
  contracts, без нового domain SQL/state logic в route handlers;
- architecture tests применяются к каждому затронутому модулю 2.6/2.7 и
  остаются required CI gate;
- full decomposition всего legacy `server.js` и frontend вне затронутых seams
  не является скрытым gate этого train; это отдельное roadmap-направление в
  [BACKLOG.md](./BACKLOG.md), которое планируется после измерения оставшихся
  hotspots.

## 3. Desktop-only app-shell gate

### Контракт

Общий root layout классифицирует платформу до render дочернего route. При
blocked результате `/`, `/login`, `/register` и `/r/:roomId` показывают одну
полноэкранную заглушку:

> VoiceRoom пока работает только на компьютере. Откройте эту ссылку на
> компьютере, чтобы войти в комнату.

При blocked результате:

- route child не монтируется даже на один frame;
- не запускаются session/auth fetch, room preview, WebSocket, LiveKit, media
  или push registration;
- URL прямой ссылки остаётся неизменным;
- уже зарегистрированный service worker не показывает push на
  классифицированном mobile browser.

Root layout сам по себе не может гарантировать последнее условие, поэтому
desktop gate распространяется на push pipeline:

- общий platform classifier используется page и service worker до
  `showNotification`;
- push subscription сохраняет нормализованный `platformClass`; dispatcher не
  отправляет Web Push в `mobile`, а существующий `metadata.userAgent`
  переклассифицируется при rollout;
- blocked page не выполняет cleanup request: correctness обеспечивают
  server-side dispatch filter и проверка внутри service worker;
- E2E отправляет push в уже зарегистрированный mobile SW без visible clients и
  проверяет, что notification не появилась.

`window.voiceRoomRuntime?.isDesktop` всегда разрешает приложение. Основной
mobile signal — `navigator.userAgentData.mobile`, fallback централизованно
покрывает Android, iPhone/iPod и iPadOS с desktop user agent. Viewport width и
coarse pointer не используются как самостоятельный запрет. Неопределённый
результат работает fail-open: это support boundary, а не security control.

### Критерии готовности

- iPhone, Android и iPad блокируются в portrait и landscape;
- Windows, macOS и Linux открываются при ширине окна менее 560 px;
- VoiceRoomDesktop всегда проходит gate;
- network instrumentation доказывает отсутствие API/WS/LiveKit/media/push-init
  вызовов в blocked mode;
- отдельный E2E начинает с уже зарегистрированным SW/subscription и проверяет
  подавление push;
- экран работает от 320 px, без horizontal scroll, с корректным heading,
  focus и screen-reader name;
- ручная RC-матрица включает iOS Safari, Android Chrome, iPadOS,
  desktop Chrome/Firefox/Safari и VoiceRoomDesktop.

## 4. Cursor pagination

### Совместимый API contract

```http
GET /api/rooms/:roomId/chat?before=<cursor>&limit=50
GET /api/rooms/:roomId/chat?around=<messageId>&limit=50
GET /api/dm/:userId?before=<cursor>&limit=50
GET /api/dm/:userId?around=<messageId>&limit=50
POST /api/rooms/:roomId/read
POST /api/dm/:userId/read
```

Оба read POST принимают один scope-bound body:

```json
{ "cursor": "<opaque cursor for the last rendered message>" }
```

Query parameters и page envelope добавляются в 2.5.0. Оба `POST .../read` уже
существуют; в 2.5 расширяется их payload, а новые GET paths перестают иметь
implicit read side effect.

Room response сохраняет `ok` и `roomId`, DM response — `ok`, `peer` и
`muted`. В оба envelope аддитивно добавляется:

```ts
page: {
  hasMoreBefore: boolean;
  hasMoreAfter: boolean;
  previousCursor: string | null;
  nextCursor: string | null;
}
```

- новый клиент загружает последние 50 сообщений;
- legacy request без `before`, `around` и `limit` временно сохраняет limit 100
  и текущую read semantics;
- новый client path отправляет явный `POST .../read` после отображения latest
  segment с opaque high-water cursor, содержащим `(createdAt, id)` последнего
  реально отрисованного сообщения;
- older/around requests никогда не отправляют read receipt;
- `before` и `around` взаимоисключающие; ошибка даёт `400`;
- opaque versioned cursor содержит scope и `(createdAt, id)`;
- повреждённый, cross-room или cross-DM cursor даёт `400`;
- cursor не заменяет auth/ban/friendship checks.

Room read state хранит monotonic tuple `(last_read_created_at,
last_read_message_id)`, а не только wall-clock timestamp. DM read update помечает
только входящие rows `<=` переданного tuple. Повторный или более старый cursor
не откатывает state; message, пришедший после high-water mark, остаётся unread.

SQL сортирует по `created_at DESC, id DESC`, получает `limit + 1`, затем
возвращает страницу хронологически. Room и DM сохраняют отдельные repositories
и permissions; общий код ограничен cursor codec, page contract и чистой
reconciliation.

### Клиент

- initial load прокручивается вниз;
- prepend сохраняет scroll anchor с отклонением не более 2 px;
- одновременно выполняется не более одного older request;
- stale request после смены room/DM отменяется или игнорируется;
- HTTP pages и realtime объединяются по `message.id`;
- edit/delete применяются к latest, older и around segments;
- при просмотре around segment новые сообщения копятся в latest segment и
  доступны через «К новым сообщениям».

### Performance gate

- room dataset соответствует production cap: 500 активных сообщений;
- DM query-plan проверяется на conversation из 100 000 сообщений и смешанном
  наборе других диалогов;
- на RC hardware warm p95 history/around endpoint не превышает 300 ms, p99 —
  750 ms при `limit=50`;
- индексы добавляются только после `EXPLAIN (ANALYZE, BUFFERS)` текущих
  двунаправленных DM indexes; новый `conversation_id` не вводится без
  доказанной необходимости.

### Критерии готовности

- каждый message появляется ровно один раз при последовательной загрузке;
- одинаковый `created_at` не создаёт пропусков;
- realtime send/edit/delete во время pagination/reconnect сходится к
  server-authoritative состоянию;
- deleted/expired messages не возвращаются;
- older/around DM fetch не меняет unread;
- N-1 web client продолжает разбирать envelopes;
- unit, PostgreSQL integration, API contract, component и two-context E2E
  покрывают обе модели чата.

## 5. Replies

Reply адресует одно сообщение и не создаёт thread.

### Поведение

- ответить можно на обычное сообщение в той же room или DM conversation;
- reply на reply разрешён, но preview не строит рекурсивное дерево;
- room invitation/system card не является reply target;
- composer показывает автора, до двух строк текста и cancel action;
- `Escape` отменяет reply, `Enter` отправляет, `Shift+Enter` добавляет строку;
- после ошибки draft и выбранный target сохраняются;
- клик по preview открывает loaded target или использует `around`;
- удалённый/expired target показывает terminal tombstone без исходного текста.

### Данные и совместимость

В `room_messages` и `direct_messages` аддитивно добавляется nullable
`reply_to_message_id` и индекс для поиска зависимых preview. Hard FK не
используется: физический purge оригинала не должен удалять replies.

Существующие POST принимают optional `replyToMessageId`. Existing HTTP и
realtime message payloads получают optional `replyTo`:

```ts
type ReplyPreview =
  | { status: 'available'; messageId: string; author: PublicIdentity; excerpt: string; createdAt: number; editedAt: number | null }
  | { status: 'unavailable'; messageId: string };
```

- target и reply создаются в одной transaction;
- target обязан принадлежать той же room/conversation и быть доступным;
- недоступный target возвращает `409 reply_target_unavailable`, не раскрывая
  существование чужого message;
- `reply_to_message_id` после отправки неизменяем;
- old clients игнорируют `replyTo`; old API после rollback игнорирует
  nullable columns.

Новый client обязан передавать `Idempotency-Key` при room/DM send. Ключ
сохраняется как `client_mutation_id`:

- DM unique key: `(sender_id, client_mutation_id)`;
- room account key: `(room_id, author_user_id, client_mutation_id)`;
- room guest key: `(room_id, peer_id, client_mutation_id)`;
- тот же key и тот же normalized request возвращают исходное message;
- тот же key с другим body/reply target возвращает `409 idempotency_conflict`;
- legacy client без key остаётся совместимым, но duplicate guarantee к нему не
  применяется.

Edit оригинала обновляет preview через normal edited event. Delete/expiry
переводит preview в tombstone; запоздавший edit не воскрешает его.

### Критерии готовности

- account и guest могут отвечать в room; DM reply работает в обе стороны;
- cross-room/cross-DM target запрещён;
- race `delete ↔ reply`, stale snapshot, realtime echo и reconnect не создают
  дубликат или утечку; duplicate POST проверяется с тем же `Idempotency-Key`;
- переход работает для loaded, unloaded, deleted и expired target;
- scroll, keyboard, focus, screen reader и touch targets проверены;
- room и DM E2E выполняются в двух browser contexts;
- notification на reply не входит в 2.5.0 и появляется только в 2.6.0.

## 6. Membership and roster

### Модель

- membership — строка зарегистрированного пользователя в PostgreSQL;
- presence — временное voice connection;
- bookmark — личная закладка, не membership;
- Ring — одноразовый вызов, не membership;
- guest существует только в presence.

В 2.5.0 наличие строки `room_memberships` означает активное membership.
Отдельные `active/left` состояния не добавляются. Повторный вход после
leave-room заново создаёт строку.

### Admission

Единый `ensureMembership` application service вызывается всеми account
admission paths до выдачи успешного результата:

1. проверить room и ban;
2. в transaction выполнить idempotent upsert `(room_id, user_id)`;
3. только после commit выдавать LiveKit token или регистрировать active voice
   peer;
4. при ошибке записи admission завершается ошибкой и voice peer не появляется.

Guest path service не вызывает. Reconnect, повторная выдача token и несколько
вкладок используют тот же unique key.

### LiveKit credential revocation

Membership commit до token issuance недостаточен: старый bearer JWT можно
использовать повторно. Поэтому 2.5 заменяет шестичасовой reusable credential на
короткоживущий admission flow:

1. API создаёт server-side credential с random `jti`, room, subject,
   `access_generation`, expiry не более 90 секунд и initial state `issued`.
2. JWT содержит только opaque `jti`/generation и initial grants без
   publish/subscribe/data permissions.
3. `participant_joined` является post-connect webhook, поэтому transport до
   проверки явно имеет state `quarantined`: он не регистрируется в VoiceRoom
   presence/roster/runtime и не считается admitted peer.
4. Admission controller атомарно переводит credential в `consumed`, повторно
   проверяет room/ban и membership для account subject, затем выдаёт normal
   participant permissions и только после этого публикует presence.
5. Invalid, expired, consumed повторно или revoked credential немедленно
   удаляет quarantined participant без media/data permissions.
6. Leave-room/ban сначала увеличивает subject generation и отзывает issued
   credentials, затем disconnect-ит active identities. Normal reconnect
   получает новый credential через API.

Raw IP не попадает в JWT/logs. Для guest server-side credential хранит только
необходимую access scope; IP-ban отзывает matching issued credentials.

### Members API и UI

```http
GET /api/rooms/:roomId/members?before=<cursor>&limit=50&q=<query>
DELETE /api/rooms/:roomId/membership
```

- limit по умолчанию 50, максимум 100;
- full directory доступна только owner/member;
- non-member и guest получают только текущий public voice roster;
- members группируются на «В голосе» и «Остальные участники»;
- несколько connections одного account объединяются в одну строку;
- pagination/search выполняются на сервере; count не требует загрузки всех
  rows;
- snapshot/events используют monotonic `presenceRevision`; gap вызывает
  resync;
- IP, device/network identifiers и internal session IDs не возвращаются.

Одна правая область имеет state `'closed' | 'chat' | 'participants'`.
Существующий `ParticipantContextMenu` переиспользуется.

### Leave и связанные semantics

- «Покинуть звонок» отключает voice и сохраняет membership;
- «Выйти из комнаты» сначала отключает все account connections, затем удаляет
  membership; если delete не прошёл, пользователь остаётся member и может
  повторить операцию;
- owner не может оставить постоянную комнату без владельца: transfer
  ownership не входит в релиз, поэтому owner удаляет room вместо leave;
- kick отключает конкретное connection и не удаляет membership;
- ban имеет приоритет, но не удаляет membership;
- создание membership не делает room private и не меняет текущий access model;
- membership само по себе не добавляет room на home: owner/bookmark
  relationship остаётся отдельным;
- существующие owner rows уже backfilled; bookmarks и исторические visitors
  автоматически в members не преобразуются;
- membership temporary room удаляется каскадно вместе с room.

### Критерии готовности

- первый account admission создаёт ровно одну строку;
- admitted account peer/presence не существует без membership; краткий
  LiveKit `quarantined` transport до post-connect webhook не имеет
  publish/subscribe/data permissions и не попадает в VoiceRoom roster;
- reconnect/multi-tab/repeated token не создают duplicates;
- `leave/ban → reuse old JWT` не возвращает publish/subscribe access; unused и
  already-consumed token cases покрыты integration/E2E;
- guest не появляется среди offline members;
- leave-call сохраняет row; leave-room удаляет row и все connections;
- owner не может создать orphaned static room;
- roster pagination/search, privacy и visibility/bookmark semantics покрыты
  API, component и E2E;
- reconnect/resync приводит roster и presence к одному revision.

## 7. Ban correctness baseline

Полный UI временных банов относится к 2.7.0. В 2.5.0 исправляется только
server-side invariant, необходимый для admission и будущего rollout:

- active ban везде определяется одним predicate:
  `expires_at IS NULL OR expires_at > current_timestamp`;
- status, preview, room chat, WS join и LiveKit token используют этот predicate;
- room ban cap считает только active rows;
- повторный ban одного account/IP идемпотентен и не расходует cap;
- expired rows удаляются bounded cleanup, но access correctness от cleanup не
  зависит;
- account ban и IP ban остаются взаимоисключающими.

Критерии: expired row не блокирует ни один admission path; 100 expired rows не
создают `room_ban_limit`; duplicate request не создаёт вторую active row;
PostgreSQL tests покрывают expiry boundary и races.

## Миграции, rollout и rollback

### Migration inventory

1. Добавить nullable reply columns и необходимые indexes.
2. Добавить `client_mutation_id` и partial unique indexes для idempotent send.
3. Расширить room read state high-water tuple и DM read query.
4. Добавить bounded admission-credential/access-generation storage для
   LiveKit token revocation.
5. Добавлять pagination index только по результату production-like EXPLAIN.
6. Использовать существующую membership table; отдельная membership lifecycle
   schema не требуется.
7. При необходимости добавить ban indexes/cleanup support без удаления
   существующих columns.

Все migrations — expand-only. Ни одна migration 2.5.0 не удаляет и не
переименовывает column/table, используемую 2.4.

### Проверка

- fresh database проходит полный migrate;
- копия 2.4 schema/data обновляется до 2.5;
- время и locks каждой migration измерены на production-like dataset;
- transactional migrations задают `lock_timeout = '5s'` и измеренный
  `statement_timeout`; timeout abort-ит deploy до запуска новой API;
- `CREATE INDEX CONCURRENTLY` выполняется отдельным idempotent predeploy step с
  `singleTransaction=false`, затем index validity проверяется явно;
- старая 2.4 API binary запускается поверх расширенной schema;
- open 2.4 web tab работает с 2.5 API: неизвестные поля игнорируются, legacy
  history request и send/edit/delete сохраняются;
- open 2.5 web tab после rollback на 2.4 API получает legacy capability profile,
  отключает новый UI и проходит history/send/read/voice smoke.

### Rollout

1. Создать backup и проверить restore metadata.
2. Опубликовать images в registry и развернуть зафиксированные digests в
   staging без rebuild.
3. Выполнить migration rehearsal и smoke.
4. Продвинуть те же digests в production через pull и проверить их после
   запуска.
5. Выполнить post-deploy smoke и наблюдать метрики минимум 30 минут.

Обычный rollback — возврат предыдущего application image поверх additive
schema. `npm --workspace @voice-room/api run db:rollback`, откатывающий одну
migration, не является production release rollback. Destructive down или
restore БД выполняются только при подтверждённой порче данных.

### Воспроизводимый performance profile

RC report фиксирует image digest, hardware, PostgreSQL version/config, dataset,
request mix, concurrency и random seed. Для latency budget используются warmup
не менее 2 минут и не менее 10 000 samples на endpoint либо 15 минут steady
load; одинаковый profile повторяется до и после изменения.

## Observability и go/no-go

До RC экспортируются:

- `voice_room_build_info{version,sha}`;
- histogram latency и counters ошибок для latest/older/around history;
- invalid/cross-scope cursor counter;
- reconciliation duplicate/resync counters;
- membership upsert/delete/admission failure counters;
- active/expired ban enforcement outcomes без user/IP labels;
- migration and maintenance duration.

Rollback либо остановка rollout выполняются, если после deploy:

- HTTP 5xx превышает 2% при не менее 100 requests за пять минут либо достигает
  10 ошибок за окно при меньшем traffic;
- p95 history endpoint превышает 1 s при не менее 1 000 samples за десять
  минут либо не менее 10 requests за окно превышают 1 s;
- возникает хотя бы одно доказанное нарушение membership invariant;
- появляются message loss, cross-context reply leak или необратимые duplicates;
- migration не укладывается в заранее измеренное окно или держит
  блокирующий lock дольше 5 s.

## Порядок реализации

1. Закрыть и затегировать 2.4.0.
2. Исправить CI/E2E bootstrap и сделать gates обязательными.
3. Добавить capabilities/runtime config, build/version/SHA и воспроизводимый
   artifact promotion.
4. Зафиксировать ограниченные architecture seams и shared contracts.
5. Реализовать desktop-only root gate, включая existing SW scenario.
6. Реализовать pagination и cursor-based explicit read path.
7. Реализовать replies, idempotent send и around navigation.
8. Исправить active-ban invariant до включения нового membership admission.
9. Реализовать membership admission/roster/leave и revocable LiveKit
   credentials.
10. Пройти migration rehearsal, compatibility matrix, RC и production smoke.

## Definition of Done 2.5.0

Релиз готов только когда:

- существует проверенный tag `v2.4.0`;
- все scope-пункты выше завершены; features 2.6/2.7 не нужны для готовности;
- check, build, unit, integration, coverage и Chromium E2E зелёные;
- nightly browser/a11y и ручная desktop/media matrix зелёные;
- fresh install, upgrade 2.4 → 2.5 и application rollback проверены;
- обе N-1 пары `2.4 web ↔ 2.5 API` и `2.5 web ↔ 2.4 API`, open-tab и минимальная
  совместимая версия VoiceRoomDesktop записаны в release checklist и проходят
  smoke;
- reuse LiveKit JWT после leave/ban не возвращает media permissions;
- dashboards и rollback alerts активны;
- `CHANGELOG.md`, migration/env/backup/rollback notes и known limitations
  подготовлены;
- все workspace versions и lockfile равны `2.5.0`;
- release branch слит в `main` и обратно в `develop`, финальный commit отмечен
  `v2.5.0`;
- нет открытых P0/P1 дефектов и нет принятого риска потери/утечки данных.
