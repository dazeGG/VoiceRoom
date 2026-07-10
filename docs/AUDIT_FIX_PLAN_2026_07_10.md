# План фиксов по аудиту 2026-07-10

> **Временный рабочий документ.** Удалить после закрытия всех пунктов (или перенести остатки в issues).
> Базис: аудит `develop` @ `d09f1ee` (v2.3.2), два прохода (общий + стабильность).
> Статусы: `[ ]` не начато · `[~]` в работе · `[x]` сделано · `[-]` отклонено (с причиной).
> Обновлено 2026-07-10: закрытые пункты реализованы в коде; `npm run check`, shared/web tests и API unit без БД зелёные. DB integration validation закрыт: `TEST_DATABASE_URL=postgres://voice_room:voice_room_dev@127.0.0.1:5432/postgres npm test` зелёный (shared 23/23, api 144/144, web 31/31). Перед релизом остаётся docker stop/smoke.

## Порядок работ

Фазы упорядочены по влиянию на прод. Внутри фазы пункты независимы и могут идти отдельными PR.
Каждый пункт — атомарный коммит(ы) по Conventional Commits, PR в `develop`, squash-merge.

- **Фаза A** — прод падает/деградирует сам по себе (деплой, время, гонки).
- **Фаза B** — некорректное поведение, видимое пользователю.
- **Фаза C** — hardening и масштабируемость.
- **Фаза D** — техдолг, наблюдаемость, документация.

---

## Фаза A — устойчивость прода

### A1. Graceful shutdown API `[x]`

**Проблема.** В API нет ни одного обработчика SIGTERM/SIGINT, нет `server.close()` / `pool.end()`. PID 1 контейнера — `npm --workspace @voice-room/api start` (`Dockerfile:34`), npm ненадёжно форвардит сигналы → `docker stop` = 10 c тишины → SIGKILL. Каждый деплой из CI (`docker compose up -d --build`) жёстко рвёт все WS, in-flight запросы и пул Postgres.

**Решение.**
1. `Dockerfile`: CMD → `["node", "apps/api/src/server.js"]` (node как PID 1; рабочая директория и NODE_PATH workspaces проверить — либо `WORKDIR /app` + запуск по абсолютному пути, npm workspaces хойстит зависимости в корневой `node_modules`, require их найдёт).
2. `apps/api/src/server.js` (`bootstrap`): обработчик SIGTERM/SIGINT —
   - перестать принимать новые соединения (`server.close()`),
   - разослать активным WS close-фрейм с кодом `1001 Going away` (клиентский reconnect подхватит),
   - остановить таймеры prune,
   - `await` `roomStore.close()` / `userStore.close()` / `friendStore.close()` (слить пулы),
   - таймаут-предохранитель ~8 с → `process.exit(0)`.
3. Прогнать `apps/api/test/listen.test.js`, `server-bootstrap.test.js`; добавить тест: bootstrap → SIGTERM → сервер закрылся, пулы закрыты, процесс не завис.

**Критерий приёмки.** `docker compose stop api` завершается < 10 с без SIGKILL; в логах видна строка о graceful-остановке.
**Сложность:** M. **Риск:** низкий (изолированный контур).

### A2. Убрать `pruneRooms()` из горячего пути запросов `[x]`

**Проблема.** `getRoom()` (`apps/api/src/server.js:426`) вызывает `pruneRooms()` — транзакцию с двумя `UPDATE` (`room-store.js:454`) — почти на каждом HTTP-запросе, включая поллинг превью (`/api/rooms/:id`, `/peers`, `/chat`, лобби). В chat-путях вызывается дважды (`server.js:1144-1145`, `1159-1160`). Каждый read = write-транзакция + contention. Открыто с аудита 2026-06-10.

