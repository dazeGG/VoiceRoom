---
title: Развёртывание на своём сервере
description: Как запустить VoiceRoom на Linux-сервере через Docker Compose и проверить первый звонок.
---

Для первого звонка поднимите VoiceRoom из готовых образов. Docker Compose запустит приложение, PostgreSQL и LiveKit, применит миграции, а Caddy получит сертификаты HTTPS.

## 1. Подготовьте сервер и DNS

Понадобится Linux-сервер `x86_64` с публичным IPv4, Docker Engine с плагином `docker compose`, Git и OpenSSL. Порты `80` и `443` на сервере должны быть свободны.

В DNS создайте A-записи, которые указывают на публичный IP сервера.

| Имя | Для чего |
| --- | --- |
| `voice.example.com` | Веб-приложение |
| `livekit.voice.example.com` | Подключение к звонкам |
| `admin.voice.example.com` | Панель администратора, если нужна |

Замените `voice.example.com` своим доменом. Если DNS-провайдер умеет проксировать трафик, выберите для этих записей режим «только DNS». Добавляйте AAAA-записи, только если сервер доступен по IPv6.

Разрешите входящие соединения в файрволе сервера и в панели хостинга.

| Порт | Для чего |
| --- | --- |
| `80/TCP`, `443/TCP` | HTTP, HTTPS и подключение к LiveKit по WebSocket |
| `7882/UDP`, `7881/TCP` | Аудио и видео. TCP используется, когда UDP недоступен |

## 2. Скачайте релиз и создайте `.env`

В примере используется релиз `v2.14.3`. Выполните команды на сервере в Bash. Для другой версии подставьте её тег в `git clone`.

```bash
git clone --depth 1 --branch v2.14.3 https://github.com/dazeGG/VoiceRoom.git
cd VoiceRoom
```

В следующем блоке замените только `voice.example.com`. Остальные значения вычисляются автоматически. Если `.env` уже существует, блок остановится и сохранит его содержимое.

```bash
(
  set -euC
  umask 077
  domain=voice.example.com
  release_sha=$(git rev-parse HEAD)
  postgres_password=$(openssl rand -hex 32)
  livekit_key=$(openssl rand -hex 16)
  livekit_secret=$(openssl rand -hex 32)
  gate_secret=$(openssl rand -hex 32)
  cursor_key=$(openssl rand -hex 32)

  cat > .env <<EOF
DOMAIN=$domain
POSTGRES_PASSWORD=$postgres_password
LIVEKIT_API_KEY=$livekit_key
LIVEKIT_API_SECRET=$livekit_secret
LIVEKIT_GATE_SECRET=$gate_secret
VOICE_ROOM_CURSOR_HMAC_KEYS=$cursor_key
VOICEROOM_API_IMAGE=ghcr.io/dazegg/voiceroom-api:$release_sha
VOICEROOM_WORKER_IMAGE=ghcr.io/dazegg/voiceroom-worker:$release_sha
VOICEROOM_WEB_IMAGE=ghcr.io/dazegg/voiceroom-web:$release_sha
EOF
)
```

Сохраните `.env` в закрытой резервной копии и используйте тот же файл при перезапусках. Значения `LIVEKIT_DOMAIN` и `ADMIN_DOMAIN` Compose выводит из `DOMAIN`. Если выбрали другие имена, добавьте их в `.env` явно.

## 3. Запустите VoiceRoom и проверьте звонок

```bash
docker compose config --quiet &&
  docker compose pull &&
  docker compose up -d --wait
```

1. Откройте `https://voice.example.com/app` на своём домене.
2. Создайте временную комнату, отправьте ссылку собеседнику и проверьте звук в обе стороны. По возможности подключитесь с разных сетей, например через Wi-Fi и мобильный интернет.
3. Если страница открывается, а звонок не соединяется, проверьте DNS имени LiveKit и доступность `7882/UDP` и `7881/TCP`. Для сетей, которые пропускают только веб-трафик, настройте TURN/TLS.

Если приложение не открывается, посмотрите состояние контейнеров и последние сообщения Caddy, API и LiveKit.

```bash
docker compose ps -a
curl -fsS https://voice.example.com/api/healthz
docker compose logs --tail=100 caddy migrate api livekit livekit-gate
```

Настройки TURN, админки, Web Push, публикации отдельного сайта и резервного копирования описаны в [руководстве по эксплуатации](https://github.com/dazeGG/VoiceRoom/blob/main/docs/SELF_HOSTING.md).
