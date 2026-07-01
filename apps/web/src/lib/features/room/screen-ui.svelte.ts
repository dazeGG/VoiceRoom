import { state } from './client/core/state.svelte';
import { getAvatarPresentation } from './client/ui/avatar-presentation';
import type { AvatarStackItem } from '$lib/shared/ui';
import { getScreenProfileLabels } from './client/media/profiles';
import { getAllParticipants, getParticipantById } from './client/room/participants';
import type { Participant } from './client/core/types';

export const screenUi = $state({
  revision: 0,
  stageVisible: false,
  hasStream: false,
  showControls: false,
  showPlaceholder: true,
  showMeta: false,
  uiActive: false,
  activeStream: null as MediaStream | null,
  hideLeaveButton: false,
  showScreenExit: false
});

let screenVideoEl: HTMLVideoElement | null = null;
let screenStageEl: HTMLElement | null = null;
let streamVolumeSliderEl: HTMLInputElement | null = null;

export function registerScreenVideo(element: HTMLVideoElement | null): void {
  screenVideoEl = element;
}

export function registerScreenStage(element: HTMLElement | null): void {
  screenStageEl = element;
}

export function registerStreamVolumeSlider(element: HTMLInputElement | null): void {
  streamVolumeSliderEl = element;
}

export function getScreenVideo(): HTMLVideoElement | null {
  return screenVideoEl;
}

export function getScreenStage(): HTMLElement | null {
  return screenStageEl;
}

export function getStreamVolumeSlider(): HTMLInputElement | null {
  return streamVolumeSliderEl;
}

export function bumpScreenUiRevision(): void {
  screenUi.revision += 1;
}

export function getActiveScreenPeer(): Participant | null {
  return getParticipantById(state.viewedScreenPeerId);
}

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

export function getScreenMetaView(): ScreenMetaView | null {
  void screenUi.revision;
  const participant = getActiveScreenPeer();
  if (!participant || !screenUi.showMeta) return null;

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

function getScreenViewers(ownerPeerId: string): Participant[] {
  return getAllParticipants().filter((participant) => participant.viewedScreenPeerId === ownerPeerId);
}

export function getViewerAvatarItem(viewer: Participant): AvatarStackItem {
  const avatar = getAvatarPresentation(viewer);
  return {
    background: avatar.background,
    foreground: avatar.foreground,
    id: viewer.id,
    initials: avatar.initials,
    label: avatar.label,
    shadow: avatar.shadow
  };
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

export function getStreamVolumeView(): StreamVolumeView {
  void screenUi.revision;
  void state.screenMuted;
  void state.screenVolume;
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

export function getFullscreenView(): FullscreenView {
  void screenUi.revision;
  void state.screenFullscreen;
  const fullscreen = state.screenFullscreen;
  return {
    fullscreen,
    ariaLabel: fullscreen ? 'Выйти из полноэкранного режима' : 'Открыть стрим на весь экран'
  };
}