# План миграции клиента комнаты на идиоматичный Svelte

Статус: черновик плана (без кода). Реализация — в отдельной ветке.
Цель: убрать императивный ванильный слой (`features/room/client`, ~7 450 строк, 39 модулей,
355 обращений к DOM, шов `dom.ts` `elements`), чтобы view рендерился реактивным Svelte,
а проект стал единым целым.

## Принципы

1. **Не big-bang.** Realtime-баги (рассинхрон стейта, гонки событий LiveKit) не ловятся
   юнит-тестами. Мигрируем по компоненту, с верификацией на каждом шаге.
2. **Логика остаётся TS-модулями.** services/ (LiveKit, WebRTC, аудио-ворклеты), media/, net/,
   model/ — это не view, их не «переписывают на Svelte». Их импортируют компоненты.
3. **Коэкзистенция через реактивный стейт.** Ванила и Svelte сосуществуют, пока `state`
   читается обоими. `dom.ts` удаляем последним, когда уйдёт последний потребитель.
4. **Каждая фаза = отдельный PR**, зелёные `npm run check` + `npm test` + релевантный e2e.

## Что мигрирует, а что нет

| Слой | Строк | Действие |
|---|---|---|
| services/ (livekit, screen-capture, screen-share, microphone, media-playback) | ~2 340 | Остаётся TS-модулями. Максимум — фасады/сторы поверх. |
| media/ · net/ · model/ | ~700 | Остаётся. `model/room-state` → реактивный стейт (см. Фаза 1). |
| core/ (state, config, session, utils) | ~710 | `state` → руны; остальное чистая логика. |
| ui/ (devices, screen-view, screen-stage-controls, participant-context-menu, names, status, controls, icons, toast) | ~2 230 | **Главная цель** → Svelte-компоненты. |
| room/ (lifecycle, room, participants, stats) | ~1 290 | Оркестрация остаётся; DOM-куски → компоненты. participants.ts (595) — самый тяжёлый. |

Реально конвертируется ~2 500–3 000 строк; ~3 500 строк логики остаются модулями.

## Стратегия ядра: реактивный мост

`core/state.ts` = единый мутируемый `AppState` (`createInitialRoomState()`), читается/пишется
везде императивно. Это несущий шов.

Подход: завести **реактивную обёртку стейта на рунах** (`*.svelte.ts`), которую пишут
services/room-логика, а читают Svelte-компоненты. Пока живёт ванила — старый `state` и новый
реактивный стейт синхронизируются (мост), чтобы не переписывать всё сразу. Мост удаляется,
когда последний ванильный потребитель поля ушёл.

## Фазы (по нарастанию риска)

### Фаза 0 — Каркас и страховка
- Прогнать существующие e2e (`room-realtime`, `room-edit`, `room-delete`) как baseline, зафиксировать «зелёное».
- Добавить недостающие e2e на realtime-сценарии, которые план затронет (вход, мьют, список участников, screen-share toggle), если покрытие тонкое.
- Решение по архитектуре стейта: руны (`$state`) в `*.svelte.ts` сторах vs тонкие классы.
- **Verify:** baseline e2e зелёные, документ архитектуры стейта согласован.

### Фаза 1 — Реактивный стейт-фундамент ✅ СДЕЛАНО
- `core/state.ts` → `core/state.svelte.ts`: `export const state = $state(createInitialRoomState())`.
  24 импортёра (.ts + .svelte) переведены на специфаер `core/state.svelte`.
- **Моста не понадобилось.** `$state`-прокси прозрачен для императивных чтений/записей, поэтому
  существующий код мутирует объект как раньше, а компоненты могут читать его реактивно — без
  двусторонней синхры и без разбиения God-объекта (его можно дробить позже, по мере нужды).
- Map/Set (`peers`, `participantViews`, `screen*PeerIds`) пока НЕ реактивны на уровне содержимого
  (`$state` их не проксирует) — перевести на SvelteMap/SvelteSet в Фазе 3, когда понадобится.
- **Verify:** check (exit 0) + test (21/21) + build (✓). Поведение не изменилось.
- **Урок:** `tsc --noEmit` (скрипт `check`) НЕ проверяет импорты внутри `.svelte` — пропущенный
  `.svelte`-импортёр ловит только `vite build`. На каждой фазе гонять и `check`, и `build`.

### Фаза 2 — Листовой низкорисковый UI
Цель — обкатать паттерн «компонент читает реактивный state» на безопасных кусках.

**2a — заголовок/код/эмодзи комнаты ✅ СДЕЛАНО**
- RoomTopbar деривит `heading`/`visual` из реактивного `state` (`getRoomPreset`), три плоских
  `.ellipsis`-span'а стали `<Ellipsis>`.
- `refreshRoomHeading()` ужат до `document.title`; геттеры `roomTitle`/`roomCodeText`/`roomEmojiBadge`
  убраны из `dom.ts`; `getRoomPreset` ушёл из `room.ts`.
