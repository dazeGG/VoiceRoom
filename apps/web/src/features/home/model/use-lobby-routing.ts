// The lobby's address and every way into a room: a load or reload on /r/:id,
// the back button, ?dm= and mention links, links the desktop app hands over,
// and the "switch rooms?" and "open in the app?" questions on the way to voice.

import { ref } from 'vue';
import { useRouter, type Router } from 'vue-router';
import { useVoiceSessionStore } from '@voiceroom/call/engine';
import { useRoomUiStore } from '@/features/room/room-ui.store';
import { useFriendCallStore } from '@/features/friend-call/friend-call.store';
import { bindDesktopLinks, type DesktopLink } from '@/platform/desktop-links';
import {
  buildAppRoomLink,
  consumeInAppRoomNavigation,
  launchAppLink,
  readOpenInAppSignals,
  shouldOfferOpenInApp
} from '@/platform/open-in-app';
import { APP_HOME } from '@/shared/app-home';
import { usePageStore } from '@/stores/page.store';
import { extractRoomId } from '@/shared/utils/room';
import { shallowPush, shallowReplace } from '@/shared/utils/shallow-routing';
import type { LobbyStore } from './lobby.store';
import type { LobbyRooms } from './use-lobby-rooms';
import { useRoomNavigationStore } from './room-navigation.store';
import {
  applyRoomSwitchDecision,
  readRoomSwitchConfirmEnabled,
  shouldConfirmRoomSwitch
} from './room-switch-confirmation';

type RoutingLobby = Pick<LobbyStore, 'mode' | 'openDm' | 'showHome' | 'view' | 'selectedFriendId'>;
type RoutingRooms = Pick<LobbyRooms, 'left'>;

const roomPath = (roomId: string): string => `/r/${encodeURIComponent(roomId)}`;

function restoreLobbyDocumentState(): void {
  const page = usePageStore();
  page.screen = 'start';
  page.chatOpen = false;
  page.lobbyEmbedded = false;
  page.screenView = false;
  page.stripCollapsed = false;
  document.title = 'VoiceRoom';
}

/**
 * `lobby` and `rooms` are what the routing needs of the lobby store and the room list; `router` is
 * the app's router (the address changes go through it as shallow entries, shallow-routing.ts).
 */
