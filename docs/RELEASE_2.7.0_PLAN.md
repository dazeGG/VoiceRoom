# План релиза 2.7.0 — Media & Moderation

Статус: рабочий source of truth для релиза 2.7.0. Обновлён 2026-07-16.

Цель релиза — безопасно добавить изображения в room chat и DM. Media
выпускается только вместе с полным lifecycle файлов, quotas, восстановлением
worker, backup/restore и минимально необходимыми owner moderation tools.

Предыдущие релизы:

- [2.5.0 — Messaging Foundation](./RELEASE_2.5.0_PLAN.md);
- [2.6.0 — Engagement & Notifications](./RELEASE_2.6.0_PLAN.md).

## SemVer

`2.7.0` — minor: появляются attachment API, новые message capabilities и
moderation UI. `2.7.x` после релиза содержит только совместимые fixes. Alpha,
beta и RC публикуются как `2.7.0-dev.N`, `2.7.0-beta.N` и `2.7.0-rc.N`.

## Блокирующие prerequisites

- `v2.6.0` стабилен в production;
- 2.5/2.6 message contracts, pagination, replies, membership и feature
  negotiation работают с N-1 clients;
- capability contract version 1 уже содержит default-false `mediaRead` и
  `mediaUploads`, поэтому 2.7 не вводит новый negotiation mechanism;
- active-ban predicate уже учитывает
  `expires_at IS NULL OR expires_at > now` во всех admission paths;
- `uploads` и PostgreSQL бэкапятся как согласованный набор;
- production disk metrics и alerting доступны;
- CI умеет поднимать full stack и сохранять media E2E artifacts.
- все test/coverage/architecture gates 2.5 продолжают блокировать релиз; для
  media/moderation modules нельзя обходить application-service, repository и
  shared-contract boundaries.

Temporary bans нельзя включать, если rollback на 2.6 снова сделает expired ban
бессрочным. Uploads нельзя включать до успешного restore rehearsal.

## Подтверждённый scope

| № | Направление | Результат |
| --- | --- | --- |
| 1 | Attachment model | room/DM messages используют общий безопасный metadata contract |
| 2 | Upload and compose | до четырёх JPEG/PNG/WebP можно загрузить, удалить из draft и отправить |
| 3 | Media worker | processing переживает restart, имеет leases, quotas и bounded concurrency |
| 4 | Private storage and delivery | файл выдаётся только после проверки visibility parent message |
| 5 | Cleanup and backup | temp/orphan/deleted files очищаются, DB+uploads восстанавливаются вместе |
| 6 | Moderation center | owner видит active bans, выбирает срок/причину и выполняет idempotent unban |
| 7 | Media moderation | owner может удалить нарушающее room message/attachment существующим message action |

## Не входит в 2.7.0

- GIF provider/picker;
- SVG, HEIC и animated GIF uploads;
- видео, аудиофайлы и произвольные документы;
- S3-compatible adapter и отдельный media microservice;
- antivirus/content-recognition service;
- user reports, moderator/co-host roles и полноценный audit log;
- private/members-only rooms;
- mobile/PWA, slugs и управляемые invite codes — [BACKLOG.md](./BACKLOG.md).

Если reports, roles или audit log становятся обязательными, они образуют
отдельный будущий minor, а не расширяют 2.7.0 перед RC.

## Фактический baseline

- `sharp` и multipart уже используются для avatars:
  `apps/api/package.json:15-25`, `apps/api/src/server.js:1115-1160`.
- Avatar pipeline проверяет JPEG/PNG/WebP signature, limit 5 MB и 40 MP,
  исправляет orientation и сохраняет WebP:
  `apps/api/src/lib/avatar-processing.js:7-45`.
- Текущий storage принимает только avatar key pattern и не подходит для
  attachments без отдельного namespace/model:
  `apps/api/src/lib/avatar-storage.js:7-18`.
- Persistent `uploads` volume существует, а README требует согласованного
  backup вместе с PostgreSQL: `docker-compose.yml:71-75,132-136`,
  `README.md:309`.
- Attachment tables/routes сейчас отсутствуют; `text` и `body` остаются
  `NOT NULL`.
- `room_bans.expires_at` и `metadata` существуют, но create не записывает
  expiry, active query не фильтрует expiry, cap считает все rows, list route
  отсутствует: `apps/api/src/migrations/20260710130000_add_room_bans.js:6-26`,
  `apps/api/src/lib/room-store.js:471-541`,
  `apps/api/src/server.js:2919-2927`.