**Решение.**
1. Удалить `await pruneRooms()` из `getRoom()`, `handleAuthRooms`, `handleAddAuthRoom`, `handleRoomChatList`, `handleRoomChatPost`, `handleCreateRoom`→`createRoomForRequest`, `/api/healthz`.
2. Единственный владелец prune — фоновый таймер `startPruneTimer` (`ROOM_PRUNE_INTERVAL_MS`, по умолчанию 60 с — этого достаточно: TTL комнат 15 мин, сообщений 7 дней).
3. Компенсация точности: `getRoom` уже фильтрует `deleted_at IS NULL`; истёкшие-но-непомеченные строки между тиками таймера отфильтровать прямо в SELECT'ах (`expires_at > now`, `empty_since`-логика) — `listMessages` уже так делает.
4. Тесты `room-crud`, `room-persistence`, `chat`: убедиться, что ни один не полагался на inline-prune; где полагался — заменить явным вызовом `store.pruneRooms()` в тесте.

**Критерий приёмки.** На GET-путях нет UPDATE-запросов (проверить логом pg или тестом-шпионом на pool); поведение TTL не изменилось.
**Сложность:** M. **Риск:** средний — легко потерять сценарий, где прунинг был нужен синхронно; закрывать тестами.

### A3. Retention: физическое удаление soft-deleted строк `[x]`

**Проблема.** Всё удаление мягкое (`deleted_at`), hard-delete нет нигде: `rooms`, `room_messages`, `room_peer_identities` растут бесконечно → распухание диска и деградация запросов просто со временем.

**Решение.**
1. `room-store.js`: новый метод `purgeDeleted({ olderThanMs })` — в одной транзакции:
   - `DELETE FROM room_messages WHERE deleted_at < now() - interval` (батчами по N тысяч, чтобы не держать блокировки),
   - `DELETE FROM rooms WHERE deleted_at < …` (каскад заберёт `room_peer_identities`, memberships, bookmarks — FK уже `ON DELETE CASCADE`),
   - `DELETE FROM room_peer_identities WHERE last_seen_at < …` для комнат-долгожителей (иначе identities статических комнат копятся вечно).
2. ENV: `RETENTION_PURGE_INTERVAL_MS` (по умолчанию 1 ч), `RETENTION_KEEP_DELETED_MS` (по умолчанию 30 дней). Вызов из `startPruneTimer` (или отдельный таймер).
3. Заодно закрывается **P3: переиспользование id** — цикл подбора id в `createRoomForRequest` проверяет коллизию через `getRoom` (фильтр `deleted_at IS NULL`), а PK мёртвой комнаты остаётся → теоретический `23505`. После purge окно сжимается до 30 дней; дополнительно заменить проверку на `SELECT 1 FROM rooms WHERE id = $1` **без** фильтра `deleted_at`.
4. Тест в `db-room-store.test.js`: создать → удалить → purge со сдвинутым `now` → строк нет физически; свежие soft-deleted не тронуты.

**Критерий приёмки.** После purge `SELECT count(*)` по таблицам не растёт монотонно на длинном прогоне create/delete.
**Сложность:** M. **Риск:** низкий (только уже-удалённые данные).

### A4. Ghost-peer при падении подключения к LiveKit (клиент) `[x]`

**Проблема.** `joinRoom` (`apps/web/src/lib/features/room/client/room/room.ts:277`): WS-join уходит fire-and-forget, затем `await connectLiveKitRoom()`. При падении LiveKit `catch` (`room.ts:296`) не шлёт `sendVoiceLeave` → на сервере peer остаётся в `presenceRooms`. Последующий `leaveRoom()` выходит по early-return (`room.ts:405`: `joined/localStream/connecting` уже false) и тоже ничего не отправляет. В embedded-режиме (вкладка живёт) участник-призрак висит в ростере до закрытия вкладки.

**Решение.**
1. В `catch` блока `joinRoom` — если WS-join уже отправлен, вызвать `sendVoiceLeave({ roomId, peerId, sessionToken })` перед teardown.
2. Ослабить early-return `leaveRoom`: если `state.voiceRealtimeTeardown` установлен или WS-join отправлялся — leave выполняется (либо ввести явный флаг `state.voiceJoinSent`).
3. Тест: e2e или unit на `room.ts` — mock `connectLiveKitRoom` с reject → проверить, что leave отправлен и `presence` на сервере пуст (в e2e через `/api/rooms/:id/peers`).