export function useLobbyRouting(lobby: RoutingLobby, rooms: RoutingRooms, router: Router = useRouter()) {
  const navigation = useRoomNavigationStore();
  const voiceSession = useVoiceSessionStore();
  const calls = useFriendCallStore();

  /** Room waiting for "switch rooms?" while voice is connected elsewhere. */
  const pendingRoomSwitchId = ref('');
  /** Room a browser offered to open in the desktop app before joining voice. */
  const openInAppRoomId = ref('');
  /**
   * Which message a mention link asked to show, so the preview opens its chat on
   * it. Scoped to a room so it cannot leak into the next room previewed.
   */
  const previewAnchor = ref<{ roomId: string; messageId: string } | null>(null);

  function pushState(url: string): void {
    void shallowPush(router, url);
  }

  function replaceState(url: string): void {
    void shallowReplace(router, url);
  }

  /** Follows the address the page was opened on, the back button and desktop links; returns the teardown. */
  function start(): () => void {
    // On a fresh load/reload the URL is the only persisted state, so a /r/:id
    // route means the user wants to be back inside that room. Enter with
    // auto-join (like the "Войти" button) instead of only previewing — otherwise
    // temporary rooms (absent from "Мои комнаты") leave the user stranded on the
    // rooms home with the route still pointing at the room.
    const initialRoomId = extractRoomId(window.location.pathname);
    if (initialRoomId && calls.voice) {
      previewRoom(initialRoomId);
    } else if (initialRoomId && shouldOfferOpenInApp(readOpenInAppSignals()) && !consumeInAppRoomNavigation()) {
      // The browser cannot tell whether the desktop app picked the link up, so
      // it waits for an explicit choice instead of joining voice twice.
      openInAppRoomId.value = initialRoomId;
      lobby.mode = 'rooms';
      openRoomInApp();
    } else if (initialRoomId) {
      navigation.selectRoomForVoiceEntry(initialRoomId);
      lobby.mode = 'rooms';
    }
    const initialParams = new URLSearchParams(window.location.search);
    const initialDmId = initialParams.get('dm');
    if (!initialRoomId && initialDmId) {
      replaceState(APP_HOME);
      void lobby.openDm(initialDmId);
    }
    // A mention link — from the bell or from a push — lands here rather than on
    // /r/:roomId, so it previews the room and never joins voice.
    const linkedRoomId = initialParams.get('room');
    const linkedMessageId = initialParams.get('message');
    if (!initialRoomId && linkedRoomId && linkedMessageId) {
      replaceState(APP_HOME);
      openRoomMessage(linkedRoomId, linkedMessageId);
    }

    const stopDmHandoff = router.afterEach((to, from, failure) => {
      if (
        !failure &&
        typeof to.query.dm === 'string' &&
        to.query.dm !== from.query.dm &&
        (lobby.view !== 'dm' || lobby.selectedFriendId !== to.query.dm)
      ) {
        void lobby.openDm(to.query.dm);
      } else if (!failure && from.query.call && !to.query.call && !to.query.dm && !to.params.roomId) {
        lobby.showHome();
      }
    });
    const teardownDesktopLinks = bindDesktopLinks(openDesktopLink);
    window.addEventListener('popstate', onPopState);
    return () => {
      teardownDesktopLinks();
      stopDmHandoff();
      window.removeEventListener('popstate', onPopState);
    };
  }

  // Every way into voice goes through here, so switching away from a live call
  // always gets the same question.
  const requestEnterRoom = (roomId: string): void => {
    const needsConfirmation = shouldConfirmRoomSwitch({
      confirmEnabled: readRoomSwitchConfirmEnabled(),
      connectedRoomId: voiceSession.roomId,
      targetRoomId: roomId
    });
    if (needsConfirmation) {
      pendingRoomSwitchId.value = roomId;
      return;
    }
    void enterRoom(roomId);
  };

  const resolveRoomSwitch = (proceed: boolean, dontAskAgain = false): void => {
    const roomId = pendingRoomSwitchId.value;
    pendingRoomSwitchId.value = '';
    if (roomId && applyRoomSwitchDecision({ dontAskAgain, proceed })) void enterRoom(roomId);
  };

  const openRoomInApp = (): void => {
    const link = buildAppRoomLink(openInAppRoomId.value, window.location.hostname);
    if (!link) {
      continueRoomInBrowser();
      return;
    }
    launchAppLink(link);
  };

  const continueRoomInBrowser = (): void => {
    const roomId = openInAppRoomId.value;
    openInAppRoomId.value = '';
    if (!roomId) return;
    navigation.selectRoomForVoiceEntry(roomId);
    lobby.mode = 'rooms';
  };

  const previewRoom = (roomId: string): void => {
    navigation.selectRoomPreview(roomId);
    lobby.mode = 'rooms';
    replaceUrlWithActiveVoiceRoom();
  };

  const closeViewedRoom = (): void => {
    const transition = navigation.routeToHome();
    if (transition.closeEmbeddedRoom) closeEmbeddedRoom({ replaceUrl: false });
    replaceUrlWithActiveVoiceRoom();
  };

  const goHome = (): void => {
    const { call, dm } = router.currentRoute.value.query;
    lobby.showHome();
    if (!call && navigation.viewedRoomId) closeViewedRoom();
    else if (!call && dm) void shallowPush(router, APP_HOME);
  };

  /** The room shown here was left from its own leave button. */
  const closeLeftRoom = (closedRoomId: string): void => {
    const closedViewedRoom = Boolean(closedRoomId && navigation.viewedRoomId === closedRoomId);
    rooms.left(closedRoomId);
    closeEmbeddedRoom({ closedRoomId });
    if (closedViewedRoom) navigation.clearViewedRoom();
  };

  const openConnectedVoiceRoom = (): void => {
    const openedRoomId = navigation.openActiveVoiceRoom();
    if (!openedRoomId) return;
    lobby.mode = 'rooms';
    pushState(roomPath(openedRoomId));
  };

  const leaveConnectedVoiceRoom = async (): Promise<void> => {
    const leavingRoomId = navigation.getActiveVoiceRoomId();
    const transition = navigation.leaveViewedConnectedRoom(leavingRoomId);
    await voiceSession.leaveActiveVoiceRoomWithCue();
    rooms.left(leavingRoomId);
    if (transition.closeEmbeddedRoom) {
      closeEmbeddedRoom();
      navigation.clearViewedRoom();
    }
    replaceUrlWithActiveVoiceRoom(null);
  };

  /**
   * Show a message in its room without joining voice. The old route went through
   * /r/:roomId, which on load means "put me back inside this room" and joined —
   * and it reloaded the page while still failing to open the chat.
   */
  const openRoomMessage = (roomId: string, messageId: string): void => {
    hideCall();
    lobby.mode = 'rooms';
    if (navigation.getActiveVoiceRoomId() === roomId) {
      // Already in that room: its own chat is the one to show.
      navigation.openActiveVoiceRoom();
      useRoomUiStore().openChat();
      return;
    }
    previewAnchor.value = { roomId, messageId };
    navigation.selectRoomPreview(roomId);
  };

  // Explicit voice enter/switch path. Browsing a room uses previewRoom(); this
  // path may remount the room client because the user chose to enter voice here.
  async function enterRoom(roomId: string): Promise<void> {
    if (calls.voice) {
      await calls.leave();
      if (calls.voice) return;
    }
    navigation.selectRoomForVoiceEntry(roomId);
    lobby.mode = 'rooms';
    pushState(roomPath(roomId));
  }

  function replaceUrlWithActiveVoiceRoom(roomId: string | null = navigation.getActiveVoiceRoomId()): void {
    const target = roomId ? roomPath(roomId) : APP_HOME;
    if (`${window.location.pathname}${window.location.search}` === target) return;
    replaceState(target);
  }

  function closeEmbeddedRoom({
    replaceUrl = true,
    closedRoomId = navigation.mountedRoomId()
  }: { replaceUrl?: boolean; closedRoomId?: string | null } = {}): void {
    const shouldReplaceUrl = Boolean(
      replaceUrl && closedRoomId && extractRoomId(window.location.pathname) === closedRoomId
    );
    navigation.clearEmbeddedRoom();
    restoreLobbyDocumentState();
    if (shouldReplaceUrl) {
      const connectedRoomId = navigation.getActiveVoiceRoomId();
      replaceUrlWithActiveVoiceRoom(connectedRoomId === closedRoomId ? null : connectedRoomId);
    }
  }

  const openDesktopLink = (link: DesktopLink): void => {
    if (link.kind === 'room') requestEnterRoom(link.roomId);
    else if (link.kind === 'mention') openRoomMessage(link.roomId, link.messageId);
    else if (link.kind === 'dm') void lobby.openDm(link.dmId);
  };

  const onPopState = (): void => {
    const roomId = extractRoomId(window.location.pathname);
    // The back button out of the lobby (to /login, /privacy, ...): that page
    // takes over, and rewriting its entry would swallow the move.
    if (!roomId && window.location.pathname !== APP_HOME) return;
    const params = new URLSearchParams(window.location.search);
    if (!roomId && (params.has('call') || params.has('dm'))) return;
    if (roomId) {
      navigation.setViewedRoomFromRoute(roomId);
      lobby.mode = 'rooms';
      replaceUrlWithActiveVoiceRoom();
      return;
    }
    const transition = navigation.routeToHome();
    if (transition.closeEmbeddedRoom) closeEmbeddedRoom({ replaceUrl: false });
    replaceUrlWithActiveVoiceRoom();
  };

  function hideCall(peerId?: string): void {
    if (!router.currentRoute.value.query.call) return;
    const target = peerId ? `${APP_HOME}?dm=${encodeURIComponent(peerId)}` : APP_HOME;
    // Keep the call entry in history so Back returns to the same engine.
    void shallowPush(router, target);
  }

  return {
    pendingRoomSwitchId,
    openInAppRoomId,
    previewAnchor,
    start,
    requestEnterRoom,
    resolveRoomSwitch,
    openRoomInApp,
    continueRoomInBrowser,
    previewRoom,
    closeViewedRoom,
    goHome,
    closeLeftRoom,
    openConnectedVoiceRoom,
    leaveConnectedVoiceRoom,
    openRoomMessage,
    hideCall
  };
}

export type LobbyRouting = ReturnType<typeof useLobbyRouting>;