## 1. Product limits и compatibility fallback

### Ограничения

- upload доступен только зарегистрированным users;
- одно message содержит до четырёх images;
- один input file — не более 10 MiB;
- принимаются JPEG, PNG и WebP по фактической signature;
- decoded image — не более 40 MP;
- SVG, HEIC и animated formats отклоняются;
- максимальная сторона processed image — 2560 px;
- отдельный preview имеет максимальную сторону 480 px;
- orientation исправляется, EXIF/GPS и client filename не сохраняются;
- original upload удаляется после successful processing.

### N-1 fallback

Существующие `room_messages.text` и `direct_messages.body` не становятся
nullable:

- message с text+images сохраняет обычный text/body;
- image-only message сохраняет локализуемый plain fallback
  `[Изображение]`;
- 2.6 client поэтому показывает понятную text row, а не пустой bubble;
- 2.7 client скрывает fallback, когда успешно отображает attachments;
- unknown attachment fields/events игнорируются old client.

Attachment-only validation разрешает пустой пользовательский text только если
в transaction привязывается хотя бы один `ready` attachment; fallback строит
server.

## 2. Attachment data model

### `message_attachments`

Одна metadata table обслуживает room chat и DM:

- `id`, `owner_user_id`;
- intended context: `room_id` или `dm_peer_user_id`;
- final target: nullable `room_message_id` или `direct_message_id`;
- status `uploading | processing | ready | failed | deleted`;
- detected MIME, input bytes, width/height;
- server-generated `input_storage_key`, сохраняемый до terminal processing;
- processed/preview storage keys и output bytes;
- sanitized error code без stack/path;
- `created_at`, `updated_at`, `ready_at`, `deleted_at`;
- exactly one intended context;
- после send exactly one final message target;
- ready attachment нельзя повторно привязать к другому message.

`media_processing_jobs` хранит queue/lease отдельно от public metadata:

- unique `attachment_id`;
- state `pending | processing | completed | dead`;
- attempts, `available_at`, `locked_at`, `locked_by`, last error code;
- timestamps и retention fields.

### Создание и отправка

```http
POST /api/attachments
PUT  /api/attachments/:id/content
GET  /api/attachments/:id
GET  /api/attachments/:id/content?variant=preview|display
DELETE /api/attachments/:id
```

1. `POST` создаёт owned draft slot после context/quota checks.
2. `PUT` stream-ит один multipart file в generated temp key; весь Buffer не
   удерживается без необходимости.
3. После signature/byte precheck attachment и job переходят в `processing`.
4. Client получает JSON status/metadata через realtime и
   `GET /api/attachments/:id` fallback.
5. Message POST передаёт до четырёх `attachmentIds`.
6. Message transaction проверяет ownership, intended context и `ready`, затем
   создаёт message и привязывает все attachments.
7. Если хотя бы один attachment невалиден, не ready или уже использован,
   message полностью отклоняется.

Binary route всегда отделён от metadata route. `GET .../content` возвращает
bytes только для `ready` attachment и только variant `preview|display`; original
после processing не хранится. Unknown variant даёт `400`, unavailable/deleted —
terminal `404/410` без storage path.

Client state `uploading` показывает progress; send блокируется при любом
`uploading`, `processing` или `failed`. Error attachment нужно удалить или
загрузить заново. Partial send запрещён.

### Idempotency

- create slot и message send принимают `Idempotency-Key`;
- повтор content upload к уже processing/ready slot не создаёт второй job;
- повтор message send возвращает тот же message/attachment binding;
- delete draft повторяем и возвращает terminal state.

## 3. Media worker и storage

### Processing

Worker встроен в текущий API deployment, но использует PostgreSQL queue и
может быть вынесен позже без смены contract.

Initial defaults:

| Setting | Default |
| --- | ---: |
| worker concurrency | 2 |
| claim batch | 10 |
| processing timeout | 30 s |
| lease | 2 min |
| max attempts | 5 |
| retry base/cap | 5 s / 15 min |
| pending attachments per user | 8 |
| upload rate | 20 files / 10 min |
| stored media quota per user | 1 GiB |
| minimum free disk before rejection | 2 GiB |

Все значения настраиваются env, но production release checklist фиксирует
фактически применённые values.

Worker:

