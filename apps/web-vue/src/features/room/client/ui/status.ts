import { NETWORK_THRESHOLDS, networkLevelOfValue, type NetworkMeasure } from '@voice-room/shared/network-quality';
import { PEER_LATENCY_GOOD_MS } from '../core/config';
import { readingLevel } from '../room/network-level';
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

  if (
    state.voiceConnection === 'lost' ||
    (state.voiceConnection === 'connected' && state.localConnectionQuality === 'lost')
  ) {
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

  if (state.serverConnection === 'reconnecting') {
    return {
      label: 'Сервер переподключается',
      stateName: 'connecting',
      title: 'Канал событий комнаты восстанавливается'
    };
  }

  if (state.voiceConnection === 'connected') {
    const ping = formatLocalPing();
    // The level the admin panel's call bars show for this call, by the same thresholds.
    const level = readingLevel({
      sample: { ...state.localNetwork, rttMs: state.localPingMs },
      quality: state.localConnectionQuality,
      voice: state.voiceConnection
    });
    const head = level === 'bad' ? 'Плохая связь' : level === 'unstable' ? 'Голос нестабилен' : 'Голос подключен';
    const causes = level === 'bad' || level === 'unstable' ? getInstabilityCauses() : [];
    const label = [head, ...causes, ...(ping ? [ping] : [])].join(' · ');
    return {
      label,
      stateName: level === 'bad' ? 'error' : level === 'unstable' ? 'warning' : 'connected',
      title: formatNetworkDetails(ping)
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

const noticeable = (measure: NetworkMeasure, value: number | null) => {
  const level = networkLevelOfValue(measure, value);
  return level === 'unstable' || level === 'bad';
};

// What makes the voice unstable, in the words the warning shows. A warning
// that only says "unstable" next to a 2 ms ping leaves the user guessing.
function getInstabilityCauses(): string[] {
  const { inboundLossPct, jitterMs, outboundLossPct } = state.localNetwork;
  const causes: string[] = [];
  const quality = getPeerLatencyQuality(state.localPingMs, state.localConnectionQuality);
  if (quality === 'poor') causes.push(Number.isFinite(state.localPingMs) ? 'высокий пинг' : 'плохая связь');
  if (noticeable('lossPct', outboundLossPct)) causes.push(`потери от вас ${outboundLossPct}%`);
  if (noticeable('lossPct', inboundLossPct)) causes.push(`потери к вам ${inboundLossPct}%`);
  if (noticeable('jitterMs', jitterMs)) causes.push(`джиттер ${jitterMs} мс`);
  return causes;
}

export function formatNetworkDetails(ping: string): string {
  const { inboundLossPct, jitterMs, outboundLossPct, transport } = state.localNetwork;
  const parts = [ping ? `Пинг до LiveKit ${ping}` : 'Голосовой канал LiveKit подключен'];
  if (outboundLossPct !== null) parts.push(`потери от вас ${outboundLossPct}%`);
  if (inboundLossPct !== null) parts.push(`потери к вам ${inboundLossPct}%`);
  if (jitterMs !== null) parts.push(`джиттер ${jitterMs} мс`);
  if (transport === 'relay') parts.push('через ретранслятор (UDP недоступен)');
  else if (transport === 'tcp') parts.push('через TCP (UDP недоступен)');
  return parts.join(' · ');
}

function formatLocalPing(): string {
  return Number.isFinite(state.localPingMs) ? `${state.localPingMs} мс` : '';
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
