// The call on a phone: what fills the screen (a grid, one person in focus, or
// two people face to face), which controls are showing, and where my own
// picture-in-picture sits. Desktop never reaches this state.

import { MediaQuery } from 'svelte/reactivity';
import { state } from './client/core/state.svelte';
import type { Participant } from './client/core/types';
import { getSortedParticipants } from './participants-ui.svelte';
import { roomUi } from './room-ui.svelte';
import {
  focusSpotlight,
  gridPages,
  nextActiveSpeaker,
  type MobileCallView,
  type PipCorner
} from './mobile-call-layout';

/** Untouched for this long, the top bar and the dock get out of the picture. */
export const CHROME_HIDE_DELAY_MS = 5000;

/**
 * The layout is drawn for a phone held upright. A tablet or a phone on its side
 * keeps the room stage, where the chat panel also has its place beside the call.
 */
export const PORTRAIT_PHONE_QUERY = '(orientation: portrait) and (max-width: 600px)';

interface MobileCallUiState {
  /** This device is a phone; set once when the room page mounts. */
  enabled: boolean;
  chromeVisible: boolean;
  view: MobileCallView;
  /** Who is pinned in focus; it may be me. */
  pinnedId: string;
  /** Two people: the other person I swapped places with, so I am full screen. */
  duoSwappedWith: string;
  /** Two people: the other person while my picture-in-picture is doubled to turn the camera. */
  pipExpandedWith: string;
  /** The corner the picture-in-picture was last dropped in. */
  pipCorner: PipCorner;
  outputOpen: boolean;
}

export const mobileCallUi = $state<MobileCallUiState>({
  enabled: false,
  chromeVisible: true,
  view: 'grid',
  pinnedId: '',
  duoSwappedWith: '',
  pipExpandedWith: '',
  pipCorner: 'br',
  outputOpen: false
});

export type MobileCallScene =
  | { kind: 'duo'; big: Participant; pip: Participant; pipExpanded: boolean }
  | { kind: 'grid'; pages: Participant[][][]; voiceOnly: boolean }
  | { kind: 'focus'; big: Participant; self: Participant | null; strip: Participant[] };

let activeSpeakerId = '';
let chromeTimer = 0;
let portraitPhone: MediaQuery | null = null;

function isPortraitPhoneScreen(): boolean {
  if (typeof matchMedia !== 'function') return true;
  portraitPhone ??= new MediaQuery(PORTRAIT_PHONE_QUERY);
  return portraitPhone.current;
}

/** The mobile layout replaces the room stage while nobody's screen is open. */
export function isMobileCallActive(): boolean {
  return mobileCallUi.enabled && state.screen === 'room' && !state.viewedScreenPeerId && isPortraitPhoneScreen();
}

export function getMobileCallScene(): MobileCallScene {
  const everyone = getSortedParticipants();
  const self = everyone.find((participant) => participant.isLocal) ?? null;
  const others = everyone.filter((participant) => !participant.isLocal);
  activeSpeakerId = nextActiveSpeaker(activeSpeakerId, others);

  // Two people face to face once either camera is on; without one they sit in
  // the grid like on the room stage. A swap or a grown picture belongs to the
  // person it was made with; someone new in their place starts from the plain layout.
  const withCamera = (participant: Participant): boolean => participant.camera || Boolean(participant.cameraStream);
  if (self && others.length === 1 && (withCamera(self) || withCamera(others[0]))) {
    const [other] = others;
    const swapped = mobileCallUi.duoSwappedWith === other.id;
    return swapped
      ? { kind: 'duo', big: self, pip: other, pipExpanded: false }
      : { kind: 'duo', big: other, pip: self, pipExpanded: mobileCallUi.pipExpandedWith === other.id };
  }

  const byId = (id: string) => everyone.find((participant) => participant.id === id);
  const otherIds = others.map((participant) => participant.id);
  if (mobileCallUi.view === 'focus' && everyone.length > 1) {
    const bigId = focusSpotlight({
      selfId: self?.id ?? '',
      otherIds,
      pinnedId: mobileCallUi.pinnedId,
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
export function getMobileSpotlightPeerId(): string {
  if (!isMobileCallActive()) return '';
  const scene = getMobileCallScene();
  return scene.kind === 'grid' ? '' : scene.big.id;
}

export function showChrome(): void {
  mobileCallUi.chromeVisible = true;
}

export function toggleChrome(): void {
  mobileCallUi.chromeVisible = !mobileCallUi.chromeVisible;
  if (!mobileCallUi.chromeVisible) mobileCallUi.outputOpen = false;
}

/**
 * Every touch restarts the countdown; the controls stay while a menu or the
 * chat is open over the call.
 */
export function restartChromeTimer(): void {
  window.clearTimeout(chromeTimer);
  chromeTimer = window.setTimeout(() => {
    if (mobileCallUi.outputOpen || roomUi.chatOpen) return;
    mobileCallUi.chromeVisible = false;
  }, CHROME_HIDE_DELAY_MS);
}

export function stopChromeTimer(): void {
  window.clearTimeout(chromeTimer);
}

export function toggleMobileCallView(): void {
  mobileCallUi.view = mobileCallUi.view === 'grid' ? 'focus' : 'grid';
  mobileCallUi.pinnedId = '';
}

export function pinInFocus(peerId: string): void {
  mobileCallUi.view = 'focus';
  mobileCallUi.pinnedId = peerId;
}

export function unpin(): void {
  mobileCallUi.pinnedId = '';
}

/**
 * Two people. My small picture grows on the first tap and shows the camera
 * switch; a tap on the grown one puts me full screen. The other person's small
 * picture swaps straight back.
 */
export function tapPip(scene: { big: Participant; pip: Participant; pipExpanded: boolean }): void {
  if (!scene.pip.isLocal) {
    mobileCallUi.duoSwappedWith = '';
    return;
  }
  if (!scene.pipExpanded) {
    mobileCallUi.pipExpandedWith = scene.big.id;
    return;
  }
  mobileCallUi.duoSwappedWith = scene.big.id;
  mobileCallUi.pipExpandedWith = '';
}

/** A tap on the full-screen picture: shrinks a grown picture-in-picture, else shows or hides the controls. */
export function tapStage(scene: { pipExpanded: boolean }): void {
  if (scene.pipExpanded) {
    mobileCallUi.pipExpandedWith = '';
    return;
  }
  toggleChrome();
}

export function setPipCorner(corner: PipCorner): void {
  mobileCallUi.pipCorner = corner;
}

export function setMobileCallEnabled(enabled: boolean): void {
  mobileCallUi.enabled = enabled;
}

/** Leaving the room page starts the next call from the defaults. */
export function resetMobileCall(): void {
  window.clearTimeout(chromeTimer);
  activeSpeakerId = '';
  Object.assign(mobileCallUi, {
    chromeVisible: true,
    view: 'grid',
    pinnedId: '',
    duoSwappedWith: '',
    pipExpandedWith: '',
    pipCorner: 'br',
    outputOpen: false
  });
}
