// The call on a phone: what fills the screen (a grid, one person in focus, or
// two people face to face), which controls are showing, and where my own
// picture-in-picture sits. Desktop never reaches this state.

import { defineStore } from 'pinia';
import { onScopeDispose, ref } from 'vue';
import { state } from './client/core/room-runtime.store';
import type { Participant } from './client/core/types';
import { useParticipantsUiStore } from './participants-ui.store';
import { useRoomUiStore } from './room-ui.store';
import {
  focusSpotlight,
  gridPages,
  nextActiveSpeaker,
  type MobileCallView,
  type PipCorner
} from './mobile-call-layout';
import { usePageStore } from '@/stores/page.store';

/** Untouched for this long, the top bar and the dock get out of the picture. */
export const CHROME_HIDE_DELAY_MS = 5000;

/**
 * The layout is drawn for a phone held upright. A tablet or a phone on its side
 * keeps the room stage, where the chat panel also has its place beside the call.
 */
export const PORTRAIT_PHONE_QUERY = '(orientation: portrait) and (max-width: 600px)';

export type MobileCallScene =
  | { kind: 'duo'; big: Participant; pip: Participant; pipExpanded: boolean }
  | { kind: 'grid'; pages: Participant[][][]; voiceOnly: boolean }
  | { kind: 'focus'; big: Participant; self: Participant | null; strip: Participant[] };

