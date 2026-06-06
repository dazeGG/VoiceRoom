# Voice Room

Простой голосовой чат по ссылке с демонстрацией экрана. Комната живет в URL вида `/r/<room-id>`, сигналинг работает на Node.js без npm-зависимостей, звук и экран идут через WebRTC напрямую между браузерами.

Этот README в первую очередь про самостоятельный деплой на VPS через Docker Compose.

## Что понадобится

- VPS с публичным IPv4.
- Домен или поддомен, который можно направить на VPS.
- Ubuntu 24.04 LTS или похожий Linux-дистрибутив.
- Доступ к серверу по SSH с пользователем, у которого есть `sudo`.
- Открытые входящие порты для HTTPS и, при необходимости, TURN.

Для комнат до 6-8 человек обычно хватает VPS `1 vCPU / 1 GB RAM`. Если включаете TURN, лучше брать `2 vCPU / 2 GB RAM` и канал от `100 Mbps`, потому что relay-трафик идет через сервер.

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
- `3478/tcp`, `3478/udp` для TURN/STUN, если включаете профиль `turn`.
- `49160-49200/udp` для TURN relay-портов, если включаете профиль `turn`.

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

MAX_ROOM_PEERS=12
MAX_ROOMS=100
MAX_EMPTY_ROOMS_PER_IP=3
ROOM_CREATE_POW_DIFFICULTY=14
ROOM_CREATE_POW_TTL_MS=120000
STUN_URLS=stun:stun.l.google.com:19302
TURN_PORT=3478
TURN_TTL_SECONDS=900
TURN_MIN_PORT=49160
TURN_MAX_PORT=49200
ROOM_CREATE_RATE_LIMIT=20
ROOM_CREATE_RATE_WINDOW_MS=60000
```

Если планируете запускать TURN, заранее сгенерируйте secret и добавьте его в `.env`:

```bash
openssl rand -hex 32
```

```dotenv
TURN_SECRET=paste-generated-secret-here
```

Если TURN не нужен, оставьте `TURN_SECRET` пустым.

## Деплой без TURN

Этот режим проще и часто работает для пользователей без строгого NAT.

```bash
docker compose up -d --build
```

Caddy автоматически выпустит TLS-сертификат для `DOMAIN` и проксирует приложение на Node.js контейнер.

Проверьте:

```bash
docker compose ps
curl -s https://voice.example.com/healthz
```

## Деплой с TURN

TURN нужен, когда участники находятся за строгим NAT или корпоративными сетями и прямой WebRTC path не собирается.

```bash
docker compose --profile turn up -d --build
```

Проверьте контейнеры и логи:

```bash
docker compose --profile turn ps
docker compose --profile turn logs -f voicechat caddy coturn
```

При включенном `TURN_SECRET` приложение выдает браузерам короткоживущие TURN credentials только после подключения peer-сессии к комнате.

## Проверка после деплоя

1. Откройте `https://voice.example.com`.
2. Сохраните имя.
3. Создайте комнату.
4. Скопируйте ссылку комнаты и откройте ее во втором браузере или на другом устройстве.
5. Проверьте микрофон, mute/unmute и демонстрацию экрана.

Для совместного просмотра видео надежнее выбирать вкладку браузера и включать звук вкладки в системном диалоге шаринга. При выборе всего экрана или отдельного окна audio track может не появиться, это зависит от браузера и операционной системы.

## Обновление

Без TURN:

```bash
git pull
docker compose up -d --build
```

С TURN:

```bash
git pull
docker compose --profile turn up -d --build
```

## Переменные окружения

