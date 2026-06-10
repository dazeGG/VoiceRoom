# Voice Room

Voice Room - голосовая комната по ссылке с демонстрацией экрана. Комната живет в URL вида `/r/<room-id>`, Node.js приложение хранит состояние комнат/сессий и выдает LiveKit JWT, а голос и экран идут через self-hosted LiveKit SFU.

## Возможности

- Комната по ссылке или короткому коду.
- Голос через self-hosted LiveKit SFU.
- Демонстрация экрана без ручных настроек в вебе: старт по умолчанию `720p 30 FPS`, дальше приложение само снижает/возвращает качество по sender stats и состоянию соединения.
- Внутренние профили стрима для автоадаптации (`540p`, `720p`, `1080p` при `15/30 FPS`) без UI выбора качества в браузере.
- Просмотр стрима на основной сцене или сворачивание обратно в плитку.
- Noise suppression, mic gate, выбор input/output устройств и локальный meter микрофона.
- Защита создания комнат: rate limit, proof-of-work challenge и лимит пустых комнат.

## Архитектура

```
server.js          HTTP API + SSE + раздача dist/ (без фреймворка)
lib/               серверные модули: config, validation, pow, rate-limit
src/               клиент (TypeScript, Vite)
  main.ts          входная точка: wiring DOM-событий и стартовый роутинг
  core/            нижний слой без DOM-логики: config, types, state, session, settings, utils
  net/             HTTP-примитивы: api (fetch/post), pow (proof-of-work)
  media/           захват и обработка медиа: microphone (гейт, RNNoise),
                   screen-capture, playback (output-устройства, unlock), cues, meters, profiles
  room/            домен комнаты: room (join/leave/SSE), livekit, participants,
                   presence (postState), screen-share (статы, автоадаптация), stats
  ui/              DOM-слой: dom (elements), controls, devices, names,
                   screen-view (сцена, плитки), status, toast
public/            статика как есть: воркеты, rnnoise (wasm), icon
test/              unit-тесты серверных модулей (node:test)
```

Правила слоёв: `core` ни от кого не зависит, `net` зависит только от `core`. `media`, `room` и `ui` могут ссылаться друг на друга (циклы только на уровне вызовов — top-level инициализация остаётся ацикличной).

## Требования

- Node.js `20.20.2`
- npm `10.8.2`
- Docker, если нужно локально поднять LiveKit или собрать production image

## Локальный запуск

Клиент собирается Vite (TypeScript, `src/`), сервер — Node.js без сборки (`server.js` + `lib/`).

Терминал 1 — LiveKit в dev-режиме:

```bash
npm run dev:livekit
```

Терминал 2 — API-сервер:

```bash
npm install

export LIVEKIT_URL=ws://127.0.0.1:7880
export LIVEKIT_API_KEY=devkey
export LIVEKIT_API_SECRET=secret
npm run dev
```

Терминал 3 — Vite dev-сервер клиента (проксирует API на :3000):

```bash
npm run dev:web
```

Откройте `http://localhost:5173`. `localhost` считается безопасным browser context, поэтому микрофон и screen capture работают без HTTPS.

Production-режим без Docker: `npm run build`, затем `npm start` — сервер раздаёт собранный клиент из `dist/` на `http://localhost:3000`.

Проверки:

```bash
npm run check   # node --check серверной части + tsc --noEmit клиента
npm test        # unit-тесты серверных модулей (node:test)
```

## Environment

Обязательные переменные для LiveKit:

```dotenv
LIVEKIT_URL=wss://livekit.example.com
LIVEKIT_API_KEY=change-me-livekit-key
LIVEKIT_API_SECRET=change-me-livekit-secret
```

Часто используемые настройки:

```dotenv
PORT=3000
LIVEKIT_TOKEN_TTL_SECONDS=21600
LIVEKIT_ROOM_PREFIX=voice-room-

# Доверять заголовку X-Forwarded-For (последний хоп) для определения IP клиента.
# Включайте ТОЛЬКО когда приложение стоит за доверенным reverse proxy (Caddy в docker-compose).
# По умолчанию false: IP берётся из реального соединения (socket.remoteAddress).
TRUST_PROXY=false

MAX_ROOM_PEERS=12
MAX_ROOMS=100
MAX_EMPTY_ROOMS_PER_IP=3
ROOM_CREATE_POW_DIFFICULTY=14
ROOM_CREATE_POW_TTL_MS=120000
ROOM_CREATE_RATE_LIMIT=20
ROOM_CREATE_RATE_WINDOW_MS=60000
```

Для локального LiveKit dev server используйте:

```dotenv
LIVEKIT_URL=ws://127.0.0.1:7880
LIVEKIT_API_KEY=devkey
LIVEKIT_API_SECRET=secret
```

## Docker

Собрать app image:

```bash
docker build -t voice-room .
```

Запустить с доступным LiveKit endpoint:

```bash
docker run --rm -p 3000:3000 \
  -e LIVEKIT_URL=wss://livekit.example.com \
  -e LIVEKIT_API_KEY=change-me-livekit-key \
  -e LIVEKIT_API_SECRET=change-me-livekit-secret \
  voice-room
```

В production приложение должно стоять за HTTPS, а LiveKit должен иметь публично доступные ICE/TCP и ICE/UDP порты. Если пользователи часто сидят за строгими корпоративными сетями, следующим шагом стоит добавить TURN/TLS в LiveKit deployment.

## Desktop

Desktop-оболочка живет в соседнем проекте `VoiceRoomDesktop`. Это веб-приложение остается основным продуктом, а desktop-проект отвечает за нативный выбор окна/экрана, desktop capture audio, управление fullscreen-окном и packaging.

```bash
cd ../VoiceRoomDesktop
cp .env.example .env
npm run desktop
```

## Безопасность

Комнаты приватны только за счет ссылки. Любой, у кого есть URL или код комнаты, может войти. Backend выдает LiveKit tokens только для существующих room sessions, но это не заменяет авторизацию, пароли комнат или аккаунты.

LiveKit снимает mesh-нагрузку с браузеров: каждый участник публикует микрофон и экран один раз в SFU, а остальные клиенты подписываются на tracks через LiveKit.

## Лицензия

MIT License. Vendored RNNoise assets в `public/rnnoise/` распространяются под собственной MIT-лицензией в `public/rnnoise/LICENSE`.