- claim-ит jobs через `FOR UPDATE SKIP LOCKED` и commit-ит lease до Sharp I/O;
- использует `failOn: 'warning'`, `limitInputPixels` и sequential read;
- выполняет rotate, resize и metadata stripping;
- пишет processed/preview во временные random keys и атомарно переименовывает;
- читает input только по сохранённому `input_storage_key`; restart не зависит
  от in-memory temp path;
- помечает `ready` только после появления обоих final files;
- удаляет original после commit ready;
- после restart возвращает expired lease в pending;
- после пяти failed attempts переводит job в dead и attachment в failed;
- прекращает claims при shutdown и оставляет незавершённое recoverable.

### Storage

`MediaStorage` отделён от avatar key validation, но может использовать тот же
persistent `uploads` volume. Keys генерируются server-side из UUID и variant;
original filename и path fragments клиента не участвуют.

Operations:

- atomic save;
- stream read;
- idempotent remove;
- list/reconcile by namespace;
- free-space inspection;
- traversal-safe key validation.

S3 adapter не входит в релиз. Interface не обещает semantics, которых local
filesystem не поддерживает.

### Quotas и disk pressure

- quota включает ready и processing bytes пользователя;
- slot reservation учитывает максимальный input size до начала upload;
- при превышении user quota возвращается `413 media_quota_exceeded`;
- при free disk ниже threshold новые slots/uploads получают `503
  media_storage_pressure`;
- active processing завершается, но worker не claim-ит новые jobs при critical
  disk pressure;
- quota и rate-limit checks выполняются server-side и имеют metrics.

## 4. Cleanup, retention и recovery

- `uploading` без content старше 1 h удаляется;
- failed input/temp files удаляются не позднее 1 h после terminal failure;
- ready, но не привязанный draft старше 24 h удаляется;
- attachment становится недоступен сразу после delete/expiry parent message;
- physical processed/preview files удаляются не позднее 1 h после terminal
  deletion;
- room attachment следует TTL parent room message;
- DM attachment живёт до delete parent DM;
- cleanup bounded batches не держит длинную transaction;
- reconciliation удаляет unreferenced media files и помечает missing ready
  files как failed/unavailable;
- cleanup correctness не зависит от единственного timer run.

Crash windows покрываются явно:

| Crash point | Recovery |
| --- | --- |
| temp file записан, DB row не создан | orphan scan удаляет file |
| DB row/job создан, temp file отсутствует | job становится failed |
| processed создан, preview отсутствует | retry перезаписывает обе variants |
| files готовы, DB commit не прошёл | orphan scan удаляет files |
| DB ready, file потерян | read показывает unavailable, reconciliation создаёт alert |

## 5. Media access и UX

### Authorization

Draft доступен только owner. После binding content endpoint вызывает тот же
message-visibility service, что room/DM read:

- DM — только два участника с действующим access;
- room — текущая room visibility и ban policy;
- membership не используется как единственное access rule, потому что в 2.5
  оно не делает room private;
- banned/removed access закрывается сразу;
- storage path и private URL наружу не возвращаются;
- response использует `Cache-Control: private`, safe MIME и generated
  filename.

### UI

- attachment button, drag-and-drop и paste;
- draft previews можно удалить и менять местами;
- одно image показывается крупно, два–четыре — стабильной mosaic;
- dimensions известны до full load, поэтому layout не прыгает;
- preview lazy-load, full image открывается в accessible lightbox;
- lightbox поддерживает zoom, keyboard navigation и download processed variant;
- unavailable/deleted image показывает устойчивую заглушку;
- room и DM используют общий attachment component, но отдельные chat stores.

### Критерии готовности

- byte/signature/pixel/count/context/ownership checks покрыты;
- upload/processing/status/send работают после API restart;
- failed attachment никогда не создаёт partial message;
- old client получает fallback;
- guest может видеть разрешённое room media, но не загружать;
- private DM file не открывается по знанию attachment ID;
- keyboard, focus, screen reader, lazy loading и no-layout-shift проверены;
- room/DM E2E покрывают text+image и image-only messages.

## 6. Moderation center и временные баны

### Scope

В owner-only room settings появляется «Заблокированные»:

- список только active bans;
- сроки 1 h, 1 d, 7 d или permanent;
- optional private reason до 500 символов;
- explicit unban;
- существующий 10-second undo использует тот же unban endpoint;
- owner может удалить нарушающее room message вместе с attachments.