export const useMobileCallUiStore = defineStore('mobile-call-ui', () => {
  /** This device is a phone; set once when the room page mounts. */
  const enabled = ref(false);
  const chromeVisible = ref(true);
  const view = ref<MobileCallView>('grid');
  /** Who is pinned in focus; it may be me. */
  const pinnedId = ref('');
  /** Two people: the other person I swapped places with, so I am full screen. */
  const duoSwappedWith = ref('');
  /** Two people: the other person while my picture-in-picture is doubled to turn the camera. */
  const pipExpandedWith = ref('');
  /** The corner the picture-in-picture was last dropped in. */
  const pipCorner = ref<PipCorner>('br');
  const outputOpen = ref(false);

  let activeSpeakerId = '';
  let chromeTimer = 0;
  // Whether the screen is a portrait phone; follows the media query once it has been asked.
  const portraitPhone = ref(true);
  let portraitPhoneQuery: MediaQueryList | null = null;
  let stopPortraitPhoneListener: (() => void) | null = null;
  onScopeDispose(() => stopPortraitPhoneListener?.());

  function isPortraitPhoneScreen(): boolean {
    if (typeof matchMedia !== 'function') return true;
    if (!portraitPhoneQuery) {
      const query = matchMedia(PORTRAIT_PHONE_QUERY);
      portraitPhoneQuery = query;
      portraitPhone.value = query.matches;
      const onChange = (event: MediaQueryListEvent): void => {
        portraitPhone.value = event.matches;
      };
      query.addEventListener('change', onChange);
      stopPortraitPhoneListener = () => query.removeEventListener('change', onChange);
    }
    return portraitPhone.value;
  }

  /** The mobile layout replaces the room stage while nobody's screen is open. */
  function isMobileCallActive(): boolean {
    return enabled.value && usePageStore().screen === 'room' && !state.viewedScreenPeerId && isPortraitPhoneScreen();
  }

  function getMobileCallScene(): MobileCallScene {
    const everyone = useParticipantsUiStore().getSortedParticipants();
    const self = everyone.find((participant) => participant.isLocal) ?? null;
    const others = everyone.filter((participant) => !participant.isLocal);
    activeSpeakerId = nextActiveSpeaker(activeSpeakerId, others);

    // Two people face to face once either camera is on; without one they sit in
    // the grid like on the room stage. A swap or a grown picture belongs to the
    // person it was made with; someone new in their place starts from the plain layout.
    const withCamera = (participant: Participant): boolean => participant.camera || Boolean(participant.cameraStream);
    const [other] = others;
    if (self && other && others.length === 1 && (withCamera(self) || withCamera(other))) {
      const swapped = duoSwappedWith.value === other.id;
      return swapped
        ? { kind: 'duo', big: self, pip: other, pipExpanded: false }
        : { kind: 'duo', big: other, pip: self, pipExpanded: pipExpandedWith.value === other.id };
    }

    const byId = (id: string) => everyone.find((participant) => participant.id === id);
    const otherIds = others.map((participant) => participant.id);
    if (view.value === 'focus' && everyone.length > 1) {
      const bigId = focusSpotlight({
        selfId: self?.id ?? '',
        otherIds,
        pinnedId: pinnedId.value,
        activeSpeakerId
      });
      const big = byId(bigId);
      if (big) {
        return {
          kind: 'focus',
          big,
          self: big.isLocal ? null : self,
          strip: others.filter((participant) => participant.id !== bigId)
        };
      }
    }

    return {
      kind: 'grid',
      pages: gridPages(self?.id ?? '', otherIds).map((rows) => rows.map((row) => row.flatMap((id) => byId(id) ?? []))),
      voiceOnly: !everyone.some(withCamera)
    };
  }

  /** Whom the phone shows big, so their camera is received at the top layer. */
  function getMobileSpotlightPeerId(): string {
    if (!isMobileCallActive()) return '';
    const scene = getMobileCallScene();
    return scene.kind === 'grid' ? '' : scene.big.id;
  }

  function showChrome(): void {
    chromeVisible.value = true;
  }

  function toggleChrome(): void {
    chromeVisible.value = !chromeVisible.value;
    if (!chromeVisible.value) outputOpen.value = false;
  }

  /**
   * Every touch restarts the countdown; the controls stay while a menu or the
   * chat is open over the call.
   */
  function restartChromeTimer(): void {
    window.clearTimeout(chromeTimer);
    chromeTimer = window.setTimeout(() => {
      if (outputOpen.value || useRoomUiStore().chatOpen) return;
      chromeVisible.value = false;
    }, CHROME_HIDE_DELAY_MS);
  }

  function stopChromeTimer(): void {
    window.clearTimeout(chromeTimer);
  }

  function toggleMobileCallView(): void {
    view.value = view.value === 'grid' ? 'focus' : 'grid';
    pinnedId.value = '';
  }

  function pinInFocus(peerId: string): void {
    view.value = 'focus';
    pinnedId.value = peerId;
  }

  function unpin(): void {
    pinnedId.value = '';
  }

  /**
   * Two people. My small picture grows on the first tap and shows the camera
   * switch; a tap on the grown one puts me full screen. The other person's small
   * picture swaps straight back.
   */
  function tapPip(scene: { big: Participant; pip: Participant; pipExpanded: boolean }): void {
    if (!scene.pip.isLocal) {
      duoSwappedWith.value = '';
      return;
    }
    if (!scene.pipExpanded) {
      pipExpandedWith.value = scene.big.id;
      return;
    }
    duoSwappedWith.value = scene.big.id;
    pipExpandedWith.value = '';
  }

  /** A tap on the full-screen picture: shrinks a grown picture-in-picture, else shows or hides the controls. */
  function tapStage(scene: { pipExpanded: boolean }): void {
    if (scene.pipExpanded) {
      pipExpandedWith.value = '';
      return;
    }
    toggleChrome();
  }

  function setPipCorner(corner: PipCorner): void {
    pipCorner.value = corner;
  }

  function setMobileCallEnabled(value: boolean): void {
    enabled.value = value;
  }

  /** Leaving the room page starts the next call from the defaults. */
  function resetMobileCall(): void {
    window.clearTimeout(chromeTimer);
    activeSpeakerId = '';
    chromeVisible.value = true;
    view.value = 'grid';
    pinnedId.value = '';
    duoSwappedWith.value = '';
    pipExpandedWith.value = '';
    pipCorner.value = 'br';
    outputOpen.value = false;
  }

  return {
    enabled,
    chromeVisible,
    view,
    pinnedId,
    duoSwappedWith,
    pipExpandedWith,
    pipCorner,
    outputOpen,
    isMobileCallActive,
    getMobileCallScene,
    getMobileSpotlightPeerId,
    showChrome,
    toggleChrome,
    restartChromeTimer,
    stopChromeTimer,
    toggleMobileCallView,
    pinInFocus,
    unpin,
    tapPip,
    tapStage,
    setPipCorner,
    setMobileCallEnabled,
    resetMobileCall
  };
});
