// The lobby's address and every way into a room: a load or reload on /r/:id,
// the back button, ?dm= and mention links, links the desktop app hands over,
// and the "switch rooms?" and "open in the app?" questions on the way to voice.

import { pushState, replaceState } from '$app/navigation';
import { resolve } from '$app/paths';
import { SvelteURLSearchParams } from 'svelte/reactivity';
import { leaveActiveVoiceRoomWithCue } from '$lib/features/room/voice-session.svelte';
import { openChat } from '$lib/features/room/room-ui.svelte';
import { bindDesktopLinks, type DesktopLink } from '$lib/platform/desktop-links';
import {
  buildAppRoomLink,
  consumeInAppRoomNavigation,
  launchAppLink,
  readOpenInAppSignals,
  shouldOfferOpenInApp
} from '$lib/platform/open-in-app';
import { extractRoomId } from '$lib/shared/utils/room';
import type { LobbyStore } from './lobby.svelte';
import type { LobbyRooms } from './lobby-rooms.svelte';
import {
  clearEmbeddedRoom,
  clearViewedRoom,
  getActiveVoiceRoomId,
  leaveViewedConnectedRoom,
  mountedRoomId,
  openActiveVoiceRoom,
  roomNavigation,
  routeToHome,
  selectRoomForVoiceEntry,
  selectRoomPreview,
  setViewedRoomFromRoute
} from './room-navigation.svelte';
import {
  applyRoomSwitchDecision,
  readRoomSwitchConfirmEnabled,
  shouldConfirmRoomSwitch
} from './room-switch-confirmation';

type RoutingLobby = Pick<LobbyStore, 'mode' | 'openDm' | 'showHome'>;
type RoutingRooms = Pick<LobbyRooms, 'left'>;

function restoreLobbyDocumentState(): void {
  document.body.dataset.screen = 'start';
  delete document.body.dataset.chatOpen;
  delete document.body.dataset.lobbyEmbedded;
  delete document.body.dataset.screenView;
  delete document.body.dataset.stripCollapsed;
  document.title = 'VoiceRoom';
}

export class LobbyRouting {
  /** Room waiting for "switch rooms?" while voice is connected elsewhere. */
  pendingRoomSwitchId = $state('');
  /** Room a browser offered to open in the desktop app before joining voice. */
  openInAppRoomId = $state('');
  /**
   * Which message a mention link asked to show, so the preview opens its chat on
   * it. Scoped to a room so it cannot leak into the next room previewed.
   */
  previewAnchor = $state<{ roomId: string; messageId: string } | null>(null);

  readonly #lobby: RoutingLobby;
  readonly #rooms: RoutingRooms;

  constructor(lobby: RoutingLobby, rooms: RoutingRooms) {
    this.#lobby = lobby;
    this.#rooms = rooms;
  }

