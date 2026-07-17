# План релиза 2.6.0 — Engagement & Notifications

Статус: рабочий source of truth для релиза 2.6.0. Обновлён 2026-07-16.

> Этот документ задаёт target state и release gates, а не подтверждает их
> текущую реализацию. Фактический branch/commit/release процесс определяется
> [`GIT_FLOW.md`](./GIT_FLOW.md); каждый gate считается незавершённым без свежего
> CI, configuration или runtime evidence.

Цель релиза — добавить адресное взаимодействие поверх стабильных contracts
2.5.0: `@mentions`, уведомления на replies, durable inbox/outbox, навигацию по
непрочитанному и emoji reactions. Все возможности являются additive и не
ломают 2.5 clients.

Предыдущий релиз: [2.5.0 — Messaging Foundation](./RELEASE_2.5.0_PLAN.md).
Следующий релиз: [2.7.0 — Media & Moderation](./RELEASE_2.7.0_PLAN.md).

## SemVer

`2.6.0` — minor, потому что открывает новые пользовательские функции и новые
HTTP/realtime capabilities. `2.6.x` после релиза содержит только совместимые
исправления. Незавершённая работа публикуется как `2.6.0-dev.N`,
`2.6.0-beta.N` и `2.6.0-rc.N`, а не как feature в `2.5.x`.

## Блокирующие prerequisites

- финальный `v2.5.0` существует в `main`;
- pagination, `around`, explicit read, replies и membership contracts 2.5
  прошли production observation;
- N-1 client compatibility и shared message contract подтверждены;
- `/api/capabilities` contract version 1 доступен, а 2.6 client корректно
  работает с legacy/2.5 feature profile;
- expired ban уже не блокирует membership/mention eligibility;
- CI, PostgreSQL integration, coverage и Chromium E2E остаются required gates;
- architecture contract 2.5 применяется ко всем затронутым content,
  notification и reaction modules; architecture tests остаются required gate;
- build version/SHA и release-specific metrics доступны в production.

Если любой prerequisite не выполнен, соответствующая часть не копируется в
2.6.0 как workaround: релиз остаётся заблокирован до исправления 2.5 baseline.

## Подтверждённый scope

| № | Направление | Результат |
| --- | --- | --- |
| 1 | Structured room content | server хранит проверенные text/mention segments и сохраняет plain-text fallback |
| 2 | `@mentions` | member выбирается из room directory; arbitrary pasted text не создаёт уведомление |
| 3 | Replies notification | reply зарегистрированному автору создаёт одну адресную inbox record |
| 4 | Durable inbox/outbox | message и адресное событие commit/rollback вместе; push переживает restart |
| 5 | Notification policy | DND, privacy и room level управляют interrupts, но не удаляют inbox |
| 6 | Unread navigation | divider и переход к первому unread используют pagination/around 2.5 |
| 7 | Emoji reactions | idempotent server-authoritative reactions работают в room chat и DM |

## Не входит в 2.6.0

- mentions в DM, `@everyone`, `@here`, роли и global user search;
- notifications на reactions;
- изображения и media worker — [2.7.0](./RELEASE_2.7.0_PLAN.md);
- полный moderation center и UI временных банов — 2.7.0;
- private rooms, moderator/co-host roles, message search, pins и threads;
- GIF, mobile/PWA, slugs и управляемые invite codes — [BACKLOG.md](./BACKLOG.md).

## Фактический baseline до реализации 2.5/2.6

На дату составления плана:

- `room_messages` хранит обязательный `text`, `direct_messages` — обязательный
  `body`; structured `content` отсутствует:
  `apps/api/src/migrations/20260614144500_create_rooms_and_room_messages.js:17-32`,
  `apps/api/src/migrations/20260627120000_create_friends_and_direct_messages.js:77-95`.
- `room_message_mentions`, `user_notifications`, `notification_outbox` и
  reaction tables отсутствуют.
- notification preferences, room/DM mute, DND и push subscriptions уже
  существуют: `apps/api/src/lib/notification-store.js`,
  `apps/api/src/migrations/20260710140000_create_notification_preferences.js`,
  `apps/api/src/migrations/20260711130000_create_push_subscriptions.js`,
  `apps/api/src/migrations/20260711140000_add_user_dnd.js`.
