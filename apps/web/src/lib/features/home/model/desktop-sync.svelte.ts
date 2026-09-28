// Keeps the desktop shell in step with the lobby: the tray's call controls and
// state, the in-game overlay, the diagnostics context and the unread badge.
// Every call is a no-op in a browser. Call during component setup, with a
// source whose fields are getters, so each sync re-runs only for what it reads.

import type { OwnedRoom } from '$lib/api/auth';
import type { Friend } from '$lib/api/friends';
import { roomPresence } from '$lib/entities/room/room-presence.svelte';
import { getSortedParticipants } from '$lib/features/room/participants-ui.svelte';
import { toggleActiveVoiceDeafen, toggleActiveVoiceMic, voiceSession } from '$lib/features/room/voice-session.svelte';
import { countUnreadForBadge, syncDesktopBadgeCount } from '$lib/platform/desktop-attention';
import { bindDesktopCallActions, syncDesktopCallState } from '$lib/platform/desktop-call';
import { syncDesktopDiagnosticsContext } from '$lib/platform/desktop-diagnostics';
import { syncDesktopOverlaySnapshot } from '$lib/platform/desktop-overlay';
import { notificationPreferences } from '$lib/shared/notifications/preferences.svelte';

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
  $effect(() => {
    const unbind = bindDesktopCallActions({
      'toggle-mic': toggleActiveVoiceMic,
      'toggle-output': toggleActiveVoiceDeafen,
      disconnect: () => source.onDisconnect()
    });
    return () => {
      unbind();
      syncDesktopCallState({ active: false, micMuted: false, outputMuted: false, roomId: '', roomName: '' });
      syncDesktopBadgeCount(0);
    };
  });

  $effect(() => {
    syncDesktopCallState({
      active: Boolean(source.voiceRoomId),
      micMuted: voiceSession.muted,
      outputMuted: voiceSession.deafened,
      roomId: source.voiceRoomId,
      roomName: source.voiceRoomName
    });
  });

  $effect(() => {
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

  $effect(() => {
    syncDesktopDiagnosticsContext({ roomId: source.voiceRoomId, userId: source.userId });
  });

  // Muted chats stay out of the icon count; the mention cue is not affected by
  // room mutes.
  $effect(() => {
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
