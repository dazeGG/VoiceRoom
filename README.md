# Voice Room

Простой голосовой чат по ссылке с демонстрацией экрана. Комната живет в URL вида `/r/<room-id>`, приложение на Node.js создает комнаты и выдает LiveKit JWT, а звук и экран идут через self-host LiveKit SFU по схеме browser -> server -> browser.

Этот README в первую очередь про самостоятельный деплой на VPS через Docker Compose.

## Что понадобится

- VPS с публичным IPv4.
- Домен или поддомен, который можно направить на VPS.
- Ubuntu 24.04 LTS или похожий Linux-дистрибутив.
- Доступ к серверу по SSH с пользователем, у которого есть `sudo`.
- Открытые входящие порты для HTTPS и LiveKit media.
- Для локальной разработки: Node.js `20.20.2` и pnpm `10.23.0`.

Для старта обычно хватает VPS `4 vCPU / 8 GB RAM / 60 GB SSD` с портом `1 Gbps`. Для небольшого теста можно начать с `2 vCPU / 4 GB RAM`, но screen share быстро упирается в исходящий канал.

## Установка Docker на Ubuntu

Если Docker Engine и Docker Compose plugin уже установлены, проверьте версии и переходите к DNS:

```bash
docker --version
docker compose version
```

На чистой Ubuntu установите Docker из официального apt-репозитория:

```bash
sudo apt update
sudo apt install -y ca-certificates curl git openssl

# Если раньше ставили Docker из Ubuntu packages, удалите конфликтующие пакеты.
sudo apt remove -y docker.io docker-compose docker-compose-v2 docker-doc podman-docker containerd runc || true

sudo install -m 0755 -d /etc/apt/keyrings
sudo curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
sudo chmod a+r /etc/apt/keyrings/docker.asc

sudo tee /etc/apt/sources.list.d/docker.sources <<EOF
Types: deb
URIs: https://download.docker.com/linux/ubuntu
Suites: $(. /etc/os-release && echo "${UBUNTU_CODENAME:-$VERSION_CODENAME}")
Components: stable
Architectures: $(dpkg --print-architecture)
Signed-By: /etc/apt/keyrings/docker.asc
EOF

sudo apt update
sudo apt install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
sudo systemctl enable --now docker
```

Проверьте установку:

```bash
sudo docker run hello-world
docker compose version
```

Команды деплоя ниже написаны без `sudo`. Чтобы запускать Docker от текущего пользователя, добавьте его в группу `docker`, затем перелогиньтесь или выполните `newgrp docker`:

```bash
getent group docker || sudo groupadd docker
sudo usermod -aG docker "$USER"
newgrp docker
docker run hello-world
```

Группа `docker` дает root-level доступ к Docker daemon, так что добавляйте туда только доверенного пользователя.

## DNS и firewall

Создайте `A`-запись домена на публичный IP сервера:

```text
voice.example.com -> 203.0.113.10
```

Откройте порты:

- `80/tcp`, `443/tcp` для Caddy и HTTPS.
- `7881/tcp` для LiveKit ICE/TCP fallback.
- `7882/udp` для LiveKit ICE/UDP mux.

Если сервер находится за NAT, пробросьте эти же порты на машину с Docker.

## Подготовка проекта

Склонируйте репозиторий на сервер. Если на сервере уже настроен SSH-ключ для GitHub, используйте SSH:

```bash
git clone git@github.com:dazeGG/VoiceRoom.git
cd VoiceRoom
```

Для публичного read-only клонирования без SSH-ключа можно использовать HTTPS:

```bash
git clone https://github.com/dazeGG/VoiceRoom.git
cd VoiceRoom
```

Создайте `.env`:

```bash
cp .env.example .env
```

Откройте `.env` и укажите домен:

```dotenv
DOMAIN=voice.example.com
PUBLIC_HOSTNAME=voice.example.com
LIVEKIT_DOMAIN=livekit.voice.example.com
LIVEKIT_URL=wss://livekit.voice.example.com

LIVEKIT_API_KEY=change-me-livekit-key
LIVEKIT_API_SECRET=change-me-livekit-secret
LIVEKIT_TOKEN_TTL_SECONDS=21600
LIVEKIT_ROOM_PREFIX=voice-room-

MAX_ROOM_PEERS=12
MAX_ROOMS=100
MAX_EMPTY_ROOMS_PER_IP=3
ROOM_CREATE_POW_DIFFICULTY=14
ROOM_CREATE_POW_TTL_MS=120000
ROOM_CREATE_RATE_LIMIT=20
ROOM_CREATE_RATE_WINDOW_MS=60000
```

Сгенерируйте LiveKit credentials:

```bash
openssl rand -hex 12
openssl rand -hex 32
```

Первое значение удобно использовать как `LIVEKIT_API_KEY`, второе как `LIVEKIT_API_SECRET`.

## Деплой

```bash
docker compose up -d --build
```

Caddy автоматически выпустит TLS-сертификаты для `DOMAIN` и `LIVEKIT_DOMAIN`, проксирует приложение на Node.js контейнер и LiveKit API/WebSocket на локальный LiveKit.

Проверьте:

