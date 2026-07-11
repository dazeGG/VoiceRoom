# План рефакторинга фолбэка комнат (буква вместо emoji/пресетов)

Статус: application-фаза реализована 2026-07-11 в PR #44. Contract-миграция БД
выполняется отдельным PR только после полного выката application-фазы.
Выполняется ПЕРЕД аватарками (см. [AVATARS_PLAN.md](AVATARS_PLAN.md)) — чистит место под них.
Цель: полностью удалить визуальную идентичность комнат (emoji + иконки + цветовые пресеты).
Фолбэк комнаты — первая буква названия на статичном тёмно-зелёном фоне, форма squircle
(квадрат со скруглёнными углами).

## Решения

1. **Все комнаты без картинки выглядят одинаково** (буква на статичном токене) — Discord-паттерн,
   принят осознанно: различие только по названию, мотивация загрузить аватарку.
2. **Цвета людей не трогаем.** `users.avatar_color_key`, `room_peer_identities.avatar_color_key`,
   `avatarColorForPeerId()` в room-store — это идентичность пользователей/гостей, остаётся как есть.
3. **Удаление данных — отдельная contract-фаза.** Этот PR только прекращает чтение/запись
   legacy-колонок. Удаление колонок безвозвратно удалит пресеты и не считается data rollback.
4. Фон фолбэка — новый CSS-токен рядом со стеком paper (тема — hue 112, зелёная):
   `--room-avatar-bg`, ориентир `oklch(24% 0.05 112)`, финальное значение подобрать по месту.

## Поверхность удаления

| Слой | Что удаляется |
|---|---|
| `packages/shared/src/validation.js` (+`.d.ts`) | `cleanRoomEmoji`, `cleanRoomIconKey`, `cleanRoomColorKey`, `cleanRoomPresetKey`, `ROOM_PRESETS`, `getRoomPreset` |
| `packages/shared/src/realtime.js` | поле `emoji` в конверте превью комнаты (строка ~97) |
| `apps/api/src/lib/room-store.js` | `normalizeRoomVisuals()`, поля emoji/iconKey/colorKey в проекциях и SQL |
| `apps/api/src/server.js` | приём визуальных параметров в create/update комнаты |
| БД (`rooms`) | колонки `emoji`, `room_icon_key`, `room_color_key` + check-констрейнты (`name` остаётся!) |
| Web: диалоги | `CreateRoomDialog.svelte` (пикер emoji/цвета), `RoomSettingsDialog.svelte` |
| Web: лобби | `VoiceHome.svelte`, `VoiceCallWidget.svelte`, `RoomViewHeader.svelte`, `lobby-format.ts`, модели `rooms.ts`, `room-realtime.ts`, `api/rooms.ts` |
| Web: комната | `RoomTopbar.svelte`, `client/room/room.ts`, `client/net/api.ts`, `client/core/types.ts`, `client/room/lifecycle.ts` |
| CSS | стили пикера/иконок в `lobby.css`, `lobby-v2.css`, `dialog.css`, `layout.css` |

## Фазы

### Фаза 0 — Новый фолбэк-рендер
- Токен `--room-avatar-bg` в `shared/styles/app.css`.
- `Avatar.svelte`: проп `shape: 'circle' | 'squircle'` (дефолт `circle`) + возможность статичного
  фона для комнат. Буква из названия комнаты, `?` при пустом имени.
- Все места рендера комнаты (лобби, сайдбар, шапки) переводятся на `<Avatar shape="squircle">`.
- **Verify:** `check` + `build`; визуально в превью — лобби, сайдбар, шапка комнаты.

### Фаза 1 — Web: выпилить пикеры и потребителей
- `CreateRoomDialog`/`RoomSettingsDialog`: убрать шаг выбора emoji/цвета.
- Убрать `emoji`/`roomIconKey`/`roomColorKey` из типов, моделей и API-клиентов web.
- **Verify:** `check` + `build`; grep по `roomIconKey|roomColorKey|emoji` в `apps/web` —
  только нерелевантные совпадения (emoji в чате не трогаем).

### Фаза 2 — API + shared
- `server.js`: create/update больше не принимают визуальные параметры; лишние поля от старых
  клиентов молча игнорируются (совместимость на время деплоя).
- `room-store.js`: удалить `normalizeRoomVisuals`, вычистить проекции и SQL.
- `realtime.js`: убрать `emoji` из summary-конверта; проверить потребителя `room-realtime.ts`.
- `validation.js`/`.d.ts`: удалить хелперы пресетов.
- **Verify:** `npm run check` (api) + `npm test` — тесты уже переписаны или падения ожидаемы
  и чинятся в Фазе 4.

### Фаза 3 — Contract-миграция БД (отдельный PR после выката PR #44)
- Drop констрейнтов `rooms_room_icon_key_check`, `rooms_room_color_key_check`,
  затем колонок `emoji`, `room_icon_key`, `room_color_key`.
- Down: восстановить только схему с дефолтами (`headphones`/`blue`/`''`) и констрейнты;
  исходные значения не восстанавливаются.
- Дополнить `migration-schema.test.js`.
- **Verify:** `db:migrate` + `db:rollback` на тестовой БД, `npm test`.

### Фаза 4 — Тесты и финальная чистка
- `room-crud.test.js`: удалить пресет-хелперы (`presetFromEmoji`, `presetFromVisualKeys`,
  `emojiFromIconKey`, локальный `normalizeRoomVisuals`), переписать ассерты.
- Финальный grep по актуальному application-source: `cleanRoomEmoji|ROOM_PRESETS|roomIconKey|roomColorKey` — пусто.
  SQL-имена `room_icon_key|room_color_key` до contract-фазы законно остаются в исторической миграции и schema-тестах.
- `graphify update .`
- **Verify:** `check` + `test` + `build` зелёные.

## Риски

- **Realtime-конверт меняется** (уходит `emoji`): старые вкладки после деплоя должны терпимо
  переживать отсутствие поля — проверить, что клиент не падает на `undefined`.
- **Конфликт с веткой `feature/push-notifications`**: там незакоммичен `migration-schema.test.js`
  и `server.js`. Ветку рефакторинга создавать от актуальной базы после мержа/стэша той работы.
- Комнаты без аватарки визуально неразличимы — принято (см. Решения, п.1).