  /** Follows the address the page was opened on, the back button and desktop links; returns the teardown. */
  start(): () => void {
    // On a fresh load/reload the URL is the only persisted state, so a /r/:id
    // route means the user wants to be back inside that room. Enter with
    // auto-join (like the "Войти" button) instead of only previewing — otherwise
    // temporary rooms (absent from "Мои комнаты") leave the user stranded on the
    // rooms home with the route still pointing at the room.
    const initialRoomId = extractRoomId(window.location.pathname);
    if (initialRoomId && shouldOfferOpenInApp(readOpenInAppSignals()) && !consumeInAppRoomNavigation()) {
      // The browser cannot tell whether the desktop app picked the link up, so
      // it waits for an explicit choice instead of joining voice twice.
      this.openInAppRoomId = initialRoomId;
      this.#lobby.mode = 'rooms';
      this.openRoomInApp();
    } else if (initialRoomId) {
      selectRoomForVoiceEntry(initialRoomId);
      this.#lobby.mode = 'rooms';
    }
    const initialParams = new SvelteURLSearchParams(window.location.search);
    const initialDmId = initialParams.get('dm');
    if (!initialRoomId && initialDmId) {
      replaceState(resolve('/'), {});
      void this.#lobby.openDm(initialDmId);
    }
    // A mention link — from the bell or from a push — lands here rather than on
    // /r/:roomId, so it previews the room and never joins voice.
    const linkedRoomId = initialParams.get('room');
    const linkedMessageId = initialParams.get('message');
    if (!initialRoomId && linkedRoomId && linkedMessageId) {
      replaceState(resolve('/'), {});
      this.openRoomMessage(linkedRoomId, linkedMessageId);
    }

    const teardownDesktopLinks = bindDesktopLinks(this.#openDesktopLink);
    window.addEventListener('popstate', this.#onPopState);
    return () => {
      teardownDesktopLinks();
      window.removeEventListener('popstate', this.#onPopState);
    };
  }

  // Every way into voice goes through here, so switching away from a live call
  // always gets the same question.
  requestEnterRoom = (roomId: string): void => {
    const needsConfirmation = shouldConfirmRoomSwitch({
      confirmEnabled: readRoomSwitchConfirmEnabled(),
      connectedRoomId: getActiveVoiceRoomId(),
      targetRoomId: roomId
    });
    if (needsConfirmation) {
      this.pendingRoomSwitchId = roomId;
      return;
    }
    this.#enterRoom(roomId);
  };

  resolveRoomSwitch = (proceed: boolean, dontAskAgain = false): void => {
    const roomId = this.pendingRoomSwitchId;
    this.pendingRoomSwitchId = '';
    if (roomId && applyRoomSwitchDecision({ dontAskAgain, proceed })) this.#enterRoom(roomId);
  };

  openRoomInApp = (): void => {
    const link = buildAppRoomLink(this.openInAppRoomId, window.location.hostname);
    if (!link) {
      this.continueRoomInBrowser();
      return;
    }
    launchAppLink(link);
  };

  continueRoomInBrowser = (): void => {
    const roomId = this.openInAppRoomId;
    this.openInAppRoomId = '';
    if (!roomId) return;
    selectRoomForVoiceEntry(roomId);
    this.#lobby.mode = 'rooms';
  };

  previewRoom = (roomId: string): void => {
    selectRoomPreview(roomId);
    this.#lobby.mode = 'rooms';
    this.#replaceUrlWithActiveVoiceRoom();
  };

  closeViewedRoom = (): void => {
    const transition = routeToHome();
    if (transition.closeEmbeddedRoom) this.#closeEmbeddedRoom({ replaceUrl: false });
    this.#replaceUrlWithActiveVoiceRoom();
  };

  goHome = (): void => {
    this.#lobby.showHome();
    if (roomNavigation.viewedRoomId) this.closeViewedRoom();
  };

  /** The room shown here was left from its own leave button. */
  closeLeftRoom = (closedRoomId: string): void => {
    const closedViewedRoom = Boolean(closedRoomId && roomNavigation.viewedRoomId === closedRoomId);
    this.#rooms.left(closedRoomId);
    this.#closeEmbeddedRoom({ closedRoomId });
    if (closedViewedRoom) clearViewedRoom();
  };

  openConnectedVoiceRoom = (): void => {
    const openedRoomId = openActiveVoiceRoom();
    if (!openedRoomId) return;
    this.#lobby.mode = 'rooms';
    pushState(resolve('/r/[roomId]', { roomId: encodeURIComponent(openedRoomId) }), {});
  };

  leaveConnectedVoiceRoom = async (): Promise<void> => {
    const leavingRoomId = getActiveVoiceRoomId();
    const transition = leaveViewedConnectedRoom(leavingRoomId);
    await leaveActiveVoiceRoomWithCue();
    this.#rooms.left(leavingRoomId);
    if (transition.closeEmbeddedRoom) {
      this.#closeEmbeddedRoom();
      clearViewedRoom();
    }
    this.#replaceUrlWithActiveVoiceRoom(null);
  };

  /**
   * Show a message in its room without joining voice. The old route went through
   * /r/:roomId, which on load means "put me back inside this room" and joined —
   * and it reloaded the page while still failing to open the chat.
   */
  openRoomMessage = (roomId: string, messageId: string): void => {
    this.#lobby.mode = 'rooms';
    if (getActiveVoiceRoomId() === roomId) {
      // Already in that room: its own chat is the one to show.
      openActiveVoiceRoom();
      openChat();
      return;
    }
    this.previewAnchor = { roomId, messageId };
    selectRoomPreview(roomId);
  };

  // Explicit voice enter/switch path. Browsing a room uses previewRoom(); this
  // path may remount the room client because the user chose to enter voice here.
  #enterRoom(roomId: string): void {
    selectRoomForVoiceEntry(roomId);
    this.#lobby.mode = 'rooms';
    pushState(resolve('/r/[roomId]', { roomId: encodeURIComponent(roomId) }), {});
  }

  #replaceUrlWithActiveVoiceRoom(roomId: string | null = getActiveVoiceRoomId()): void {
    const target = roomId ? resolve('/r/[roomId]', { roomId: encodeURIComponent(roomId) }) : resolve('/');
    if (`${window.location.pathname}${window.location.search}` === target) return;
    replaceState(target, {});
  }

  #closeEmbeddedRoom({
    replaceUrl = true,
    closedRoomId = mountedRoomId()
  }: { replaceUrl?: boolean; closedRoomId?: string | null } = {}): void {
    const shouldReplaceUrl = Boolean(
      replaceUrl && closedRoomId && extractRoomId(window.location.pathname) === closedRoomId
    );
    clearEmbeddedRoom();
    restoreLobbyDocumentState();
    if (shouldReplaceUrl) {
      const connectedRoomId = getActiveVoiceRoomId();
      this.#replaceUrlWithActiveVoiceRoom(connectedRoomId === closedRoomId ? null : connectedRoomId);
    }
  }

  #openDesktopLink = (link: DesktopLink): void => {
    if (link.kind === 'room') this.requestEnterRoom(link.roomId);
    else if (link.kind === 'mention') this.openRoomMessage(link.roomId, link.messageId);
    else if (link.kind === 'dm') void this.#lobby.openDm(link.dmId);
  };

  #onPopState = (): void => {
    const roomId = extractRoomId(window.location.pathname);
    if (roomId) {
      setViewedRoomFromRoute(roomId);
      this.#lobby.mode = 'rooms';
      this.#replaceUrlWithActiveVoiceRoom();
      return;
    }
    const transition = routeToHome();
    if (transition.closeEmbeddedRoom) this.#closeEmbeddedRoom({ replaceUrl: false });
    this.#replaceUrlWithActiveVoiceRoom();
  };
}
