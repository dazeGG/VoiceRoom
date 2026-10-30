// Keeps the desktop shell in step with the lobby: the tray's call controls and
// state, the in-game overlay, the diagnostics context and the unread badge.
// Every call is a no-op in a browser. Call during component setup, with a
// source whose fields are getters, so each sync re-runs only for what it reads.

import { watchEffect } from 'vue';
import type { OwnedRoom } from '@/api/auth';
import type { Friend } from '@/api/friends';
import { useRoomPresenceStore } from '@/entities/room/room-presence.store';
import { useParticipantsUiStore } from '@/features/room/participants-ui.store';
import { useVoiceSessionStore } from '@/features/room/voice-session.store';
import { countUnreadForBadge, syncDesktopBadgeCount } from '@/platform/desktop-attention';
import { bindDesktopCallActions, syncDesktopCallState } from '@/platform/desktop-call';
import { syncDesktopDiagnosticsContext } from '@/platform/desktop-diagnostics';
import { syncDesktopOverlaySnapshot } from '@/platform/desktop-overlay';
import { useNotificationPreferencesStore } from '@/shared/notifications/preferences.store';

export interface DesktopSyncSource {
  userId: string;
  /** The room voice is connected to, '' when none. */
  voiceRoomId: string;
  voiceRoomName: string;
  friends: Friend[];
  rooms: OwnedRoom[];
  onDisconnect: () => void;
}

export function syncLobbyWithDesktop(source: DesktopSyncSource): void {
  const voiceSession = useVoiceSessionStore();
  const { getSortedParticipants } = useParticipantsUiStore();
  const roomPresence = useRoomPresenceStore();
  const { notificationPreferences } = useNotificationPreferencesStore();

  watchEffect((onCleanup) => {
    const unbind = bindDesktopCallActions({
      'toggle-mic': voiceSession.toggleActiveVoiceMic,
      'toggle-output': voiceSession.toggleActiveVoiceDeafen,
      disconnect: () => source.onDisconnect()
    });
    onCleanup(() => {
      unbind();
      syncDesktopCallState({ active: false, micMuted: false, outputMuted: false, roomId: '', roomName: '' });
      syncDesktopBadgeCount(0);
    });
  });

  watchEffect(() => {
    syncDesktopCallState({
      active: Boolean(source.voiceRoomId),
      micMuted: voiceSession.muted,
      outputMuted: voiceSession.deafened,
      roomId: source.voiceRoomId,
      roomName: source.voiceRoomName
    });
  });

  watchEffect(() => {
    if (!source.voiceRoomId) {
      syncDesktopOverlaySnapshot([]);
      return;
    }
    syncDesktopOverlaySnapshot(
      getSortedParticipants().map((participant) => ({
        avatarAccent: participant.avatarAccent || '',
        avatarColorKey: participant.avatarColorKey || '',
        avatarUrl: participant.avatarUrl || '',
        id: participant.id,
        micMuted: participant.muted,
        name: participant.name || '',
        outputMuted: participant.deafened,
        self: participant.isLocal,
        speaking: participant.speaking,
        streaming: participant.screen
      }))
    );
  });

  watchEffect(() => {
    syncDesktopDiagnosticsContext({ roomId: source.voiceRoomId, userId: source.userId });
  });

  // Muted chats stay out of the icon count; the mention cue is not affected by
  // room mutes.
  watchEffect(() => {
    syncDesktopBadgeCount(
      countUnreadForBadge({
        friends: source.friends,
        mutes: notificationPreferences,
        roomUnreadById: roomPresence.unreadCountByRoomId,
        rooms: source.rooms
      })
    );
  });
}