- `PORT` - порт Node.js приложения внутри контейнера, по умолчанию `3000`.
- `DOMAIN` - домен, на который Caddy выпускает TLS-сертификат.
- `PUBLIC_HOSTNAME` - публичное имя сервера для TURN credentials, обычно совпадает с `DOMAIN`.
- `STUN_URLS` - список STUN URL через запятую.
- `TURN_SECRET` - shared secret для coturn REST credentials.
- `TURN_HOST` - публичный host TURN-сервера, по умолчанию `PUBLIC_HOSTNAME` или `DOMAIN`.
- `TURN_PORT` - порт TURN, по умолчанию `3478`.
- `TURN_TTL_SECONDS` - срок жизни временных TURN credentials, по умолчанию `900`.
- `TURN_MIN_PORT`, `TURN_MAX_PORT` - UDP relay range для coturn.
- `MAX_ROOM_PEERS` - лимит участников комнаты, по умолчанию `12` в compose.
- `MAX_ROOMS` - общий лимит активных комнат в памяти, по умолчанию `100`.
- `MAX_EMPTY_ROOMS_PER_IP` - лимит пустых комнат, созданных с одного IP, по умолчанию `3`. Значение `0` отключает лимит.
- `ROOM_CREATE_POW_DIFFICULTY` - сложность proof-of-work перед созданием комнаты, по умолчанию `14`. Значение `0` отключает PoW.
- `ROOM_CREATE_POW_TTL_MS` - срок жизни proof-of-work challenge, по умолчанию `120000`.
- `ROOM_CREATE_RATE_LIMIT` - лимит создания комнат на IP за окно, по умолчанию `20`.
- `ROOM_CREATE_RATE_WINDOW_MS` - окно лимита создания комнат, по умолчанию `60000`.

## Локальный запуск

```bash
npm start
```

Откройте `http://localhost:3000`. Для доступа к микрофону и демонстрации экрана на сервере нужен HTTPS; `localhost` браузеры считают безопасным контекстом.

Проверка синтаксиса:

```bash
npm run check
```

## Electron

Electron-версия открывает публичный сайт из `VOICE_ROOM_URL` в нативном окне. Перед запуском или сборкой создайте локальный `.env`:

```dotenv
VOICE_ROOM_URL=https://voice.example.com
```

Команды:

- `npm run electron` - запускает desktop-окно локально без создания релизных файлов.
- `npm run build` - собирает macOS `.dmg` для `arm64`/`x64` и Windows portable `.exe`.
- `npm run build:dev` - собирает macOS и Windows в `dist/dev/<git-hash>/` с git hash в названии артефакта.
- `npm run build:mac` - собирает только macOS `.dmg`.
- `npm run build:mac:dev` - собирает macOS `.dmg` в `dist/dev/<git-hash>/` с git hash в названии.
- `npm run build:win` - собирает только Windows portable `.exe`.
- `npm run build:win:dev` - собирает Windows portable `.exe` в `dist/dev/<git-hash>/` с git hash в названии.
- `npm run clean:dist` - чистит `dist/`, оставляя только релизные `.dmg`/`.exe`.

Готовые файлы появляются в `dist/`. Папка `dist/`, `.env` и `electron/runtime-config.json` не коммитятся.
Настройки сборки Electron лежат в `electron-builder.config.js`.

В desktop-версии демонстрация экрана использует встроенный выбор окна/экрана через Electron `desktopCapturer` и Chromium desktop capture. Перед стартом захвата приложение приглушает собственное воспроизведение, чтобы его звук не попадал обратно в стрим. Если операционная система не отдает audio track, стрим запускается без звука. На Windows desktop audio обычно доступен штатно; на macOS системный звук зависит от версии macOS и разрешения `NSAudioCaptureUsageDescription` в собранном приложении. На старых macOS может понадобиться виртуальное аудиоустройство вроде BlackHole.

## Безопасность

Комната доступна всем, у кого есть ссылка или код комнаты. Создание комнаты защищено rate limit, proof-of-work challenge и лимитом пустых комнат на IP. Сигналинг проверяет короткоживущую peer-сессию для отправки WebRTC-сигналов, обновления статуса и выдачи TURN credentials, но это не заменяет аккаунты, пароль или отдельную авторизацию комнаты.

Топология WebRTC mesh хорошо подходит для малых комнат. Для десятков участников нужен SFU-сервер, например LiveKit, Janus или mediasoup.

## Лицензия

Проект распространяется под MIT License, см. `LICENSE`. Vendored RNNoise assets в `public/rnnoise/` распространяются под собственной MIT-лицензией, см. `public/rnnoise/LICENSE`.