**Критерий приёмки.** После неудачного подключения к LiveKit peer отсутствует в `GET /api/rooms/:id/peers`.
**Сложность:** S. **Риск:** низкий.

### A5. Гонка `markRoomEmpty` / `markRoomActive` `[x]`

**Проблема.** `closePeer` при опустевшей комнате шлёт `void markRoomEmpty()` не дожидаясь (`server.js:504`); мгновенный re-join делает `await markRoomActive()` (`room-runtime.js:234`). Если active коммитится первым, отставший empty ставит `empty_since = COALESCE(NULL, now)` занятой комнате → через `ROOM_IDLE_TTL_MS` (15 мин) `pruneRooms` мягко удаляет временную комнату с живыми людьми (голос через LiveKit живёт, чат/токены отдают 404).

**Решение** (любой из вариантов, предпочтителен 1):
1. **Проверка в SQL:** `markRoomEmpty` ставит `empty_since` только если комната действительно пуста — но пустота живёт в памяти процесса, не в БД. Поэтому: перед UPDATE в `closePeer` перепроверять `room.peers.size === 0` **внутри** `.then()` продолжения (после await), а сам вызов сделать последовательным: `await`-ить `markRoomEmpty` в `closePeer` нельзя (sync-функция) → вынести в очередь: `roomEmptyQueue.set(roomId, promise)`, и `joinVoiceRoom` перед `markRoomActive` делает `await roomEmptyQueue.get(roomId)`.
2. Альтернатива проще: в `markRoomEmpty` передавать `expectedUpdatedAt`/версию и делать optimistic-check; или после `markRoomActive` в `joinVoiceRoom` повторно вызвать `markRoomActive` отложенно (грубая, но дешёвая перестраховка).
3. Тест: unit на последовательность `closePeer` → сразу `joinVoiceRoom` → в БД `empty_since IS NULL`.

**Критерий приёмки.** Стресс-тест leave/join × 100 итераций не оставляет `empty_since` у занятой комнаты.
**Сложность:** M. **Риск:** средний (тонкая синхронизация, нужен аккуратный тест).

---

## Фаза B — корректность, видимая пользователю

### B1. Пробрасывать `error`-конверты WS в клиент `[x]`

**Проблема.** `parseRealtimeEvent` (`apps/web/src/lib/api/realtime.ts:73`) возвращает `null` для `type === 'error'` — ошибки `room.join` (`invalid_session`, `join_failed`, `room_full` в error-форме) молча теряются, UI виснет в «connecting».

**Решение.**
1. Добавить в `RealtimeEvent` вариант `{ type: 'error'; payload: { code: string; message: string; id?: string } }`; в `parseRealtimeEvent` маппить error-конверт вместо дропа.
2. В `handleVoiceRealtimeEvent` (`room.ts`) обработать: показать toast, для `invalid_session`/`join_failed` — выполнить teardown как в catch (включая A4-leave), статус `error`.
3. В лобби-подписчиках (`room-realtime.ts`) — минимум `console.warn` + сброс pending-состояний.
4. Тест: `v2-ui-contract` или unit на parse; e2e — join с битым токеном показывает ошибку, а не вечный спиннер.

**Сложность:** S. **Риск:** низкий.

### B2. Скользящая сессия должна скользить `[x]`

**Проблема.** `getSessionUser` (`apps/api/src/lib/user-store.js:185`) обновляет только `last_seen_at`; `expires_at` не продлевается → активного пользователя разлогинивает ровно через 30 дней. Комментарий «sliding touch» противоречит коду.

