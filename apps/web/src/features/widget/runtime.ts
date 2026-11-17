import { reactive } from 'vue';
import { LiveKitAdmission } from '@voice-room/shared/contracts/admission';
import { WidgetRoomCreated, WidgetRoomInfo } from '@voice-room/shared/contracts/widget';
import { MessageDeleted, RoomMessageAnswer, type RoomMessage } from '@voice-room/shared/contracts/messages';
import type { PublicPeer } from '@voice-room/shared/contracts/rooms';
import { parseServerFrame } from '@voice-room/shared/realtime';
import type { ClientCommand } from '@voice-room/shared/contracts/realtime';
import { widgetRequest } from './http';
import { widgetProof } from './proof';
import { WidgetMedia } from './media';

export function createWidgetRuntime(mount: HTMLElement, chatPreference: boolean, callState: (active: boolean) => void) {
  const localVolumes: Record<string, number> = {};
  const peers: PublicPeer[] = [];
  const messages: RoomMessage[] = [];
  const devicesList: MediaDeviceInfo[] = [];
  const settings: { noise: 'rnnoise' | 'browser' | 'off' } = { noise: 'rnnoise' };
  const state = reactive({
    roomId: '',
    name: '',
    status: 'Готов к подключению',
    error: '',
    joined: false,
    muted: false,
    camera: false,
    chat: false,
    peers,
    localVolumes,
    messages,
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
    }
  );
  let socket: WebSocket | null = null;
  let stopped = false;
  let reconnect: ReturnType<typeof setTimeout> | undefined;
  let generation = 0;
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
    state.devices = await navigator.mediaDevices.enumerateDevices();
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
            state.messages = state.chat ? frame.payload.recentMessages : [];
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
          case 'room.chat.message':
            if (state.chat) state.messages.push(frame.payload.message);
            break;
          case 'room.chat.edited':
            if (state.chat)
              state.messages = state.messages.map((message) =>
                message.id === frame.payload.message.id ? frame.payload.message : message
              );
            break;
          case 'room.chat.deleted':
            state.messages = state.messages.filter((message) => message.id !== frame.payload.messageId);
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
    state.chat = room.chat && chatPreference;
    openSocket();
  }
  async function create() {
    const revision = generation;
    const proof = await widgetProof();
    if (revision !== generation) return;
    const room = await widgetRequest('/api/widget/rooms', WidgetRoomCreated, {
      chat: chatPreference,
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
    state.messages = [];
    state.status = 'Готов к подключению';
    callState(false);
  }
  async function text(text: string) {
    if (!state.chat || !text.trim()) return;
    await widgetRequest(`/api/widget/rooms/${encodeURIComponent(state.roomId)}/messages`, RoomMessageAnswer, {
      ...target(),
      name: state.name || 'Гость',
      text
    });
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
  async function deleteText(messageId: string) {
    if (!state.chat) return;
    await widgetRequest(
      `/api/widget/rooms/${encodeURIComponent(state.roomId)}/messages/${encodeURIComponent(messageId)}`,
      MessageDeleted,
      { peerId, sessionToken },
      'DELETE'
    );
  }
  async function camera(enabled: boolean, deviceId = '') {
    const revision = generation;
    if (enabled)
      await new Promise<void>((resolve, reject) => {
        if (grant) {
          reject(new Error('Подождите завершения настройки камеры'));
          return;
        }
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
    if (revision !== generation) return;
    await media.camera(enabled, deviceId);
    state.camera = enabled;
    send({ type: 'room.peer.update', payload: { ...target(), patch: { camera: enabled } } });
  }
  return {
    state,
    media,
    camera,
    peerId,
    create,
    join,
    leave,
    capture,
    devices,
    text,
    deleteText,
    mute,
    volume,
    report,
    send,
    target
  };
}
