import { PEER_LATENCY_FAIR_MS, PEER_LATENCY_GOOD_MS } from '../core/config';
import { state } from '../core/state.svelte';

export interface ConnectionStatusView {
  stateName: string;
  label: string;
  title: string;
}

export function resetConnectionStatus(): void {
  state.serverConnection = 'idle';
  state.voiceConnection = 'idle';
}

export function setServerConnectionStatus(connection: string): void {
  state.serverConnection = connection;
}

export function setVoiceConnectionStatus(connection: string): void {
  state.voiceConnection = connection;
}

// Pure view derived from the reactive room state. RoomTopbar (status pill) and
// RoomDock (connection bars) each subscribe via `$derived(getConnectionStatusView())`,
// so changing state.serverConnection/voiceConnection/localPingMs repaints both.
export function getConnectionStatusView(): ConnectionStatusView {
  if (state.voiceConnection === 'playback-blocked') {
    return {
      label: 'Звук заблокирован',
      stateName: 'warning',
      title: 'Браузер заблокировал воспроизведение звука'
    };
  }

  if (state.voiceConnection === 'no-route') {
    return {
      label: 'Нет маршрута к голосу',
      stateName: 'error',
      title: 'LiveKit не смог установить медиасоединение'
    };
  }

  if (state.voiceConnection === 'error') {
    return {
      label: 'Ошибка подключения',
      stateName: 'error',
      title: 'Не удалось подключить голосовой канал'
    };
  }

  if (state.voiceConnection === 'lost' || (state.voiceConnection === 'connected' && state.localConnectionQuality === 'lost')) {
    return {
      label: 'Голос потерян',
      stateName: 'error',
      title: 'Медиасоединение до LiveKit потеряно'
    };
  }

  if (state.voiceConnection === 'reconnecting') {
    return {
      label: 'Переподключение голоса',
      stateName: 'connecting',
      title: 'LiveKit восстанавливает голосовой канал'
    };
  }

  if (state.voiceConnection === 'signal-reconnecting') {
    return {
      label: 'Сигнал переподключается',
      stateName: 'connecting',
      title: 'Служебное соединение LiveKit восстанавливается'
    };
  }

  if (state.serverConnection === 'reconnecting' || state.serverConnection === 'lost') {
    return {
      label: 'Сервер переподключается',
      stateName: 'connecting',
      title: 'Канал событий комнаты восстанавливается'
    };
  }

  if (state.voiceConnection === 'connected') {
    const quality = getPeerLatencyQuality(state.localPingMs, state.localConnectionQuality);
    const ping = formatLocalPing();
    const unstable = quality === 'poor';
    const label = `${unstable ? 'Голос нестабилен' : 'Голос подключен'}${ping ? ` · ${ping}` : ''}`;
    return {
      label,
      stateName: unstable ? 'warning' : 'connected',
      title: ping ? `Пинг до LiveKit ${ping}` : 'Голосовой канал LiveKit подключен'
    };
  }

  if (state.voiceConnection === 'connecting') {
    return {
      label: state.serverConnection === 'connected' ? 'Подключение голоса' : 'Подключение',
      stateName: 'connecting',
      title: 'Подключаем голосовой канал'
    };
  }

  if (state.serverConnection === 'connected') {
    return {
      label: 'Сервер на связи',
      stateName: 'connecting',
      title: 'Канал событий комнаты подключен'
    };
  }

  if (state.serverConnection === 'connecting') {
    return {
      label: 'Подключение к серверу',
      stateName: 'connecting',
      title: 'Подключаем канал событий комнаты'
    };
  }

  return {
    label: 'готово',
    stateName: 'idle',
    title: ''
  };
}

function formatLocalPing(): string {
  return Number.isFinite(state.localPingMs) ? `${state.localPingMs} мс` : '';
}

export function getPeerLatencyQuality(pingMs: number | null, connectionQuality = 'unknown'): string {
  if (pingMs !== null && Number.isFinite(pingMs)) {
    if (pingMs <= PEER_LATENCY_GOOD_MS) return 'good';
    if (pingMs <= PEER_LATENCY_FAIR_MS) return 'fair';
    return 'poor';
  }
  if (connectionQuality === 'excellent') return 'good';
  if (connectionQuality === 'good') return 'fair';
  if (connectionQuality === 'poor') return 'poor';
  if (connectionQuality === 'lost') return 'lost';
  return 'unknown';
}