**Решение.**
1. В touch-запросе продлевать: `UPDATE sessions SET last_seen_at = $2, expires_at = GREATEST(expires_at, $3)` где `$3 = now + sessionTtlMs`. Троттлинг: продлевать не чаще раза в час (сравнить `last_seen_at`), чтобы не писать на каждый запрос.
2. Опционально: абсолютный потолок жизни сессии (например, 180 дней от `created_at`) — решить и зафиксировать в README.
3. Обновить Set-Cookie: `Max-Age` при продлении не переустанавливается (cookie переживёт по своему max-age) — либо переустанавливать cookie при продлении, либо задать cookie `Max-Age` заведомо больше и полагаться на серверный `expires_at`. Выбрать второе (проще и безопаснее: сервер — источник истины).
4. Тест в `user-store.test.js`: сессия с `expires_at` через 1 день + touch → `expires_at` сдвинулся на TTL.

**Сложность:** S. **Риск:** низкий.

### B3. Убрать дублирование мутации peer-состояния (HTTP `/api/state` vs WS `room.peer.update`) `[x]`

**Проблема.** Два параллельных пути с уже разъехавшейся строгостью: WS-путь проверяет `connection.activeVoice` (`room-runtime.js:280`), HTTP (`server.js:1098`) — нет. Любая следующая правка забудет один из путей.

**Решение.**
1. Проверить клиента: `postState()` (`client/room/presence.ts`) — куда шлёт. Перевести на WS `room.peer.update` полностью (соединение при активном голосе гарантированно есть).
2. HTTP `/api/state` — один релиз пометить deprecated (лог при использовании), затем удалить вместе с тестами на него; либо удалить сразу, если desktop-клиент не использует HTTP-путь (проверить `apps/web/src/lib/api/desktop.ts` и VoiceRoomDesktop).
3. Обновить тесты `ws-duplicate-events`, `realtime-presence`.

**Сложность:** M. **Риск:** средний (нужно убедиться, что desktop-обёртка не ходит по HTTP-пути).

### B4. Чат: запретить постинг без присутствия/сессии (перенесено из security-прохода) `[x]`

**Проблема.** `handleRoomChatPost` (`server.js:1158`): без `peerId` и без сессии создаётся эфемерный `chat-…` peer с произвольным `name` из тела — спам/имперсонация имени в любой комнате по roomId.

**Решение.**
1. Требовать: либо активный peer комнаты (валидный `peerId`+`sessionToken`), либо залогиненного пользователя. Анонимный «прохожий» без присутствия — 403.
2. Проверить, что превью-чат лобби только читает (`GET /chat`, WS preview) — он не пострадает.
3. Обновить `chat.test.js`: кейс «гость без присутствия → 403».

**Сложность:** S. **Риск:** низкий (сузить, не расширить).

---

## Фаза C — hardening и масштабируемость

### C1. Запинить образ LiveKit `[x]`

`docker-compose.yml:83`: `livekit/livekit-server:latest` → конкретный тег (+ по возможности digest), например `livekit/livekit-server:v1.9.x@sha256:…`. То же в `docker-compose.dev.yml:89` и `package.json` (`dev:host:livekit`). Проверить changelog LiveKit на breaking-изменения до пина.
**Сложность:** S. **Риск:** низкий.

### C2. Лимиты для гостевых WS + maxPayload `[x]`

**Проблема.** `rejectOverLimit` действует только на авторизованных (`ws-handler.js:90`); гость может открыть неограниченно много соединений (рост памяти). `app.register(fastifyWebsocket)` без опций → дефолтный `maxPayload` ws (100 MiB) — один гигантский фрейм на парсинг.

**Решение.**
1. `fastifyWebsocket` с `options: { maxPayload: 64 * 1024 }` (входящие конверты — короткий JSON).
2. Пер-IP лимит гостевых соединений в `registry` (например, `MAX_GUEST_STREAMS_PER_IP=8`): ключ — `getClientIp(req, TRUST_PROXY)`, передавать ip в `addGuestConnection`.
3. Тесты в `ws.test.js`: 9-е гостевое соединение с одного IP отклоняется кодом 4429; фрейм > лимита закрывает сокет.

**Сложность:** M. **Риск:** низкий.

### C3. Джиттер реконнекта `[x]`

`realtime.ts:136`: `delay = min(MAX, BASE * 2^attempt)` → после рестарта API все клиенты стучатся синхронными волнами. Добавить full jitter: `delay = random(0.5, 1.0) * min(MAX, BASE * 2^attempt)`.
**Сложность:** S. **Риск:** нулевой.

