# VoiceRoom

VoiceRoom — голосовые комнаты по ссылке: голос, демонстрация экрана, камера и чат в браузере и в приложении для компьютера. Зайти можно гостем по ссылке или коду, без регистрации. С аккаунтом появляются постоянные комнаты, друзья и личные сообщения.

Работает на [voiceroom.ru](https://voiceroom.ru). Голос и видео идут через self-hosted LiveKit SFU, поэтому сервис можно развернуть у себя.

## Возможности

### Голос, экран и камера

- Комната живёт по ссылке `/r/<room-id>` или короткому коду. Временная комната создаётся в один клик, без имени и регистрации.
- Шумоподавление RNNoise, гейт микрофона с порогом, входной gain, выбор микрофона и динамика. Устройства переподключаются сами, если их выдернули или поменяли.
- Громкость каждого участника и общая громкость от 0 до 200 %, локальный мьют, глухой режим, push-to-talk и настраиваемые хоткеи.
- Демонстрация экрана в один клик: экран или окно, режимы для игр и для текста, звук стрима. Стрим смотрят на большой сцене или в плитке.
- Камера в звонке. Каждый зритель получает качество под размер своей плитки.
- Статус связи: пинг, потери, джиттер и переход на ретранслятор. TURN/TLS на порту 443 доступен после настройки оператором (по умолчанию выключен).
- Комнаты открываются и в мобильном браузере: голос, чат и просмотр чужого экрана.

### Чат

- Чат в каждой комнате и личные сообщения, с бессрочной историей и непрочитанными.
- Ответы, упоминания, реакции, картинки, превью ссылок и закреплённые сообщения в комнате.
- Редактирование и удаление, черновики, индикатор «печатает».
- Очередь отправки: можно писать следующее сообщение, не дожидаясь отправки предыдущего. Неотправленное остаётся в чате с кнопкой «Повторить».

### Люди и уведомления

- Друзья, заявки, статусы присутствия и «Отошёл» при бездействии.
- Позвать друга в комнату одним кликом (Ring).
- Центр уведомлений, Web Push, режим «Не беспокоить», мьют комнат и личных сообщений.

### Комнаты и аккаунт

- Постоянные комнаты с названием, эмодзи и аватаркой. Владелец исключает и блокирует участников (на время или навсегда) и удаляет сообщения.
- Жалобы на сообщения, которые разбирают администраторы площадки.
- Безопасность аккаунта: список устройств с завершением чужих сеансов, коды восстановления, предупреждение о входе с нового устройства, удаление аккаунта с семидневным сроком на восстановление.
- Внешний вид: графитовая тема и три цвета акцента — Volt, Ice и Coral.

## Приложение для компьютера

Приложение — это тот же VoiceRoom в собственном окне, плюс то, чего не может вкладка браузера. Скачать его можно из лобби на сайте или в [релизах VoiceRoomDesktop](https://github.com/dazeGG/VoiceRoomDesktop/releases/latest).

- **Хоткеи поверх игр.** Мьют микрофона, мьют звука и push-to-talk срабатывают, даже когда окно не в фокусе. Сочетания привязаны к физическим клавишам и не зависят от раскладки.
- **Оверлей в игре.** Поверх игры видно, кто в звонке, кто говорит и кто стримит. Работает в оконном и borderless режимах.
- **Звук стрима без эха.** Демонстрация экрана передаёт звук компьютера, но без голосов собеседников из самого VoiceRoom.
- **Звонок в трее, на панели задач и в Dock.** Микрофон, звук и выход из звонка — без открытия окна. На иконке виден счётчик непрочитанного.
- **Системные уведомления.** Клик по уведомлению открывает нужный чат.
- **Ссылки `voiceroom://`.** Ссылка на комнату из браузера открывается сразу в приложении.
- **Автозапуск** (можно свёрнутым в трей) и **автообновление**.
- **Бережёт ресурсы.** Видео, которое никто не видит, не скачивается, пока окно свёрнуто. Во время игры анимации стоят на паузе, а после сна соединение проверяется сразу.

Поддерживаются macOS 13+ (Apple Silicon и Intel) и Windows 10+ (x64). На Linux используйте браузер. Код приложения лежит в отдельном репозитории [VoiceRoomDesktop](https://github.com/dazeGG/VoiceRoomDesktop).

## Как устроено

```
apps/
  api/        Fastify API, WebSocket realtime, воркеры доставки и медиа, auth-gate LiveKit
  web/        клиент на Vue 3 (статическая сборка Vite), открывается на /app
  site/       публичный сайт на Astro: главная и страницы для поисковиков
  docs/       публичная справка для пользователей и владельцев сайтов
  admin/      админка на Vue и общем UI-ките, отдельный сайт на admin.<домен>
packages/
  shared/     общие контракты HTTP и realtime для API и веба
```

В production Caddy раздаёт публичный сайт на `/` и страницах сценариев, приложение на `/app`, `/r/<id>` и страницах входа и проксирует `/api/*` в API. Браузер с сессией и адрес `/` с параметрами (старые ссылки, уведомления) Caddy переводит на `/app`; админку он отдаёт на своём домене только сотрудникам. Данные хранятся в PostgreSQL, голос и видео идут через LiveKit SFU. Подробнее об архитектуре — в [`docs/ARCHITECTURE.md`](./docs/ARCHITECTURE.md).

## Локальный запуск

Нужны Node.js `24.18.0`, npm `11.16.0` и Docker.

```bash
npm install
npm run dev
```

`npm run dev` поднимает через `docker-compose.dev.yml` PostgreSQL, API, Vite и LiveKit. Все dev-значения заданы по умолчанию, поэтому `.env` не нужен. Приложение открывается на `http://127.0.0.1:5180`. В фоне стек запускается командой `npm run dev:up` и останавливается `npm run dev:down`.

Проверки:

```bash
npm run check   # tsc, vue-tsc, ESLint и Prettier
npm run test:api -- --fixture unit  # no PostgreSQL or database URL needed
docker compose -f docker-compose.dev.yml up -d postgres
export TEST_DATABASE_URL=postgres://voice_room:voice_room_dev@127.0.0.1:5432/voice_room_dev
npm run test:api -- --fixture integration
npm run test:api -- rooms                # весь домен, включая интеграционные тесты
npm run test:api -- rooms --fixture unit # только без БД
npm -w @voiceroom/ui-kit test
npm -w @voiceroom/call test
npm test        # both API groups and the other workspaces
npm run build
npm run e2e     # Playwright, нужен запущенный dev-стек
```

API-тест лежит в `apps/api/test/<домен>/<фикстура>/`. Домен выбирается по поведению,
которое проверяет тест, а не по первому импорту или транспорту запроса: например,
создание комнаты через HTTP относится к `rooms`. Обычно это одноимённый каталог
в `apps/api/src/domains/`. Для сквозных проверок используются `platform` (сборка
приложения, общая инфраструктура и миграции нескольких доменов), `realtime`
(сам транспорт, реестр соединений и доставка кадров) и `ops` (эксплуатация и метрики).
Общие стенды, фейки, фикстуры и вспомогательные функции остаются в `apps/api/test/`.

Без фильтра `npm run test:api` запускает обе группы всех доменов. Для `integration`
нужен доступный PostgreSQL с правом создания тестовых баз. Новый или смешанный тест
помещается в `integration`. Чтобы перенести его в `unit`, проверьте тот же набор
кандидатов (один путь от корня репозитория на строку) в двух окружениях:

```bash
# With TEST_DATABASE_URL pointing at a real test PostgreSQL:
node scripts/ci/api-tests.mts report --files candidates.txt --out db.json
# On an isolated runner without PostgreSQL, reachable sockets or either database URL:
node scripts/ci/api-tests.mts report --files candidates.txt --out no-db.json
node scripts/ci/api-tests.mts compare-fixtures db.json no-db.json
```

В `unit` допускаются только файлы с одинаковыми прошедшими сценариями, без
пропусков, условных сценариев и попыток подключения к БД. Для CI деления на
домены нет: если выбран API, выполняются все домены.

Поведение компонентов кита проверяется в `packages/ui-kit/test/`, движка звонков —
в `packages/call/test/`. Тесты оболочек приложения остаются в Web; независимые
тесты функций сгруппированы в `apps/web/test/features/`. Проверки Caddy, edge и
контрактов публикации остаются рядом с их Web-фикстурами. Команды пакетов сохраняют
исходное окружение каждого файла (Node или jsdom).

Для проверки массового переноса сравните полные отчёты раннеров из двух рабочих
деревьев: `node scripts/ci/compare-test-files.mts --before before.json --after after.json --base <до> --tested <после>`.
Формат отчёта: Git `tree` (результат `git rev-parse 'HEAD^{tree}'`) и массив `files`.
Каждая запись содержит путь `file` от корня, `project`, `environment`, `fixture` и
счётчики `tests`, `passed`, `skipped` (включая todo). Берите счётчики из событий
`test:summary` Node и из `assertionResults` JSON-репортера Vitest; сохраняйте проект и
окружение, а не имя нового каталога. Сравнение сверяет обе выборки с Git, а затем
проверяет каждый файл по парам переименований. Это проверка переноса, не источник
для отбора тестов в CI.

### CI verification and reuse

On a PR into `develop`, CI compares the base tree with the tested merge tree. An
Admin leaf keeps repository checks and the Admin workspace test step; an API edit
runs both API fixtures, the coverage verdict and G05. CI follows the measured
non-API sources' imports in both Git trees; a neighbouring chat component alone
does not trigger API coverage. A frontend unit test file selects its workspace,
not a browser fixture. Non-test helpers can still be browser inputs. Shared configuration,
unknown paths and unresolved inputs select the full inventory. The changes job
reports the reason, selected workspaces and browser groups. Reproduce a decision
locally with `node scripts/ci/changed-components.mts <base-sha> <tested-sha>`.

On a full run, **Voice room join smoke** runs the original 10 specs (including
`room-voice`), while **Voice feature journeys** runs the other eight in parallel
on a separate runner. Each job starts its own CI Compose stack with a real SFU
and disposable PostgreSQL. On develop PRs, the second job runs only when paths
select context menus, reactions, room lifecycle, localization, desktop
boundaries or microphone stalls. Shared inputs can select both jobs. Widget and Meet
keep their isolated stacks. Changes to the kit, styles, focus surfaces or the audit
fixture also select **Cross-browser UI audit**: Chromium, WebKit and Firefox on
one runner. Run it locally with
`npm -w @voiceroom/web run e2e -- --config playwright.ui-audit.config.ts --workers=1`.

The final **Git Flow policy** checks actual job results and completed test groups.
PRs into `main` and unverified pushes to `develop` require a fixed full suite.
A matching same-repository PR marker binds the parent, tested tree, successful
attempt and versioned selection digest; a hit still runs applicable installer,
Site and Docs checks. Publication requires a successful push policy **and** a
changed component. A full verification does not request a full deployment.

For review only, run `node scripts/ci/replay-test-routing.mts --repo dazeGG/VoiceRoom --base develop --last-merged 20`.
Its timing estimates are not hosted measurements. Compare the first real UI-only
PR against #345 (8:07); if it is not faster, route all changes to the full
inventory and bump the selector version before investigating. Keep policy and
publication guards in place.

API, Web, Admin, Widget и Meet выпускаются отдельными сериями. Ветки, коммиты и теги описаны в [`docs/GIT_FLOW.md`](./docs/GIT_FLOW.md). Изменения по версиям — в [GitHub Releases](https://github.com/dazeGG/VoiceRoom/releases).

## Self-hosting

Для временных видеовстреч на своём Linux-сервере установите VoiceRoom Meet одной командой. В [руководстве по Meet](./apps/docs/src/content/docs/self-hosting/install.md) описаны установка, подключение своего домена, DuckDNS или deSEC и проверка первого звонка.

Для аккаунтов, постоянных комнат, истории чатов и админки используйте [установку полного стека](./docs/SELF_HOSTING.md#full-stack-installation). Переменные окружения, Docker, TURN, бэкапы, CI/CD и миграции описаны в [`docs/SELF_HOSTING.md`](./docs/SELF_HOSTING.md), модель доступа — в [`docs/SECURITY.md`](./docs/SECURITY.md).

## Документация

- [Публичная справка VoiceRoom](https://docs.voiceroom.ru) содержит инструкции по звонкам, комнатам, звуку и экрану, приложению для компьютера и виджету.
- Архитектура и разработка: [архитектура](./docs/ARCHITECTURE.md), [дизайн-система](./DESIGN.md) (живые компоненты — `npm run storybook`), [Git Flow](./docs/GIT_FLOW.md), [производительность](./docs/PERFORMANCE.md), [логирование](./docs/LOGGING.md).
- Эксплуатация и безопасность: [self-hosting](./docs/SELF_HOSTING.md), [безопасность](./docs/SECURITY.md), [LiveKit gate](./docs/LIVEKIT_GATE.md), [юридические вопросы](./docs/LEGAL.md).
- Медиа: [запуск и диагностика трансляций](./docs/SCREEN_STARTUP.md).
- Мобильные контракты: [удаление аккаунта](./docs/MOBILE.md#android-account-deletion-cookie-response-boundary), [жизненный цикл Ring](./docs/MOBILE.md#ring-lifecycle-for-android-v1), [жалобы пользователей](./docs/MOBILE.md#user-reporting-mobile-v1-backend-slice).

## Лицензия

MIT License. Vendored RNNoise assets в `packages/call/assets/rnnoise/` распространяются под собственной MIT-лицензией в `packages/call/assets/rnnoise/LICENSE`. Атрибуция шрифтов, эмодзи, GeoIP и библиотек — на странице `/licenses`.
