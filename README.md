# Voice Room

Простой голосовой чат по ссылке с демонстрацией экрана. Комната живет в URL вида `/r/<room-id>`, сигналинг работает на Node.js без npm-зависимостей, звук и экран идут через WebRTC напрямую между браузерами.

## Локальный запуск

```bash
npm start
```

Откройте `http://localhost:3000`. Для доступа к микрофону и демонстрации экрана на сервере нужен HTTPS; `localhost` браузеры считают безопасным контекстом.

## Демонстрация экрана

В комнате нажмите кнопку экрана в нижнем dock. Приложение запрашивает `getDisplayMedia({ video: true, audio: true })` и показывает остальным статус демонстрации; сами screen tracks отправляются только тем участникам, которые нажали `Смотреть экран`.

Для совместного просмотра видео надежнее выбирать вкладку браузера и включать звук вкладки в системном диалоге шаринга. При выборе всего экрана или отдельного окна audio track может не появиться - это зависит от браузера и операционной системы.

## Быстрый деплой через Docker Compose

1. Скопируйте env:

```bash
cp .env.example .env
```

2. Укажите домен в `.env`:

```bash
DOMAIN=voice.example.com
PUBLIC_HOSTNAME=voice.example.com
TURN_SECRET=<openssl rand -hex 32>
```

3. Запустите приложение с HTTPS:

```bash
docker compose up -d --build
```

4. Для более надежной связи через строгие NAT включите TURN:

```bash
docker compose --profile turn up -d --build
```

## DNS и firewall

DNS `A`-запись домена должна смотреть на публичный IP сервера.

Откройте порты:

- `80/tcp`, `443/tcp` для Caddy и HTTPS.
- `3478/tcp`, `3478/udp` для TURN/STUN, если включен профиль `turn`.
- `49160-49200/udp` для TURN relay-портов, если включен профиль `turn`.

Если сервер находится за NAT, пробросьте эти же порты на машину с Docker.

## Рекомендуемый сервер

Для комнат до 6-8 человек обычно хватает VPS `1 vCPU / 1 GB RAM`. С TURN лучше брать `2 vCPU / 2 GB RAM` и смотреть на сетевой трафик: relay-аудио потребляет исходящую полосу сервера. Для небольших приватных комнат комфортный минимум - канал от `100 Mbps`, Ubuntu 24.04 LTS, Docker Engine и Docker Compose plugin.

Топология WebRTC mesh хорошо подходит для малых комнат. Для десятков участников нужен SFU-сервер, например LiveKit, Janus или mediasoup.

## Переменные окружения

- `PORT` - порт Node.js приложения, по умолчанию `3000`.
- `DOMAIN` - домен, на который Caddy выпускает TLS-сертификат.
- `PUBLIC_HOSTNAME` - публичное имя сервера для TURN credentials.
- `STUN_URLS` - список STUN URL через запятую.
- `TURN_SECRET` - shared secret для coturn REST credentials.
- `TURN_PORT` - порт TURN, по умолчанию `3478`.
- `TURN_MIN_PORT`, `TURN_MAX_PORT` - UDP relay range для coturn.
- `MAX_ROOM_PEERS` - лимит участников комнаты, по умолчанию `12`.

## Проверка

```bash
npm run check
curl -s http://localhost:3000/healthz
```