### C4. `broadcastRoomDetail`: индекс подписок вместо полного обхода `[x]`

**Проблема.** `room-runtime.js:93` обходит **все** соединения на каждое room-событие → O(connections × events).

**Решение.** В `registry` вести `Map<roomId, Set<connection>>`, обновляемую в `subscribePreview`/`unsubscribePreview`/`joinVoiceRoom`/`cleanupConnection`; `broadcastRoomDetail` итерирует только подписчиков комнаты. Инвариант очистки — на `removeConnection`.
**Сложность:** M. **Риск:** средний (легко протечь Set — покрыть тестом на отписку/закрытие).

### C5. Rate-limiter: prune O(1) вместо O(n) на каждый check `[x]`

`rate-limit.js:30`: полный обход Map на каждый вызов. Заменить на ленивую очистку: чистить не чаще раза в `windowMs` (хранить `lastPruneAt`), сам check трогает только свой ключ.
**Сложность:** S. **Риск:** нулевой.

### C6. Single-instance: зафиксировать или устранить `[x]`

**Проблема.** Всё рантайм-состояние in-memory (rate-limit, `presenceRooms`, POW-challenges, WS-реестр): горизонтальное масштабирование API невозможно, рестарт обнуляет лимиты и challenge'и.

**Решение (двухшаговое).**
1. Сейчас: явный раздел в `README.md`/`DESIGN.md` — «API = ровно один инстанс; масштабирование требует выноса состояния (Redis) и/или sticky-роутинга WS». POW-secret (`crypto.randomBytes(32)` на процесс) при рестарте инвалидирует выданные challenge'и — минимум задокументировать; опционально `POW_SECRET` из ENV, чтобы challenge переживал рестарт.
2. Потом (если понадобится масштаб): отдельный план — Redis для rate-limit/POW, pub/sub для presence. Вне скоупа этого документа.

**Сложность:** S (шаг 1). **Риск:** нулевой.

### C7. Гармонизировать CSP страницы с CSP API (перенесено из security-прохода) `[ ]`

`svelte.config.js`: `style-src 'unsafe-inline'` и `connect-src ws: wss:` (любые хосты) против строгого CSP API (`server.js:190`). Svelte 5 обычно совместим с nonce/hash-подходом SvelteKit (`mode: 'hash'` уже включён — проверить, какие инлайны требуют `unsafe-inline`, вероятно scoped-стили компилируются в файлы и директиву можно сузить). `connect-src` сузить до self + LiveKit-домен (прокинуть через env в build или отдавать meta с API).
**Сложность:** M. **Риск:** средний (легко сломать стили/подключение — проверять e2e и вручную).

---

## Фаза D — наблюдаемость, техдолг, документация

### D1. Логи и метрики API `[ ]`

**Проблема.** `fastify({ logger: false })`, только точечные `console.error`; метрик нет (у LiveKit prometheus есть, у API нет). Диагностика прод-инцидента невозможна.

**Решение.**
1. Включить fastify-логгер (pino) с уровнем из `LOG_LEVEL` (prod: `info`, JSON в stdout — docker собирает). Отключить лог health-чеков (шум каждые 10 с).
2. Минимальный `/api/metrics` (prometheus text): счётчики HTTP по маршрутам/статусам, активные WS (всего/гости), размер `presenceRooms`, длительность prune/purge, ошибки пула pg. Биндить только на внутренний интерфейс или закрыть в Caddy (как LiveKit-метрики в MONITORING_AGENT.md).
3. Согласовать с `docs/MONITORING_AGENT.md` — добавить API-метрики в существующий стек.

**Сложность:** M. **Риск:** низкий.

### D2. Single-flight для кэша desktop-релиза `[x]`

`handleDesktopLatest` (`server.js:1575`): при истёкшем кэше параллельные запросы все идут в GitHub (stampede). Хранить promise текущего fetch и переиспользовать его для конкурентных вызовов.
**Сложность:** S. **Риск:** нулевой.