- DM realtime/push выполняются после записи message отдельными операциями;
  push отправляется напрямую и не имеет durable queue:
  `apps/api/src/server.js:201-260`, `apps/api/src/server.js:2059-2064`.
- server-side emoji validator и renderer dependency в manifests отсутствуют.

Эти факты описывают исходную реализацию, а не обещание сохранить её структуру.

## 1. Structured message content и transaction ownership

### Contract

Room client отправляет:

```ts
type RoomMessageContentV1 = {
  version: 1;
  segments: Array<
    | { type: 'text'; text: string }
    | { type: 'mention'; userId: string }
  >;
};
```

Сервер:

- проверяет schema, общий размер и число segments;
- валидирует каждый `userId` через membership/ban rules;
- получает canonical display identity из PostgreSQL;
- строит plain `text` fallback;
- возвращает canonical `content` и отдельный массив `mentions`;
- никогда не доверяет client label и не принимает raw HTML.

Renderer отображает только известные segment types. Links определяются внутри
text renderer; URL не хранится как доверенный HTML.

### Данные и N-1 fallback

- в `room_messages` добавляется nullable `content JSONB`;
- существующий `text NOT NULL` сохраняется на всей линии 2.x;
- новый server dual-write-ит canonical `content` и plain `text`;
- старые rows с `content IS NULL` читаются как один text segment;
- backfill выполняется bounded batches по 1000 rows и может безопасно
  продолжаться после restart;
- unknown future `content.version` не рендерится частично: используется
  plain-text fallback.

DM structured content в 2.6.0 не требуется: reactions и replies не меняют
существующий `body`.

### Unit of Work

Use case создания/редактирования room message координирует application service:

1. messaging repository создаёт/обновляет message;
2. mention repository синхронизирует recipients;
3. notification repository создаёт/retract-ит inbox rows;
4. outbox repository создаёт delivery jobs;
5. все repositories получают один PostgreSQL transaction client.

Это не нарушает one-write-owner: application service владеет transaction, а
каждый repository — своими tables. In-process event не используется для
операции, которая должна commit/rollback вместе с message.

### Критерии готовности

- invalid JSON/version/segment/size даёт `400`;
- rollback любого repository не оставляет частичный message/mention/inbox/job;
- 2.5 client читает plain `text` и игнорирует `content`;
- 2.5 server после application rollback читает rows, потому что `text`
  продолжает dual-write;
- backfill не держит blocking lock дольше 5 s и имеет progress metric.

## 2. `@mentions`

### Функциональный контракт

- mentions работают только в room chat;
- создать mention может зарегистрированный member;
- target — зарегистрированный active member той же room, online или offline;
- guest, self, removed member и active-banned user не являются candidates;
- максимум пять уникальных recipients в одном message;
- повтор target создаёт одну relation/notification;
- pasted или вручную введённый `@Имя` остаётся обычным text;
- настоящая relation появляется только после выбора server candidate.

Autocomplete использует paginated members search из 2.5, показывает 8
candidates и поддерживает ArrowUp/Down, Enter/Tab, Escape, IME, touch и screen
reader. Изменение mention label вручную превращает segment в text.

### Данные

`room_message_mentions` содержит:

- `message_id`;
- `mentioned_user_id`;
- `created_at`;
- unique `(message_id, mentioned_user_id)`;
- indexes по recipient и chronological cursor;
- cascade при физическом удалении message.

Eligibility проверяется в той же transaction, что message. Client-supplied
identity не используется.

### Edit/delete/TTL

- edit с неизменным recipient не отправляет повторное событие;
- новый recipient получает inbox/outbox;
- удалённый recipient теряет reason `mention`; row retract-ится только если
  других reasons не осталось;
- delete/TTL retract-ит все notifications;
- remove/re-add после retract обновляет ту же logical row, создаёт новую
  revision и новый delivery key, но не вторую active inbox row.

### Критерии готовности

- Unicode/кириллица/emoji/multiline и ссылки рядом с mention проверены;
- одинаковые display names различимы стабильной secondary identity;
- arbitrary/cross-room/guest/self IDs отклоняются без утечки membership;
- create/edit/add/remove/re-add/delete/TTL покрыты PostgreSQL и E2E;
- account, заблокированный между autocomplete и send, не получает mention;
- duplicate POST и reconnect не создают duplicate relation.

