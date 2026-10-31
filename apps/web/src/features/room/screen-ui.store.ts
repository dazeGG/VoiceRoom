import { defineStore } from 'pinia';
import { computed, ref, shallowRef } from 'vue';
import { state } from './client/core/room-runtime.store';
import { getAvatarPresentation } from '@/shared/ui/avatar-presentation';
import type { AvatarStackItem } from '@/shared/ui/AvatarStack/types';
import { getScreenProfileLabels } from './client/media/profiles';
import { getAllParticipants, getParticipantById } from './client/room/participants';
import type { Participant } from './client/core/types';

export interface ScreenMetaView {
  title: string;
  qualityLabel: string;
  fpsLabel: string;
  showQuality: boolean;
  showFps: boolean;
  showSepProfile: boolean;
  showSepFps: boolean;
  showViewers: boolean;
  showSepViewers: boolean;
  viewerAvatars: AvatarStackItem[];
}

export interface StreamVolumeView {
  hidden: boolean;
  maxPercent: number;
  valuePercent: number;
  muted: boolean;
  ariaLabel: string;
}

export interface FullscreenView {
  fullscreen: boolean;
  ariaLabel: string;
}

function getScreenViewers(ownerPeerId: string): Participant[] {
  return getAllParticipants().filter((participant) => participant.viewedScreenPeerId === ownerPeerId);
}

function getViewerAvatarItem(viewer: Participant): AvatarStackItem {
  const avatar = getAvatarPresentation(viewer);
  return {
    background: avatar.background,
    foreground: avatar.foreground,
    id: viewer.id,
    initials: avatar.initials,
    label: avatar.label,
    shadow: avatar.shadow,
    src: avatar.src
  };
}

export const useScreenUiStore = defineStore('screen-ui', () => {
  // Screen streams change in place (tracks come and go on the same MediaStream),
  // which Vue cannot see; the screen view bumps this after such a change.
  const revision = ref(0);
  const stageVisible = ref(false);
  // A MediaStream is not made reactive (rule 4), so it is held in a shallowRef.
  const activeStream = shallowRef<MediaStream | null>(null);
  const showControls = computed(() => Boolean(activeStream.value));
  const showPlaceholder = computed(() => !activeStream.value);
  const showMeta = ref(false);
  const uiActive = ref(false);
  const hideLeaveButton = ref(false);
  const showScreenExit = ref(false);

  let screenVideoEl: HTMLVideoElement | null = null;
  let screenStageEl: HTMLElement | null = null;
  let streamVolumeSliderEl: HTMLInputElement | null = null;

  function registerScreenVideo(element: HTMLVideoElement | null): void {
    screenVideoEl = element;
  }

  function registerScreenStage(element: HTMLElement | null): void {
    screenStageEl = element;
  }

  function registerStreamVolumeSlider(element: HTMLInputElement | null): void {
    streamVolumeSliderEl = element;
  }

  function getScreenVideo(): HTMLVideoElement | null {
    return screenVideoEl;
  }

  function getScreenStage(): HTMLElement | null {
    return screenStageEl;
  }

  function getStreamVolumeSlider(): HTMLInputElement | null {
    return streamVolumeSliderEl;
  }

  // Reading it makes the caller depend on the revision.
  function trackRevision(): number {
    return revision.value;
  }

  function bumpScreenUiRevision(): void {
    revision.value += 1;
  }

  function getActiveScreenPeer(): Participant | null {
    return getParticipantById(state.viewedScreenPeerId);
  }

  function getScreenMetaView(): ScreenMetaView | null {
    trackRevision();
    const participant = getActiveScreenPeer();
    if (!participant || !showMeta.value) return null;

    const profileId = participant.isLocal ? state.localScreenProfileId : participant.screenProfileId;
    const { qualityLabel, fpsLabel } = getScreenProfileLabels(profileId);
    const viewers = getScreenViewers(participant.id);

    return {
      title: participant.isLocal ? 'Ваш стрим' : `Стрим ${participant.name}`,
      qualityLabel,
      fpsLabel,
      showQuality: Boolean(qualityLabel),
      showFps: Boolean(fpsLabel),
      showSepProfile: Boolean(qualityLabel),
      showSepFps: Boolean(qualityLabel && fpsLabel),
      showViewers: true,
      showSepViewers: Boolean(qualityLabel || fpsLabel),
      viewerAvatars: viewers.map(getViewerAvatarItem)
    };
  }

  function getStreamVolumeView(): StreamVolumeView {
    trackRevision();
    const peer = getActiveScreenPeer();
    const hideVolume = Boolean(peer?.isLocal);
    const muted = state.screenMuted || state.screenVolume <= 0;
    const valuePercent = Math.round(state.screenVolume * 100);
    return {
      hidden: hideVolume,
      maxPercent: 200,
      valuePercent,
      muted,
      ariaLabel: muted ? 'Включить звук стрима' : 'Выключить звук стрима'
    };
  }

  function getFullscreenView(): FullscreenView {
    trackRevision();
    const fullscreen = state.screenFullscreen;
    return {
      fullscreen,
      ariaLabel: fullscreen ? 'Выйти из полноэкранного режима' : 'Открыть стрим на весь экран'
    };
  }

  return {
    revision,
    stageVisible,
    showControls,
    showPlaceholder,
    showMeta,
    uiActive,
    activeStream,
    hideLeaveButton,
    showScreenExit,
    registerScreenVideo,
    registerScreenStage,
    registerStreamVolumeSlider,
    getScreenVideo,
    getScreenStage,
    getStreamVolumeSlider,
    bumpScreenUiRevision,
    getActiveScreenPeer,
    getScreenMetaView,
    getStreamVolumeView,
    getFullscreenView
  };
});