Moderator/co-host roles, reports и audit log не входят.

### Унаследованный regression gate active-ban

Predicate уже исправлен в 2.5.0 и не реализуется заново в 2.7.0. В этом релизе
он остаётся обязательным regression gate для нового list/create/unban UI и всех
существующих admission paths:

```sql
expires_at IS NULL OR expires_at > current_timestamp
```

Predicate применяется к status, preview, room chat, WebSocket, LiveKit token,
membership admission, list и ban cap. Expired rows не блокируют access даже
до cleanup.

### API

```http
GET    /api/rooms/:roomId/bans?before=<cursor>&limit=50
POST   /api/rooms/:roomId/bans
DELETE /api/rooms/:roomId/bans/:banId
```

Existing singular `POST /api/rooms/:roomId/ban` сохраняется как N-1 adapter:
он вызывает тот же create service, трактует legacy request как permanent ban и
сохраняет старый response envelope. Новый client использует plural API; adapter
не удаляется в 2.7.x.

Create принимает target, duration enum, reason и `Idempotency-Key`. Account
банится по `userId`; guest — по normalized IP, но account action никогда не
превращается одновременно в shared-IP ban.

- retry с тем же `Idempotency-Key` возвращает исходный response без новой
  мутации;
- новый request с другим key для того же target обновляет expiry/reason той же
  active row и возвращает её `banId`; если остались только expired rows,
  создаётся новая row;
- cap 100 считается только по active rows;
- list сортируется `created_at DESC, id DESC`;
- response содержит safe account identity либо нейтрального guest,
  timestamps/reason;
- raw/hash IP, device и network metadata не возвращаются;
- только owner получает list/create/delete; остальные получают `403`.

### Критерии готовности

- 1h/1d/7d/permanent сохраняются и применяются точно;
- expired ban не блокирует ни один access/admission path;
- 100 expired rows не расходуют cap;
- account ban отключает все его room connections, guest ban — matching IP
  connections;
- reason видит только owner;
- undo и center unban идемпотентны и используют один endpoint;
- ban/unban/expiry/reconnect/multi-tab races покрыты PostgreSQL и E2E;
- image/message deletion сразу закрывает media read.

## Performance и observability

### Budgets

Все budgets измеряются по воспроизводимому RC profile 2.5: report фиксирует
digest/hardware/PostgreSQL/dataset/concurrency, warmup не менее 2 минут и не
менее 10 000 samples на endpoint либо 15 минут steady worker load.

- create slot response p95 ≤ 300 ms без передачи bytes;
- accepted 10 MiB/40 MP image переходит в ready: p95 ≤ 15 s при normal load;
- queue oldest age при normal load < 5 min;
- authorized local media read TTFB p95 ≤ 500 ms;
- moderation list/action p95 ≤ 300 ms;
- cleanup 500 rows/files не блокирует event loop более 100 ms подряд.

### Metrics

- upload accepted/rejected bytes и reason;
- slots/status counts;
- queue pending/processing/dead, oldest age, attempts и processing duration;
- worker timeouts/restarts/lease recovery;
- temp/orphan/missing file counts;
- stored bytes by state без user labels;
- filesystem free bytes/percent;
- authorized/denied media reads;
- active/expired bans и enforcement outcome без PII;
- cleanup/reconciliation duration and failures.

Alerts:

- free disk ниже configured threshold — uploads disabled;
- oldest processing/pending > 5 min — warning, > 15 min — feature disable;
- любое missing ready file — P0 data-integrity alert;
- orphan older 24 h или failed temp older 1 h — alert;
- valid-image processing failures > 2% при не менее 100 jobs за 15 min либо 5
  failures при меньшем load — rollout stop;
- media authorization leak — immediate rollback/P0.

## Backup и restore

Ready media является частью durable product data. Release gate требует:

1. остановить изменяющие API/media jobs либо использовать storage-level atomic
   snapshot;
2. получить согласованные PostgreSQL и `uploads` backups;
3. восстановить их в isolated environment;
4. выполнить reconciliation;
5. открыть выборку room/DM attachments и проверить hashes/dimensions/access;
6. подтвердить измеренные RPO не более 1 часа и RTO не более 4 часов и записать
   evidence в operations notes.

Если инфраструктура не подтверждает оба численных budget, public media rollout
остаётся выключен.

Backup без одного из двух volumes считается неполным. Temp/orphan files можно
не сохранять только если DB state после restore переводит их в recoverable
failed/pending state.