## 3. Inbox, reply notifications и unread

### Inbox model

`user_notifications` хранит одну logical row на
`(recipient_user_id, source_room_message_id)`:

- reasons: `mention`, `reply` или обе;
- actor, room и source message IDs;
- monotonic `revision`, увеличиваемый при каждом изменении reasons/read/retract;
- `created_at`, `read_at`, `retracted_at`;
- canonical excerpt/read model без raw HTML;
- unique active dedupe key.

Reply на room message зарегистрированного пользователя создаёт reason
`reply`. Reply гостю остаётся обычным reply без durable notification.
Mention и reply одному account объединяются в одну row. DM reply использует
существующий DM notification flow и не создаёт второй inbox item.

Удаление mention снимает только reason `mention`. Пока остаётся `reply`, row не
retract-ится. Row получает `retracted_at` только когда reasons пусты; re-add
очищает retract, увеличивает revision и не создаёт второй active inbox item.

### API

```http
GET  /api/notifications?before=<cursor>&limit=50
POST /api/notifications/:id/read
POST /api/notifications/read-all
```

Inbox возвращает `messages/page`-подобный cursor contract, unread count, room,
actor, reasons, excerpt и time. Limit по умолчанию 50, максимум 100.
Retracted row не открывает удалённый текст.

Deep link:

```text
/r/:roomId?intent=chat&message=:messageId
```

Он открывает chat без auto-join voice, использует `around` 2.5 и показывает
tombstone при deleted/expired target.

### Read policy

- notification в видимом active chat помечается прочитанной явным API после
  render, без toast;
- вне нужного chat используются inbox badge и in-app toast;
- service worker не показывает push, если есть focused visible client;
- DND/mute/private settings не удаляют inbox item;
- read/retract revision распространяется на все tabs/devices;
- divider «Новые сообщения» и действие «К первому непрочитанному» используют
  high-water read cursor `(createdAt,id)` из 2.5 и `around`, не wall-clock
  timestamp и не загрузку всей history.

### Критерии готовности

- mention + reply создают одну row с двумя reasons;
- multi-tab/cross-device unread сходится после reconnect/resync;
- active-chat race `receive ↔ render ↔ read` не показывает лишний interrupt;
- cold/warm deep links работают для latest, old, deleted и expired message;
- inbox pagination не дублирует rows при одновременном retract/read;
- keyboard, focus, screen reader, empty/loading/error states проверены.

## 4. Notification policy и durable outbox

### Room levels

Room interrupt level становится `all | mentions | none`:

- `all` — обычные room notifications и addressed events;
- `mentions` — только mention/reply interrupts;
- `none` — interrupts выключены;
- inbox для mention/reply сохраняется при любом level.

Новая `notification_room_preferences` хранит level. Для rollback-совместимости
старый `notification_room_mutes` dual-write-ится:

- `all` удаляет legacy mute;
- `mentions` и `none` сохраняют legacy mute;
- 2.5 server после rollback поэтому подавляет interrupts, а не раскрывает
  больше уведомлений, чем выбрал пользователь.

DND подавляет interrupts, private notifications скрывают body, но durable
inbox остаётся.

### Delivery contract

Server-side внешний канал 2.6.0 — Web Push. Realtime account event доставляет
in-app state; подключённый VoiceRoomDesktop может показать локальное OS
notification, используя тот же `dedupeKey`. Отдельная параллельная отправка
через page Notification API не создаётся: browser notification показывается
service worker из Web Push.

External delivery имеет at-least-once semantics. Exactly-once гарантируется
для logical inbox row, но не обещается для внешнего push provider; client/SW
dedupe по `dedupeKey` и notification tag.

### Outbox schema и worker

`notification_outbox` содержит:

- immutable payload reference и channel;
- `notification_id`, `notification_revision` и unique
  `(notification_id, notification_revision, channel)`;
- delivery `dedupe_key` включает revision, поэтому re-add не блокируется
  delivered row предыдущей revision;
- state `pending | processing | delivered | suppressed | cancelled | dead`;
- `attempts`, `available_at`, `locked_at`, `locked_by`, `last_error_code`;
- `created_at`, `delivered_at`, retention metadata.

Worker:

