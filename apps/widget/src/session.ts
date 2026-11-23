import { computed, inject, reactive, shallowRef, type InjectionKey } from 'vue';
import { createGuestJoinController, createGuestTransport } from '@voiceroom/call/guest';
import { state } from '@voiceroom/call/engine/core/room-runtime.store';
import type { CallIdentity, CallPorts, IdentityPort } from '@voiceroom/call/engine/ports';
import type { PeerSession } from '@voiceroom/call/engine/core/types';
import { LiveKitAdmission } from '@voiceroom/shared/contracts/admission';
import { WidgetRoomCreated, WidgetRoomInfo } from '@voiceroom/shared/contracts/widget';
import { classifyPlatform } from '@voiceroom/shared/platform-class';
import { cleanGuestName } from '@voiceroom/shared/validation';
import { createLogger } from '@voiceroom/ui/log';
import { WidgetApiError, widgetErrorMessage, widgetRequest } from './http';
import { widgetProof } from './proof';
import { voiceAssets } from './voice-assets';

function createFrameIdentity() {
  let roomId = '';
  let session: PeerSession | undefined;
  let displayName = 'Гость';

  function current(): CallIdentity {
    return { kind: 'guest', profile: { displayName, avatarAccent: '', avatarColorKey: '', avatarUrl: '' } };
  }

  function rotateCredentials(nextRoomId: string): PeerSession {
    const bytes = crypto.getRandomValues(new Uint8Array(32));
    roomId = nextRoomId;
    session = {
      peerId: crypto.randomUUID(),
      sessionToken: Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')
    };
    return session;
  }

  const identity: IdentityPort = {
    current,
    credentials: (code) => (session && code === roomId ? session : rotateCredentials(code)),
    rotateCredentials,
    knownEntry: () => null,
    async verifyEntry() {
      const verifiedName = displayName;
      return { identity: current(), isCurrent: () => displayName === verifiedName };
    }
  };

  return {
    identity,
    setDisplayName: (name: string) => {
      displayName = name;
    },
    joinIdentity: { guestId: crypto.randomUUID(), clientId: crypto.randomUUID() }
  };
}

