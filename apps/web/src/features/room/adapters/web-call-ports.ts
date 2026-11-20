import { isRecord } from '@voice-room/shared/guards';
import type { Pinia } from 'pinia';
import { addRoomByCode, fetchOwnedRooms, type AuthUser } from '@/api/auth';
import { useSessionStore } from '@/features/auth/session.store';
import { useCallFeedbackStore } from '@/features/call-feedback/call-feedback.store';
import { guestBrowserId } from '@/entities/room/guest-id';
import { getDesktopBoundaryPolicy } from '@/platform/desktop-boundary';
import { isAppVisible, onAppVisibilityChange } from '@/platform/app-visibility';
import { markInAppRoomNavigation } from '@/platform/open-in-app';
import { APP_HOME } from '@/shared/app-home';
import { displayNameOf } from '@/shared/utils/display-name';
import {
  createLogger,
  errorContext,
  installGlobalErrorCapture,
  reportClientLogs,
  reportVoiceJoinOutcome
} from '@/shared/log';
import type { CallIdentity, CallPorts, EntryIdentity } from '@voice-room/call/engine/ports';

import { createRoom } from '@/api/rooms';
import { useRoomMembershipStore } from '@/entities/room/room-membership.store';
import { voiceAssets } from '@/shared/media/voice-assets';
import { readStorage, removeStorage, writeStorage } from '@/shared/storage';
import { useCallActivityStore } from '@/shared/call-activity.store';
import { usePlaybackPolicyStore } from '@/shared/audio/playback-policy.store';
import { getStoredPeerSession, rotateStoredPeerSession } from './web-peer-session';
import { webCallDesktop } from './web-call-desktop';
import { webCallTransport } from './web-call-transport';
import { useLeaveScreenStore } from '../leave-screen.store';
import { useParticipantContextUiStore } from '../participant-context-ui.store';

// main.ts installs this adapter, so everything imported here lands in the first
// chunk of every page. Room modules load lazily, where only a room needs them.

const log = createLogger('room');

function identityOf(user: AuthUser | null): CallIdentity {
  if (!user) {
    return {
      kind: 'guest',
      profile: null,
      // Read the browser id only when the caller actually needs a report id.
      get feedbackGuestId() {
        return guestBrowserId();
      }
    };
  }
  return {
    kind: 'account',
    profile: {
      displayName: displayNameOf(user),
      avatarAccent: user.avatarAccent || '',
      avatarColorKey: user.avatarColorKey || '',
      avatarUrl: user.avatarUrl || ''
    }
  };
}

/** Captures this application's Pinia; importing the adapter never acquires stores. */
export function createWebCallPorts(pinia: Pinia): CallPorts {
  return {
    storage: { read: readStorage, write: writeStorage, remove: removeStorage },
    transport: webCallTransport,
    assets: voiceAssets,
    diagnostics: {
      logger: createLogger,
      report: reportClientLogs,
      reportJoinOutcome: reportVoiceJoinOutcome,
      installGlobalErrorCapture,
      buildVersion: () => import.meta.env.VITE_APP_VERSION || 'unknown'
    },
    mediaPolicy: { camera: true },
    identity: {
      credentials: getStoredPeerSession,
      rotateCredentials: rotateStoredPeerSession,
      current: () => identityOf(useSessionStore(pinia).user),
      knownEntry({ embedded }) {
        const session = useSessionStore(pinia);
        if (!embedded || !session.user) return null;
        const context = session.context();
        return { identity: identityOf(session.user), isCurrent: () => session.isCurrent(context) };
      },
      async verifyEntry(): Promise<EntryIdentity> {
        const session = useSessionStore(pinia);
        const result = await session.verifySession();
        if (!result.applied) return { identity: identityOf(null), isCurrent: () => false };
        return { identity: identityOf(result.user), isCurrent: () => session.isCurrent(result.context) };
      }
    },
    host: {
      createRoom,
      isDeletingRoom: () => {
        const settings: unknown = pinia.state.value['room-settings'];
        return isRecord(settings) && settings.deleting === true;
      },
      closeParticipantMenu: (peerId) => useParticipantContextUiStore(pinia).closeParticipantContextMenu(peerId),
      showLeaveScreen: (input) => useLeaveScreenStore(pinia).openLeaveScreen(input),
      setCallActive: (active) => {
        useCallActivityStore(pinia).active = active;
      },
      leaveMembership: (roomId) => useRoomMembershipStore(pinia).leaveActiveRoomMembership(roomId),
      suppressCuePlayback: () => usePlaybackPolicyStore(pinia).isDoNotDisturbPlaybackSuppressed(),
      entered({ roomId, isStatic, isCurrent, roomsChanged }) {
        // Keep bookmark and owner lookup independent and nonblocking, in that order.
        if (isCurrent() && roomId && isStatic) {
          void addRoomByCode(roomId)
            .then(() => {
              if (isCurrent()) roomsChanged();
            })
            .catch((error: unknown) => log.debug('room auto-save skipped', errorContext(error)));
        }
        if (!isCurrent()) return;
        // Settings/delete UI is owner-only; nothing in a join waits for the answer.
        void Promise.all([fetchOwnedRooms(), import('../room-settings.store')])
          .then(([owned, { useRoomSettingsStore }]) => {
            if (!isCurrent()) return;
            useRoomSettingsStore(pinia).isOwner = owned.some(
              (room) => room.roomId === roomId && room.relationship === 'owner'
            );
          })
          .catch((error: unknown) => log.warn('failed to resolve room ownership', errorContext(error)));
      }
    },
    feedback: {
      drop: () => useCallFeedbackStore(pinia).dropCallFeedback(),
      finished: (call) => useCallFeedbackStore(pinia).noteCallFinished(call),
      offer: () => useCallFeedbackStore(pinia).offerCallFeedback()
    },
    platform: {
      policy: getDesktopBoundaryPolicy,
      isVisible: isAppVisible,
      onVisibilityChange: onAppVisibilityChange,
      prepareRoomNavigation: markInAppRoomNavigation,
      navigateToRoom: (roomId, method) => {
        const path = `/r/${encodeURIComponent(roomId)}`;
        if (method === 'assign') window.location.assign(path);
        else window.location.href = path;
      },
      goHome: () => {
        window.location.href = APP_HOME;
      },
      forceRelay: () => new URLSearchParams(window.location.search).get('forceRelay') === '1',
      traceLiveKit: () => ['localhost', '127.0.0.1', '::1'].includes(window.location.hostname),
      desktop: webCallDesktop
    }
  };
}