- claim-ит до 50 jobs через `FOR UPDATE SKIP LOCKED`;
- commit-ит lease до network I/O;
- lease истекает через 2 минуты и возвращает abandoned job в pending;
- использует exponential backoff с jitter: base 5 s, cap 1 h;
- после 8 неуспешных attempts переводит job в `dead`;
- при shutdown прекращает claims, завершает текущие deliveries и оставляет
  незавершённые lease-recoverable;
- delivered rows удаляются через 30 дней, dead rows — только после
  операторского решения;
- provider `404/410` удаляет invalid subscription и считается terminal
  success, а не poison job.

Dispatcher повторно читает актуальные DND/mute/privacy settings перед внешней
отправкой. Retracted notification не доставляется даже если job уже pending.
DND/mute переводит конкретную delivery revision в terminal `suppressed`, а
retract — в terminal `cancelled`; изменение settings позже не оживляет старый
interrupt. Новая revision создаёт новый delivery key.

### Критерии готовности

- message, mentions, inbox и outbox commit/rollback атомарно;
- restart после claim и после provider success не теряет logical event;
- duplicate request не создаёт второй active job;
- poison job не блокирует batch;
- edit reason/remove/delete/TTL корректно выбирают update, `suppressed` или
  `cancelled`, не retract-ят оставшийся reason;
- delivery test matrix покрывает DND, all/mentions/none, privacy, focused,
  background, expired subscription и provider outage;
- worker restart, graceful shutdown и lease recovery проверены на PostgreSQL.

## 5. Emoji reactions

### Product contract

- room messages и DM поддерживают несколько разных reactions;
- зарегистрированный участник соответствующего chat может установить одну
  конкретную reaction один раз;
- guest видит room reactions, но не создаёт их;
- UI optimistic, но server state authoritative;
- reaction notifications не создаются;
- delete/expiry message удаляет reactions.

API задаёт desired state, а не неидемпотентный toggle:

```http
PUT /api/rooms/:roomId/chat/:messageId/reactions
PUT /api/dm/:userId/messages/:messageId/reactions

{ "emoji": "<sequence>", "active": true | false }
```

Повтор одного request безопасен. HTTP response и realtime event содержат
message reaction revision.

### Unicode policy

- принимается ровно одна RGI emoji sequence из pinned Unicode dataset;
- server преобразует accepted sequence в canonical `emoji_key`;
- skin tone, ZWJ, gender и flag sequences остаются различными keys;
- visually equivalent presentation variants не создают два counters;
- оригинальная canonical sequence хранится целиком, не как shortcode;
- версия Unicode data и renderer фиксируется lockfile и release notes;
- renderer обязан покрывать весь accepted dataset и иметь проверенную
  license/attribution.

На дату плана соответствующей dependency в проекте нет; выбор package является
implementation prerequisite, а не неподтверждённым обещанием конкретного
поставщика.

### Данные и scale

Room и DM сохраняют отдельные tables с FK на собственную message table и
shared API model:

- unique `(message_id, user_id, emoji_key)`;
- index для aggregate по message;
- cascade при hard delete;
- summary возвращает counts и `reactedByMe`;
- полный список reactors загружается отдельным cursor endpoint, limit 50,
  максимум 100.

`room_messages` и `direct_messages` получают `reaction_revision bigint NOT
NULL DEFAULT 0`. Reaction transaction меняет desired-state row и атомарно
увеличивает parent revision; no-op retry возвращает текущую revision без
increment. Эта durable revision является единственным источником HTTP/realtime
ordering.

### Критерии готовности

- concurrent `active=true/false`, retry, realtime echo и reconnect сходятся к
  одному revision;
- stale snapshot не перезаписывает более новую reaction revision;
- room/DM permissions и guest read-only проверены;
- canonicalization покрывает simple, skin tone, ZWJ, flags и presentation
  variants;
- picker/popover доступны keyboard и screen reader;
- cascade/TTL и reactor pagination проверены на PostgreSQL.

## Performance и observability

### Budgets

Все budgets измеряются по воспроизводимому RC profile 2.5: report фиксирует
digest/hardware/PostgreSQL/dataset/concurrency, warmup не менее 2 минут и не
менее 10 000 samples на endpoint/worker scenario.

- members autocomplete на room из 10 000 members: warm p95 ≤ 200 ms;
- inbox/latest/older endpoints: warm p95 ≤ 300 ms, p99 ≤ 750 ms;
- send transaction с пятью mentions: p95 ≤ 500 ms без внешнего push I/O;
- outbox worker обрабатывает не менее 100 jobs/s на RC environment при mock
  provider;