export function createWidgetSession({
  camera,
  setCallActive
}: {
  camera: boolean;
  setCallActive: (active: boolean) => void;
}) {
  const { identity, setDisplayName, joinIdentity } = createFrameIdentity();
  const controller = shallowRef<ReturnType<typeof createGuestJoinController> | null>(null);
  let pending: AbortController | undefined;
  const busy = shallowRef(false);
  const error = shallowRef('');
  const admission = createGuestTransport('/api/widget/ws', {
    joinIdentity,
    status,
    async admit(input, signal) {
      const result = await widgetRequest('/api/widget/livekit-token', LiveKitAdmission, input, signal);
      return { ...result, urls: [result.url] };
    },
    message: widgetErrorMessage,
    failure: (reason) => (reason instanceof WidgetApiError ? reason : null),
    onPolicyClose() {
      // Recovery and owner-fence loss close widget sockets with a policy violation.
      leave();
      error.value = widgetErrorMessage('room_not_found');
    }
  });

  async function status(code: string, signal?: AbortSignal) {
    try {
      const room = await widgetRequest(
        `/api/widget/rooms/${encodeURIComponent(code)}`,
        WidgetRoomInfo,
        undefined,
        signal
      );
      return {
        roomId: room.roomId,
        peers: room.peers,
        capabilities: room.capabilities ?? {
          camera: true,
          screenShare: false,
          chat: 'none',
          maxPeers: room.maxRoomPeers
        }
      } as const;
    } catch (reason) {
      if (reason instanceof WidgetApiError && reason.status === 404) return null;
      throw reason;
    }
  }

  const cameraAllowed = computed(() => camera && controller.value?.capabilities.value?.camera === true);
  const preferences = reactive(new Map<string, string>());
  const platformClass = classifyPlatform({ userAgent: navigator.userAgent, maxTouchPoints: navigator.maxTouchPoints });
  const ports: CallPorts = {
    identity,
    transport: admission,
    assets: voiceAssets,
    storage: {
      read: (key) => preferences.get(key) ?? null,
      write: (key, value) => {
        preferences.set(key, value);
      },
      remove: (key) => {
        preferences.delete(key);
      }
    },
    diagnostics: {
      logger: createLogger,
      report: async () => false,
      installGlobalErrorCapture: () => {},
      buildVersion: () => 'unknown',
      reportJoinOutcome: () => {}
    },
    mediaPolicy: {
      get camera() {
        return cameraAllowed.value;
      }
    },
    host: {
      createRoom: async () => '',
      isDeletingRoom: () => false,
      closeParticipantMenu: () => {},
      showLeaveScreen: () => {},
      setCallActive,
      leaveMembership: async () => false,
      suppressCuePlayback: () => false,
      entered: () => {}
    },
    feedback: { drop: () => {}, finished: () => {}, offer: () => {} },
    platform: {
      policy: () => ({ roomClientAllowed: true, desktopAllowed: platformClass !== 'mobile', platformClass }),
      isVisible: () => !document.hidden,
      onVisibilityChange(listener) {
        const onChange = () => listener(!document.hidden);
        document.addEventListener('visibilitychange', onChange);
        return () => document.removeEventListener('visibilitychange', onChange);
      },
      prepareRoomNavigation: () => {},
      navigateToRoom: () => {},
      goHome: () => {},
      forceRelay: () => false,
      traceLiveKit: () => false,
      desktop: {}
    }
  };

  const phase = computed(() => controller.value?.phase.value);
  const joined = computed(() => phase.value === 'call' || phase.value === 'reconnecting');
  const entry = reactive({
    name: '',
    joined,
    busy,
    cameraAllowed,
    roomId: computed(() => controller.value?.room.value?.roomId ?? ''),
    status: computed(() => {
      if (phase.value === 'reconnecting') return 'Связь потеряна. Переподключение…';
      if (joined.value) return 'В комнате';
      return busy.value ? 'Подключение' : 'Готов к подключению';
    }),
    error: computed(() => {
      if (phase.value === 'closed' || phase.value === 'not-found') return widgetErrorMessage('room_not_found');
      return error.value;
    })
  });

  function report(reason: unknown): void {
    error.value = reason instanceof Error ? reason.message : 'Не удалось подключиться';
  }

  async function enter(resolveCode: (signal: AbortSignal) => Promise<string>): Promise<void> {
    if (busy.value || joined.value) return;
    leave();
    const operation = new AbortController();
    pending = operation;
    error.value = '';
    busy.value = true;
    try {
      const roomId = await resolveCode(operation.signal);
      if (operation.signal.aborted) return;
      const guest = createGuestJoinController({
        roomId,
        status: (code) => status(code, operation.signal),
        setDisplayName,
        admissionCapabilities: admission.capabilities
      });
      controller.value = guest;
      await guest.check();
      if (operation.signal.aborted) return;
      await guest.join(entry.name.trim() ? cleanGuestName(entry.name) : 'Гость');
      if (operation.signal.aborted) return;
      if (guest.failure.value === 'status') error.value = 'Не удалось проверить комнату';
      if (guest.failure.value === 'join' && !state.joined) error.value = 'Не удалось подключить голос';
    } catch (reason) {
      if (!operation.signal.aborted) report(reason);
    } finally {
      if (pending === operation) {
        pending = undefined;
        busy.value = false;
      }
    }
  }

  function leave(): void {
    pending?.abort();
    pending = undefined;
    busy.value = false;
    const guest = controller.value;
    controller.value = null;
    guest?.dispose();
    admission.disconnect();
    error.value = '';
  }

  return {
    ports,
    entry,
    create: () =>
      enter(async (signal) => {
        const proof = await widgetProof(signal);
        const room = await widgetRequest(
          '/api/widget/rooms',
          WidgetRoomCreated,
          { chat: false, ...(proof ? { proof } : {}) },
          signal
        );
        return room.roomId;
      }),
    join: (code: string) => enter(async () => code.trim()),
    leave,
    dispose: leave,
    report
  };
}

export const widgetSessionKey: InjectionKey<ReturnType<typeof createWidgetSession>> = Symbol('widget-session');

export function useWidgetSession() {
  const session = inject(widgetSessionKey);
  if (!session) throw new Error('Widget session is not installed');
  return session;
}