### D3. Убрать `document.execCommand` fallback копирования `[x]`

`room.ts:490` (`copyText`): fallback на deprecated `execCommand('copy')`. Целевые браузеры (secure context, современные) поддерживают `navigator.clipboard`; fallback оставить только как toast «Скопируйте вручную: <код>» либо удалить. Висит с аудита 2026-06-10.
**Сложность:** S. **Риск:** нулевой.

### D4. Распутать import-циклы room-клиента `[ ]`

GRAPH_REPORT: 3–5-файловые циклы вокруг `client/room/participants.ts ↔ services/* ↔ ui/*` (полный список — `graphify-out/GRAPH_REPORT.md`, раздел Import Cycles). Не баг, но блокирует чистые границы модулей и совпадает по зоне с планом Svelte-миграции (`docs/ROOM_SVELTE_MIGRATION_PLAN.md`) — **делать в рамках очередной фазы миграции**, не отдельным рефакторингом:
- вынести общие типы/стейт в `core/` (без обратных импортов),
- события UI → колбэки/шина вместо прямых импортов ui из services.

**Сложность:** L (растянуто по миграции). **Риск:** средний.

### D5. User enumeration: осознанное решение `[x]`

Register отдаёт 409 «логин занят», friends-search раскрывает пользователей. Для соц-приложения это, вероятно, приемлемо by design → зафиксировать решение одной строкой в DESIGN.md (или ужесточить: generic-ошибка на register + rate-limit на search, уже есть). Решение за владельцем.
**Сложность:** S.

### D6. Документация ENV `[x]`

Появившиеся/затронутые переменные (`RETENTION_*`, `MAX_GUEST_STREAMS_PER_IP`, `LOG_LEVEL`, `POW_SECRET`, пиненые образы) — добавить в README-раздел «Environment и секреты» и в `docker-compose.yml` с дефолтами.
**Сложность:** S.

---

## Сводная таблица

| # | Пункт | Прио | Слож. | Зона |
|---|-------|------|-------|------|
| A1 | Graceful shutdown + node PID 1 | P1 | M | api, docker |
| A2 | pruneRooms из горячего пути | P1 | M | api |
| A3 | Retention/hard-delete (+id reuse) | P1 | M | api, db |
| A4 | Ghost-peer при падении LiveKit | P1 | S | web |
| A5 | Гонка markRoomEmpty/Active | P1 | M | api |
| B1 | Error-конверты WS в UI | P2 | S | web |
| B2 | Скользящая сессия | P2 | S | api |
| B3 | Унификация /api/state → WS | P2 | M | api, web |
| B4 | Чат без присутствия → 403 | P2 | S | api |
| C1 | Пин образа LiveKit | P2 | S | docker |
| C2 | Лимиты гостевых WS + maxPayload | P2 | M | api |
| C3 | Джиттер реконнекта | P3 | S | web |
| C4 | Индекс подписок broadcastRoomDetail | P3 | M | api |
| C5 | Rate-limiter prune O(1) | P3 | S | api |
| C6 | Single-instance: документировать | P3 | S | docs |
| C7 | CSP страницы | P3 | M | web |
| D1 | Логи + метрики API | P2 | M | api |
| D2 | Single-flight кэша релиза | P3 | S | api |
| D3 | Убрать execCommand | P3 | S | web |
| D4 | Import-циклы (в Svelte-миграции) | P3 | L | web |
| D5 | Enumeration: решение | P3 | S | docs |
| D6 | Документация ENV | P3 | S | docs |

## Правила выполнения

- Ветки `fix/…` / `feat/…` от `develop`; PR в `develop`, squash + удаление ветки.
- Коммиты атомарно по сфере: `fix(api): …`, `fix(web): …`, `test(api): …`, `chore(docker): …`.
- Каждый пункт закрывается только с тестом (где применимо) и зелёным `npm run check && npm test`.
- После правок кода: `graphify update .`.
- Фаза A перед релизом обязательна целиком; B/C/D — можно резать по релизам.
