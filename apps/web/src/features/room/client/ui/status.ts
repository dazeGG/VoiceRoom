import { t } from '@/shared/i18n';
import { NETWORK_THRESHOLDS } from '@voice-room/shared/network-quality';
import type { VoiceCause } from '@voice-room/shared/contracts/rooms';
import { PEER_LATENCY_GOOD_MS } from '../core/config';
import { state } from '../core/room-runtime.store';
import type { LocalConnectionQuality, ServerConnection, VoiceConnection } from '../core/types';

export interface ConnectionStatusView {
  stateName: 'idle' | 'connecting' | 'connected' | 'warning' | 'error';
  label: string;
  title: string;
}

export function resetConnectionStatus(): void {
  state.serverConnection = 'idle';
  state.voiceConnection = 'idle';
}

export function setServerConnectionStatus(connection: ServerConnection): void {
  state.serverConnection = connection;
}

export function setVoiceConnectionStatus(connection: VoiceConnection): void {
  state.voiceConnection = connection;
}

// Pure view derived from the reactive room state. RoomTopbar (status pill) and
// RoomDock (connection bars) each subscribe via `$derived(getConnectionStatusView())`,
// so changing state.serverConnection/voiceConnection/localPingMs repaints both.
export function getConnectionStatusView(): ConnectionStatusView {
  if (state.voiceConnection === 'playback-blocked') {
    return {
      label: t('Звук заблокирован'),
      stateName: 'warning',
      title: t('Браузер заблокировал воспроизведение звука')
    };
  }

  if (state.voiceConnection === 'no-route') {
    return {
      label: t('Нет маршрута к голосу'),
      stateName: 'error',
      title: t('LiveKit не смог установить медиасоединение')
    };
  }

  if (state.voiceConnection === 'error') {
    return {
      label: t('Ошибка подключения'),
      stateName: 'error',
      title: t('Не удалось подключить голосовой канал')
    };
  }

  if (
    state.voiceConnection === 'lost' ||
    (state.voiceConnection === 'connected' && state.localConnectionQuality === 'lost')
  ) {
    return {
      label: t('Голос потерян'),
      stateName: 'error',
      title: t('Медиасоединение до LiveKit потеряно')
    };
  }

  if (state.voiceConnection === 'reconnecting') {
    return {
      label: t('Переподключение голоса'),
      stateName: 'connecting',
      title: t('LiveKit восстанавливает голосовой канал')
    };
  }

  if (state.voiceConnection === 'signal-reconnecting') {
    return {
      label: t('Сигнал переподключается'),
      stateName: 'connecting',
      title: t('Служебное соединение LiveKit восстанавливается')
    };
  }

  if (state.serverConnection === 'reconnecting') {
    return {
      label: t('Сервер переподключается'),
      stateName: 'connecting',
      title: t('Канал событий комнаты восстанавливается')
    };
  }

  if (state.voiceConnection === 'connected') {
    const ping = formatLocalPing();
    // The server's verdict from what everyone in the room heard, the one the admin panel shows.
    const level = state.voiceQuality?.level ?? 'good';
    const cause = level === 'good' ? null : state.voiceQuality?.cause;
    const head =
      level === 'bad' ? t('Плохая связь') : level === 'unstable' ? t('Голос нестабилен') : t('Голос подключен');
    const label = [head, ...(cause ? [CAUSE_LABELS[cause]] : []), ...(ping ? [ping] : [])].join(' · ');
    return {
      label,
      stateName: level === 'bad' ? 'error' : level === 'unstable' ? 'warning' : 'connected',
      title: [...(cause ? [CAUSE_DETAILS[cause]] : []), formatNetworkDetails(ping)].join(' · ')
    };
  }

  if (state.voiceConnection === 'connecting') {
    return {
      label: state.serverConnection === 'connected' ? t('Подключение голоса') : t('Подключение'),
      stateName: 'connecting',
      title: t('Подключаем голосовой канал')
    };
  }

  if (state.serverConnection === 'connected') {
    return {
      label: t('Сервер на связи'),
      stateName: 'connecting',
      title: t('Канал событий комнаты подключен')
    };
  }

  if (state.serverConnection === 'connecting') {
    return {
      label: t('Подключение к серверу'),
      stateName: 'connecting',
      title: t('Подключаем канал событий комнаты')
    };
  }

  return {
    label: t('готово'),
    stateName: 'idle',
    title: ''
  };
}

// Whose side the trouble is on, in the words the warning shows. A warning
// that only says "unstable" next to a 2 ms ping leaves the user guessing.
const CAUSE_LABELS: Record<VoiceCause, string> = {
  get heard_badly() {
    return t('вас плохо слышно');
  },
  get hears_badly() {
    return t('собеседников плохо слышно');
  },
  get delay() {
    return t('большая задержка');
  }
};

// The numbers after it are the line's, and they can all be fine: the warning is about the sound.
const CAUSE_DETAILS: Record<VoiceCause, string> = {
  get heard_badly() {
    return t('Собеседники слышат разрывы в вашем голосе, оценка по самому звуку, а не по пингу');
  },
  get hears_badly() {
    return t('В голосах собеседников слышны разрывы, оценка по самому звуку, а не по пингу');
  },
  get delay() {
    return t('Голос доходит с заметной задержкой: пинг, буфер воспроизведения и кодек вместе дают больше 400 мс');
  }
};

export function formatNetworkDetails(ping: string): string {
  const { inboundLossPct, jitterMs, outboundLossPct, transport } = state.localNetwork;
  const parts = [ping ? t('Пинг до LiveKit {p0}', { p0: ping }) : t('Голосовой канал LiveKit подключен')];
  if (outboundLossPct !== null) parts.push(t('потери от вас {p0}%', { p0: outboundLossPct }));
  if (inboundLossPct !== null) parts.push(t('потери к вам {p0}%', { p0: inboundLossPct }));
  if (jitterMs !== null) parts.push(t('джиттер {p0} мс', { p0: jitterMs }));
  if (transport === 'relay') parts.push(t('через ретранслятор'));
  else if (transport === 'tcp') parts.push(t('через TCP (UDP недоступен)'));
  return parts.join(' · ');
}

function formatLocalPing(): string {
  return Number.isFinite(state.localPingMs) ? t('{p0} мс', { p0: state.localPingMs }) : '';
}

export function getPeerLatencyQuality(
  pingMs: number | null,
  connectionQuality: LocalConnectionQuality = 'unknown'
): 'good' | 'fair' | 'poor' | 'lost' | 'unknown' {
  if (pingMs !== null && Number.isFinite(pingMs)) {
    if (pingMs <= PEER_LATENCY_GOOD_MS) return 'good';
    // Past the shared unstable threshold the ping is what makes the voice unstable.
    return pingMs < NETWORK_THRESHOLDS.unstable.rttMs ? 'fair' : 'poor';
  }
  if (connectionQuality === 'excellent') return 'good';
  if (connectionQuality === 'good') return 'fair';
  if (connectionQuality === 'poor') return 'poor';
  if (connectionQuality === 'lost') return 'lost';
  return 'unknown';
}
