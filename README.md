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
npm test        # both API groups and the other workspaces
npm run build
npm run e2e     # Playwright, нужен запущенный dev-стек
```

`npm run test:api` runs both groups. Integration needs a reachable PostgreSQL
server and permission to create test databases. New API tests default to integration.
Before adding a file to `apps/api/test/no-db-files.json`, run the same candidates
(one repository-relative path per line) on the same checkout in both environments:

```bash
# With TEST_DATABASE_URL pointing at a real test PostgreSQL:
node scripts/ci/api-tests.mts report --files candidates.txt --out db.json
# On an isolated runner without PostgreSQL, reachable sockets or either database URL:
node scripts/ci/api-tests.mts report --files candidates.txt --out no-db.json
node scripts/ci/api-tests.mts compare-fixtures db.json no-db.json
```

Admit only files with identical passing cases, no skips or conditional cases,
and no database connection attempts.

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
