import { reactive } from 'vue';
import { LiveKitAdmission } from '@voice-room/shared/contracts/admission';
import { WidgetRoomCreated, WidgetRoomInfo } from '@voice-room/shared/contracts/widget';
import type { PublicPeer } from '@voice-room/shared/contracts/rooms';
import { parseServerFrame } from '@voice-room/shared/realtime';
import type { ClientCommand } from '@voice-room/shared/contracts/realtime';
import { widgetRequest } from './http';
import { widgetProof } from './proof';
import { WIDGET_AUDIO_BLOCKED_MESSAGE, WidgetMedia } from './media';

export function createWidgetRuntime(mount: HTMLElement, callState: (active: boolean) => void, cameraAllowed = true) {
  const localVolumes: Record<string, number> = {};
  const peers: PublicPeer[] = [];
  const devicesList: MediaDeviceInfo[] = [];
  const settings: { noise: 'rnnoise' | 'browser' | 'off' } = { noise: 'rnnoise' };
  const state = reactive({
    roomId: '',
    name: '',
    status: 'Готов к подключению',
    error: '',
    joined: false,
    muted: false,
    outputMuted: false,
    camera: false,
    peers,
    localVolumes,
    input: '',
    output: '',
    noise: settings.noise,
    devices: devicesList,
    audioRevision: 0
  });
  const media = new WidgetMedia(
    mount,
    () => state.audioRevision++,
    (message, noiseFallback, terminal) => {
      if (noiseFallback) state.noise = 'browser';
      state.error = message;
      if (terminal) {
        state.joined = false;
        state.status = message;
        if (mediaRecoveries < 2 && socket) {
          mediaRecoveries++;
          socket.close();
        } else leave();
      }
    },
    cameraAllowed
  );
  let socket: WebSocket | null = null;
  let stopped = false;
  let reconnect: ReturnType<typeof setTimeout> | undefined;
  let generation = 0;
  let cameraRevision = 0;
  let mediaRecoveries = 0;
  let heartbeat: ReturnType<typeof setInterval> | undefined;
  let connectingMedia: number | null = null;
  let grant: { resolve(): void; reject(error: Error): void; timer: ReturnType<typeof setTimeout> } | null = null;
  const peerId = crypto.randomUUID();
  const sessionToken = Array.from(crypto.getRandomValues(new Uint8Array(32)), (byte) =>
    byte.toString(16).padStart(2, '0')
  ).join('');
  const guestId = crypto.randomUUID();
  const clientId = crypto.randomUUID();
  const target = () => ({ roomId: state.roomId, peerId, sessionToken });
  const send = (command: ClientCommand) => {
    if (socket && socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(command));
  };
  const report = (error: unknown) => {
    state.error = error instanceof Error ? error.message : 'Не удалось подключиться';
  };
  async function devices() {
    const available = await navigator.mediaDevices.enumerateDevices();
    state.devices = cameraAllowed ? available : available.filter(({ kind }) => kind !== 'videoinput');
  }
  async function capture() {
    await media.microphone(state.input, state.noise, state.muted);
    await devices();
  }
  async function connectMedia() {
    if (connectingMedia === generation) return;
    connectingMedia = generation;
    const revision = generation;
    try {
      const admission = await widgetRequest('/api/widget/livekit-token', LiveKitAdmission, {
        ...target(),
        name: state.name
      });
      if (revision !== generation) return;
      await media.connect(admission.url, admission.token);
      if (revision !== generation) return;
      state.joined = true;
      state.status = 'В комнате';
      callState(true);
      try {
        await capture();
      } catch (error) {
        if (revision === generation) report(error);
      }
    } catch (error) {
      if (revision === generation) {
        report(error);
        state.status = 'Не удалось подключить голос';
      }
    } finally {
      if (connectingMedia === revision) connectingMedia = null;
    }
  }
  function openSocket() {
    const url = new URL('/api/widget/ws', location.href);
    url.protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
    const next = new WebSocket(url);
    socket = next;
    next.onopen = () => {
      if (socket !== next || stopped) return;
      state.status = 'Подключение';
      if (heartbeat) clearInterval(heartbeat);
      heartbeat = setInterval(() => {
        if (socket === next && !stopped) send({ type: 'ping', payload: { at: Date.now() } });
      }, 15000);
      send({ type: 'room.join', payload: { ...target(), name: state.name || 'Гость', guestId, clientId } });
    };
    next.onmessage = (event: MessageEvent<string>) => {
      if (socket !== next || stopped) return;
      try {
        const parsed = parseServerFrame(JSON.parse(event.data));
        if (!parsed.ok) throw new Error('Несовместимый ответ сервера');
        const frame = parsed.frame;
        switch (frame.type) {
          case 'room.media.grant':
            if (frame.payload.kind === 'camera' && grant) {
              clearTimeout(grant.timer);
              if (frame.payload.granted) grant.resolve();
              else grant.reject(new Error('Камера недоступна: лимит сервера'));
              grant = null;
            }
            break;
          case 'room.snapshot':
            state.peers = frame.payload.peers;
            if (!state.joined) void connectMedia();
            break;
          case 'room.peer.updated':
          case 'room.peer.joined':
            if (frame.payload.peer.id === peerId && frame.payload.peer.serverMuted) media.mute(true);
            state.peers = [...state.peers.filter((peer) => peer.id !== frame.payload.peer.id), frame.payload.peer];
            break;
          case 'room.peer.left':
            state.peers = state.peers.filter((peer) => peer.id !== frame.payload.peerId);
            break;
          case 'room.full':
          case 'server.full':
          case 'room.not_found':
          case 'room.banned':
          case 'room.kicked':
            state.error = 'Комната недоступна или заполнена';
            leave();
            break;
          case 'room.left':
            if (frame.payload.peerId === peerId) leave();
            break;
          default:
            break;
          case 'error':
            state.error = 'Команда отклонена сервером';
            break;
        }
      } catch (error) {
        report(error);
      }
    };
    next.onclose = () => {
      if (socket !== next || stopped) return;
      if (heartbeat) clearInterval(heartbeat);
      generation++;
      state.joined = false;
      state.camera = false;
      media.dispose();
      state.status = 'Связь потеряна. Переподключение…';
      reconnect = setTimeout(openSocket, 1000);
    };
  }
  async function join(code: string) {
    leave();
    const revision = generation;
    mediaRecoveries = 0;
    stopped = false;
    state.error = '';
    const room = await widgetRequest(`/api/widget/rooms/${encodeURIComponent(code.trim())}`, WidgetRoomInfo);
    if (revision !== generation || stopped) return;
    state.roomId = room.roomId;
    openSocket();
  }
  async function create() {
    const revision = generation;
    const proof = await widgetProof();
    if (revision !== generation) return;
    const room = await widgetRequest('/api/widget/rooms', WidgetRoomCreated, {
      chat: false,
      ...(proof ? { proof } : {})
    });
    if (revision !== generation) return;
    await join(room.roomId);
  }
  function leave() {
    generation++;
    if (grant) {
      clearTimeout(grant.timer);
      grant.reject(new Error('Вы вышли из комнаты'));
      grant = null;
    }
    stopped = true;
    if (reconnect) clearTimeout(reconnect);
    if (heartbeat) clearInterval(heartbeat);
    send({ type: 'room.leave', payload: target() });
    const previous = socket;
    socket = null;
    previous?.close();
    media.dispose();
    state.joined = false;
    state.camera = false;
    state.peers = [];
    state.status = 'Готов к подключению';
    callState(false);
  }
  function volume(peer: string, value: number) {
    state.localVolumes[peer] = Math.max(0, Math.min(1, value));
    media.volume(peer, state.localVolumes[peer]);
  }
  function mute() {
    state.muted = !state.muted;
    media.mute(state.muted || Boolean(state.peers.find((peer) => peer.id === peerId)?.serverMuted));
    send({ type: 'room.peer.update', payload: { ...target(), patch: { muted: state.muted } } });
  }
  function outputBlocked(): boolean {
    return state.audioRevision > 0 && media.outputBlocked();
  }
  async function toggleOutput(): Promise<void> {
    if (!state.joined) return;
    if (state.outputMuted || !media.outputBlocked()) {
      state.outputMuted = !state.outputMuted;
      media.setOutputMuted(state.outputMuted);
    }
    if (state.outputMuted) return;
    const revision = generation;
    await media.resumeAudio();
    if (revision === generation && !media.outputBlocked() && state.error === WIDGET_AUDIO_BLOCKED_MESSAGE) {
      state.error = '';
    }
  }
  async function camera(enabled: boolean, deviceId = '') {
    if (!cameraAllowed) {
      if (enabled) throw new Error('Камера отключена для этого виджета');
      return;
    }
    if (enabled && grant) throw new Error('Подождите завершения настройки камеры');
    const revision = generation;
    const operation = ++cameraRevision;
    if (enabled)
      await new Promise<void>((resolve, reject) => {
        grant = {
          resolve,
          reject,
          timer: setTimeout(() => {
            grant = null;
            reject(new Error('Сервер не ответил на запрос камеры'));
          }, 10000)
        };
        send({ type: 'room.media.request', payload: { ...target(), kind: 'camera' } });
      });
    if (revision !== generation || operation !== cameraRevision) return;
    await media.camera(enabled, deviceId);
    if (revision !== generation || operation !== cameraRevision) return;
    state.camera = enabled;
    send({ type: 'room.peer.update', payload: { ...target(), patch: { camera: enabled } } });
  }
  return {
    state,
    media,
    camera,
    video(peer: string) {
      return state.audioRevision ? media.video(peer, peer === peerId) : undefined;
    },
    speaking(peer: string) {
      return state.audioRevision > 0 && media.speaking(peer);
    },
    connectionQuality() {
      return state.audioRevision > 0 ? media.connectionQuality() : 'unknown';
    },
    peerId,
    create,
    join,
    leave,
    capture,
    devices,
    mute,
    toggleOutput,
    outputBlocked,
    volume,
    report,
    send,
    target
  };
}