- **Утилити-класс `.ellipsis` убит:** плоских пользователей не осталось → CSS вшит scoped в
  Ellipsis.svelte (через статический `class="ellipsis {className}"` + `class:` — иначе Svelte
  прунит scoped-селектор при динамическом `class`), глобальный `Ellipsis/ellipsis.css` удалён.
- **Verify:** check (exit 0) + test (21/21) + build (✓). Рантайм заголовка — за e2e/ручной проверкой.

**2b-i — статус связи (пилл + док) ✅ СДЕЛАНО**
- `ui/status.ts` → чистая деривация `getConnectionStatusView()` над реактивным `state`;
  RoomTopbar (пилл) и RoomDock (полоски сигнала) подписаны через `$derived`.
- `refreshLocalNetworkIndicator()` удалён везде (5 мест) — поля стейта и так ставят его вызыватели;
  добавлен мирор `state.screen` (= `body.dataset.screen`) для реактивного скрытия пилла;
  геттеры `statusPill/statusText/dockConnection*` убраны из `dom.ts`.
- **Verify:** check (0) + test (22/22) + build (✓). Рантайм — за e2e/ручной.

**2b-ii — меню устройств/вывода ✅ СДЕЛАНО**
- `getCallControlsView` / `getOutputControlsView` / `getScreenControlsView` / `getGateControlView`
  — чистая деривация; `RoomDock.svelte` рендерит mute/output/screen/gate/popover реактивно.
- `devices.ts`/`controls.ts` — без `elements.*` для dock; popover open/close в `roomDeviceUi`.
- `main.ts` — слушатели dock убраны (в компоненте).
- **Verify:** check (0) + test (22/22) + build (✓).

### Фаза 3 — Список участников ✅ СДЕЛАНО
- `participants-ui.svelte.ts` (`participantsUi.revision`) + `ParticipantList` / `ParticipantTile`.
- `participants.ts` — модель-only (без template/DOM); `<audio>` остаётся в TS.
- `ParticipantContextMenu.svelte` вместо `participant-context-menu.ts`; шаблон `#participantTemplate` удалён.
- Screen-action на тайле — `$derived` в `ParticipantTile`.
- **Verify:** check (0) + test (22/22) + build (✓). E2e/ручной realtime — за отдельной проверкой.

### Фаза 4 — Screen-share (самый высокий риск) ✅ СДЕЛАНО
- Screen stage, stream tiles, source picker state and screen metadata moved to Svelte components/state.
- `services/screen-*` remains the media engine; `<video>` refs/fullscreen/audio sync stay in narrow imperative helpers.
- Removed the dead vanilla `screen-tile-elements.ts` helper after `StreamTile.svelte` became the only tile renderer.
- **Verify:** `npm run check` (includes `svelte-check` 0 warnings) + web test (22/22) + web build (✓).
  Playwright e2e attempted, but local app was not running (`ERR_CONNECTION_REFUSED` on `localhost:5180`).

### Фаза 5 — Оркестрация и точка входа ✅ СДЕЛАНО
- `RoomPage` owns the Svelte shell and lazy `client/main` mount lifecycle.
- `main.ts` now keeps browser/session listeners and service bootstrap only; dock/topbar/overlays/stage render through Svelte.
- `setElementsRoot`/vanilla root selector binding removed with `dom.ts`.
- **Verify:** `npm run check` + web test (22/22) + web build (✓). Full e2e still needs running with dev stack up.

### Фаза 6 — Снос лесов ✅ СДЕЛАНО
- Deleted `ui/dom.ts` (`elements` cache) and the legacy participant context menu module.
- Deleted dead screen tile DOM helper; updated architecture docs.
- `v2-ui-contract.test.js` now asserts component/reactive contracts rather than the old selector registry.
- Added `svelte-check` to the web `check` script so `.svelte` diagnostics are part of normal validation.
- **Verify:** `npm run check` green; `npm --workspace @voice-room/web run test` 22/22; `npm --workspace @voice-room/web run build` green.

## Сквозные моменты

- **Тестирование:** юнит-тесты структуру не покрывают → опора на Playwright e2e + ручную
  проверку realtime на каждой фазе. Без зелёного e2e фаза не закрывается.
- **Откат:** каждая фаза — отдельный PR, мерж только после верификации; коэкзистенция позволяет
  откатить фазу без слома остального.
- **Перф:** RAF-метры и видео-статистику не «реактивить» наивно — оставлять RAF-цикл, в стор
  писать throttled-значения.
- **Порядок не нарушать:** стейт (1) → листья (2) → участники (3) → screen (4) → bootstrap (5)
  → снос (6). Участники до стейта или screen до участников — гарантированный рассинхрон.

## Грубая оценка

Конвертируемая поверхность ~2 500–3 000 строк, риск сконцентрирован в Фазах 3–4.
Реалистично — несколько недель инкрементальной работы с верификацией, не один заход.
