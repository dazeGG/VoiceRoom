import type { CallPorts, IdentityPort } from '@voiceroom/call/engine/ports';
import type { VoiceAssetUrls } from '@voiceroom/call/voice-assets';
import { classifyPlatform } from '@voiceroom/shared/platform-class';
import { createLogger } from '@voiceroom/ui/log';
import type { MeetTransport } from '@/adapters/meet-transport';

export function createMeetPorts({
  identity,
  transport,
  assets,
  navigateToRoom,
  goHome
}: {
  identity: IdentityPort;
  transport: MeetTransport;
  assets: VoiceAssetUrls;
  navigateToRoom: (roomId: string) => void;
  goHome: () => void;
}): CallPorts {
  const preferences = new Map<string, string>();
  const platformClass = classifyPlatform({ userAgent: navigator.userAgent, maxTouchPoints: navigator.maxTouchPoints });

  return {
    identity,
    transport,
    assets,
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
        return transport.capabilities.value?.camera !== false;
      }
    },
    host: {
      createRoom: async () => '',
      isDeletingRoom: () => false,
      closeParticipantMenu: () => {},
      showLeaveScreen: () => {},
      setCallActive: () => {},
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
      navigateToRoom,
      goHome,
      forceRelay: () => false,
      traceLiveKit: () => false,
      desktop: {}
    }
  };
}
