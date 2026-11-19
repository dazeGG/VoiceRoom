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
import { createLogger, errorContext } from '@/shared/log';
import { usePageStore } from '@/stores/page.store';
import { useRoomSettingsStore } from '../room-settings.store';
import { getRoomShell } from '../client/core/embed';
import { state } from '../client/core/room-runtime.store';
import type { CallIdentity, CallPorts, EntryIdentity } from '../client/ports';

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
    identity: {
      current: () => identityOf(useSessionStore(pinia).user),
      verifyEntry({ embedded }) {
        const session = useSessionStore(pinia);
        if (embedded && session.user) {
          const context = session.context();
          return { identity: identityOf(session.user), isCurrent: () => session.isCurrent(context) };
        }
        return session.verifySession().then((result): EntryIdentity => {
          if (!result.applied) return { identity: identityOf(null), isCurrent: () => false };
          return { identity: identityOf(result.user), isCurrent: () => session.isCurrent(result.context) };
        });
      }
    },
    host: {
      entered({ roomId, isStatic, entry }) {
        const current = () => entry.isCurrent() && state.roomId === roomId;
        // Keep bookmark and owner lookup independent and nonblocking, in that order.
        if (current() && roomId && isStatic) {
          void addRoomByCode(roomId)
            .then(() => {
              if (current()) getRoomShell().roomsChanged(roomId);
            })
            .catch((error: unknown) => log.debug('room auto-save skipped', errorContext(error)));
        }
        if (!current()) return;
        void fetchOwnedRooms()
          .then((owned) => {
            if (!current()) return;
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
      page: {
        read: () => usePageStore(pinia),
        patch: (patch) => usePageStore(pinia).$patch(patch)
      }
    }
  };
}