## Миграции, rollout и rollback

### Migration inventory

1. `message_attachments`.
2. `media_processing_jobs`.
3. Indexes/check constraints для state, owner, context и cleanup.
4. Ban indexes/list support; existing `expires_at/metadata` переиспользуются.

Все changes additive. Existing text/body и old message events сохраняются.

### Rollout

1. Применить schema при `MEDIA_UPLOADS_ENABLED=false` и
   `MEDIA_WORKER_ENABLED=false`.
2. Развернуть read/fallback path и reconciliation.
3. Выполнить DB+uploads backup/restore rehearsal.
4. Включить worker без public upload, проверить synthetic jobs.
5. Включить uploads для internal accounts.
6. Включить room/DM compose.
7. Включить moderation center и выставить `moderationCenter=true`.
8. Продвинуть те же registry digests в production без rebuild и наблюдать
   минимум 60 min.

### Compatibility

- 2.6 client видит fallback text и игнорирует attachments;
- capability contract 2.5 остаётся version 1; 2.7 API выставляет
  `mediaRead=true`, а `mediaUploads` отражает feature flag;
- `moderationCenter` является отдельным flag: `true` только после включения
  list/create/unban API/UI и `false` при feature/binary rollback;
- 2.7 client при `404`/`mediaRead=false` не запрашивает binary route и скрывает
  compose при `mediaUploads=false`;
- old 2.6 application после rollback читает text/body и игнорирует new tables;
- 2.6 web продолжает выполнять singular `/ban` через compatibility adapter;
- expiry-aware ban enforcement уже существует до создания first temporary ban;
- existing attachments остаются readable при feature rollback на 2.7, когда
  `mediaUploads=false`, но `mediaRead=true`.

### Rollback

Feature rollback по умолчанию оставляет 2.7 binary:

1. Запретить новые slots/uploads и выставить `mediaUploads=false`.
2. Остановить claims и дать active processing завершиться либо истечь lease.
3. Выставить `moderationCenter=false` и отключить list/create/unban UI,
   сохранив expiry-aware enforcement.
4. Оставить `mediaRead=true`, чтобы существующие attachments читались.

Binary rollback на 2.6 допускается только для P0. Он сохраняет rows/files, но
2.6 показывает только text fallback: attachment read path в 2.6 отсутствует.
Возврат изображений выполняется roll-forward исправлением 2.7; destructive down
или удаление media запрещены.

## Порядок реализации

1. Подтвердить production stability и tag `v2.6.0`.
2. Добавить attachment/job schema, capability flags и fallback read model.
3. Реализовать MediaStorage namespace и reconciliation.
4. Реализовать slot/upload API, quotas и idempotency.
5. Реализовать worker/lease/retry/cleanup/disk pressure.
6. Реализовать transactional message binding и image-only fallback.
7. Добавить shared room/DM compose, mosaic и lightbox.
8. Реализовать moderation list/duration/reason/idempotent unban.
9. Добавить media deletion/access checks.
10. Пройти restore, load, failure, compatibility, RC и production smoke.

## Definition of Done 2.7.0

- существует production tag `v2.6.0`;
- all scope-пункты завершены без GIF/S3/reports/roles;
- fresh install, upgrade 2.6 → 2.7 и application rollback проверены;
- worker restart, lease expiry, disk-full, orphan/temp cleanup и provider-free
  local processing проверены;
- DB+uploads backup/restore rehearsal подтверждает RPO ≤ 1 h и RTO ≤ 4 h;
- feature rollback сохраняет media read, binary rollback на 2.6 проверен как
  text-fallback-only degradation без удаления rows/files;
- 2.6 client и минимальная VoiceRoomDesktop version проходят compatibility;
- unit, PostgreSQL integration, API/realtime, component, E2E, accessibility и
  browser/media RC matrix зелёные;
- test/coverage/architecture gates 2.5 зелёные; media/moderation modules
  соблюдают унаследованные ownership и boundary rules;
- dashboards, alerts и upload-disable procedure активны;
- production quotas/thresholds записаны в env/operations docs;
- workspace versions и lockfile равны `2.7.0`;
- changelog, migration/backup/restore/rollback notes и limitations готовы;
- release branch слит в `main` и обратно в `develop`, tag `v2.7.0` создан;
- нет P0/P1, missing durable files, media leaks или unbounded queue/storage.