```bash
docker compose ps
curl -s https://voice.example.com/healthz
```

Проверьте контейнеры и логи:

```bash
docker compose ps
docker compose logs -f voicechat caddy livekit
```

Если пользователи сидят за строгими корпоративными сетями, следующим шагом стоит включить embedded TURN/TLS в LiveKit. На первом этапе конфигурация использует LiveKit ICE/UDP mux на `7882/udp` и ICE/TCP fallback на `7881/tcp`.

## Проверка после деплоя

1. Откройте `https://voice.example.com`.
2. Сохраните имя.
3. Создайте комнату.
4. Скопируйте ссылку комнаты и откройте ее во втором браузере или на другом устройстве.
5. Проверьте микрофон, mute/unmute и демонстрацию экрана.

Для совместного просмотра видео надежнее выбирать вкладку браузера и включать звук вкладки в системном диалоге шаринга. При выборе всего экрана или отдельного окна audio track может не появиться, это зависит от браузера и операционной системы.

## Обновление

```bash
git pull
docker compose up -d --build
```

## Переменные окружения

- `PORT` - порт Node.js приложения внутри контейнера, по умолчанию `3000`.
- `DOMAIN` - домен, на который Caddy выпускает TLS-сертификат.
- `PUBLIC_HOSTNAME` - публичное имя сервера, обычно совпадает с `DOMAIN`.
- `LIVEKIT_DOMAIN` - домен LiveKit endpoint, например `livekit.voice.example.com`.
- `LIVEKIT_URL` - публичный WebSocket URL LiveKit, например `wss://livekit.voice.example.com`.
- `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET` - credentials LiveKit server и backend token endpoint.
- `LIVEKIT_TOKEN_TTL_SECONDS` - срок жизни LiveKit join token, по умолчанию `21600`.
- `LIVEKIT_ROOM_PREFIX` - префикс LiveKit room names, по умолчанию `voice-room-`.
- `MAX_ROOM_PEERS` - лимит участников комнаты, по умолчанию `12` в compose.
- `MAX_ROOMS` - общий лимит активных комнат в памяти, по умолчанию `100`.
- `MAX_EMPTY_ROOMS_PER_IP` - лимит пустых комнат, созданных с одного IP, по умолчанию `3`. Значение `0` отключает лимит.
- `ROOM_CREATE_POW_DIFFICULTY` - сложность proof-of-work перед созданием комнаты, по умолчанию `14`. Значение `0` отключает PoW.
- `ROOM_CREATE_POW_TTL_MS` - срок жизни proof-of-work challenge, по умолчанию `120000`.
- `ROOM_CREATE_RATE_LIMIT` - лимит создания комнат на IP за окно, по умолчанию `20`.
- `ROOM_CREATE_RATE_WINDOW_MS` - окно лимита создания комнат, по умолчанию `60000`.

## Локальный запуск

Запустите локальный LiveKit server в dev-режиме:

```bash
corepack pnpm run dev:livekit
```

Команда пробрасывает порты `7880/tcp`, `7881/tcp` и `7882/udp`, поэтому работает в Docker Desktop на macOS без `--network host`.

В другом терминале:

```bash
corepack enable
corepack prepare pnpm@10.23.0 --activate
corepack pnpm install --frozen-lockfile

export LIVEKIT_URL=ws://127.0.0.1:7880
export LIVEKIT_API_KEY=devkey
export LIVEKIT_API_SECRET=secret
corepack pnpm start
```

Если команда `pnpm` все равно запускает старую standalone-версию из `~/Library/pnpm`, используйте `corepack pnpm ...` или поправьте `PATH`, чтобы Corepack shim шел раньше standalone pnpm.

Откройте `http://localhost:3000`. Для доступа к микрофону и демонстрации экрана на сервере нужен HTTPS; `localhost` браузеры считают безопасным контекстом.

Проверка синтаксиса:

```bash
corepack pnpm run check
```

## Desktop

Desktop-оболочка вынесена в соседний проект `VoiceRoomDesktop`. Веб-приложение остается основным продуктом, а соседний desktop-проект хранит свои настройки запуска, сборки, нативный выбор окна/экрана, desktop capture audio и управление окном.

Для локального запуска desktop-версии:

```bash
cd ../VoiceRoomDesktop
cp .env.example .env
npm run desktop
```

Готовые `.dmg` и `.exe` собираются командами из `VoiceRoomDesktop`, см. `../VoiceRoomDesktop/README.md`.

## Безопасность

Комната доступна всем, у кого есть ссылка или код комнаты. Создание комнаты защищено rate limit, proof-of-work challenge и лимитом пустых комнат на IP. Backend выдает LiveKit join token только для существующей комнаты, но это не заменяет аккаунты, пароль или отдельную авторизацию комнаты.

LiveKit SFU снимает mesh-нагрузку с браузеров: каждый участник публикует микрофон и экран один раз на сервер, а остальные получают подписанные tracks через LiveKit.

## Лицензия

Проект распространяется под MIT License, см. `LICENSE`. Vendored RNNoise assets в `public/rnnoise/` распространяются под собственной MIT-лицензией, см. `public/rnnoise/LICENSE`.