- reaction update: p95 ≤ 250 ms без client network latency.

### Metrics

- inbox created/read/retracted counters;
- unread count reconciliation mismatch counter;
- outbox pending, processing, dead, attempts, oldest age и delivery latency;
- delivery result по channel/status без recipient labels;
- mention validation/retract counters;
- reaction conflict/error/revision-resync counters;
- structured-content backfill progress/failures.

Alerts:

- oldest pending > 5 min — warning, > 15 min — rollout stop;
- любое новое `dead` job — alert; более 10 за 10 min — feature disable;
- delivery failure > 5% при не менее 100 attempts за 10 min либо 10 failures
  при меньшем traffic без provider-wide incident — rollout stop;
- любой persistent unread drift или cross-room notification leak — P0.

## Миграции, rollout и rollback

### Migration inventory

1. Nullable `room_messages.content`.
2. `room_message_mentions`.
3. `user_notifications`.
4. `notification_outbox`.
5. `notification_room_preferences`.
6. Separate room/DM reaction tables.
7. `reaction_revision` в обеих message tables.

Все schema changes additive. `room_messages.text`, legacy mute tables и
существующие event types не удаляются.

### Rollout

1. Применить schema при `ENGAGEMENT_ENABLED=false` и
   `NOTIFICATION_DISPATCHER_ENABLED=false`.
2. Выполнить bounded content backfill и проверить indexes/metrics.
3. Включить dual-write и read path для internal accounts.
4. Включить mentions/inbox без external dispatcher.
5. Включить dispatcher и наблюдать outbox.
6. Включить reactions.
7. Продвинуть те же registry digests из staging в production без rebuild и
   наблюдать не менее 30 минут.

### Compatibility matrix

- `/api/capabilities` сохраняет `contractVersion: 1` и включает
  `engagement=true`, `reactions=true`; media flags остаются `false`;
- 2.5 web ↔ 2.6 API: plain text и old events продолжают работать;
- open 2.5 tab игнорирует content/notification/reaction events;
- 2.6 web ↔ 2.5 API во время rollback: capabilities скрывают UI функций;
- old server читает dual-written `text` и игнорирует additive tables;
- dispatcher включается только после подтверждения schema version.

### Rollback

Сначала выключаются dispatcher и feature flags. Предыдущий application image
запускается поверх additive schema; tables и content не удаляются. Destructive
down, удаление fallback text или legacy mute compatibility запрещены в
аварийном rollback.

## Порядок реализации

1. Подтвердить production stability и tag `v2.5.0`.
2. Ввести content v1, shared contracts, dual-write и backfill.
3. Реализовать transactional message Unit of Work.
4. Реализовать mentions и eligibility.
5. Реализовать inbox/read/retract/deep links.
6. Реализовать outbox worker, metrics и failure recovery.
7. Мигрировать notification levels с legacy compatibility.
8. Добавить unread divider/jump.
9. Реализовать reactions и Unicode/renderer contract.
10. Пройти compatibility, load, failure, RC и production smoke.

## Definition of Done 2.6.0

- существует production tag `v2.5.0`;
- все scope-пункты завершены без зависимости от media/moderation 2.7;
- migrations прошли fresh install, upgrade 2.5 → 2.6 и application rollback;
- unit, PostgreSQL integration, API/realtime contract, component и E2E зелёные;
- у затронутых content/notification/reaction modules соблюдены write ownership,
  transaction boundaries, shared contracts и architecture tests из 2.5;
- dispatcher restart/lease/DLQ/retract и provider outage проверены;
- mention+reply reason transitions, re-add revision и
  delivered/suppressed/cancelled dedupe проверены;
- N-1 web/open-tab и VoiceRoomDesktop compatibility подтверждены;
- Unicode data/renderer versions и attribution зафиксированы;
- dashboards/alerts и feature-disable procedure активны;
- workspace versions и lockfile равны `2.6.0`;
- changelog, migration/env/operations notes и known limitations готовы;
- release branch слит в `main` и обратно в `develop`, tag `v2.6.0` создан;
- нет P0/P1, notification leaks, lost inbox events или unreconciled duplicates.
