import { getAvatarColor } from '$lib/visual/tokens';
import { SCREEN_FPS_OPTIONS, SCREEN_QUALITY_OPTIONS } from './client/core/config';
import { state } from './client/core/state.svelte';
import { getInitials } from './client/core/utils';
import { getScreenProfile, parseScreenProfileId } from './client/media/profiles';
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
  streamTilesVisible: false,
  streamTilesCount: 0,
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
  viewers: Participant[];
  viewersRest: number;
}

export function getScreenMetaView(): ScreenMetaView | null {
  void screenUi.revision;
  const participant = getActiveScreenPeer();
  if (!participant || !screenUi.showMeta) return null;

  const profile = getScreenProfile(participant.isLocal ? state.localScreenProfileId : participant.screenProfileId);
  const { qualityId, fpsId } = parseScreenProfileId(profile.id);
  const qualityLabel = SCREEN_QUALITY_OPTIONS[qualityId]?.label || '';
  const fpsLabel = SCREEN_FPS_OPTIONS[fpsId]?.label || '';
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
    showSepViewers: Boolean((qualityLabel || fpsLabel) && viewers.length >= 0),
    viewers: viewers.slice(0, 3),
    viewersRest: Math.max(0, viewers.length - 3)
  };
}

function getScreenViewers(ownerPeerId: string): Participant[] {
  return getAllParticipants().filter((participant) => participant.viewedScreenPeerId === ownerPeerId);
}

export function getViewerAvatarStyle(viewer: Participant): {
  background: string;
  foreground: string;
  shadow: string;
  label: string;
} {
  const color = getAvatarColor(viewer.avatarColorKey);
  return {
    background: color.background,
    foreground: color.foreground,
    shadow: color.shadow,
    label: viewer.isLocal ? 'вы' : viewer.name
  };
}

export function getViewerInitials(viewer: Participant): string {
  return getInitials(viewer.name);
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