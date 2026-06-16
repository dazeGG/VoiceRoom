import { renderIcon } from './icons';
import { SCREEN_FPS_OPTIONS, SCREEN_QUALITY_OPTIONS } from '../core/config';
import { state } from '../core/state';
import { getScreenProfile, parseScreenProfileId } from '../media/profiles';
import { playMediaElement } from '../services/media-playback-service';
import type { Participant } from '../core/types';

export interface StreamTileOptions {
  hasPreview: boolean;
  isCollapsed: boolean;
  isSubscribed: boolean;
  onEnter: (peerId: string) => void;
  participant: Participant;
  stream: MediaStream | null;
}

export function createStreamTile({
  hasPreview,
  isCollapsed,
  isSubscribed,
  onEnter,
  participant,
  stream
}: StreamTileOptions): HTMLElement {
  const isIdle = !hasPreview;

  const tile = document.createElement(isCollapsed ? 'div' : 'button');
  tile.className = 'stream-tile';
  if (tile instanceof HTMLButtonElement) {
    tile.type = 'button';
  } else {
    tile.setAttribute('role', 'group');
  }
  tile.dataset.preview = String(hasPreview);
  tile.dataset.collapsed = String(isCollapsed);
  tile.dataset.idle = String(isIdle);
  tile.dataset.local = String(participant.isLocal);
  const isActive = hasPreview || isSubscribed;
  if (tile instanceof HTMLButtonElement) {
    tile.setAttribute('aria-pressed', String(isActive));
    tile.setAttribute(
      'aria-label',
      hasPreview
        ? `Развернуть стрим ${participant.name}`
        : isSubscribed
          ? `Подключение к стриму ${participant.name}`
          : `Смотреть стрим ${participant.name}`
    );
  }

  const preview = document.createElement('span');
  preview.className = 'stream-tile-preview';
  if (hasPreview && stream) {
    mountStreamTileVideo(preview, stream);
    preview.append(createStreamTileProfileMeta(participant));
  } else {
    preview.append(createStreamTileIcon());
  }

  tile.append(preview);

  if (isCollapsed) {
    tile.append(
      createCollapsedExpandButton(participant, isActive, onEnter),
      createStreamTileTitle(participant)
    );
  } else if (isIdle) {
    tile.append(createIdleStreamTileTitle(participant), createIdleTileActions(isSubscribed));
  }

  if (tile instanceof HTMLButtonElement) {
    tile.addEventListener('click', () => onEnter(participant.id));
  }
  return tile;
}

function createStreamTileProfileMeta(participant: Participant): HTMLElement {
  const profile = getScreenProfile(participant.isLocal ? state.localScreenProfileId : participant.screenProfileId);
  const { qualityId, fpsId } = parseScreenProfileId(profile.id);
  const qualityLabel = SCREEN_QUALITY_OPTIONS[qualityId]?.label || '';
  const fpsLabel = SCREEN_FPS_OPTIONS[fpsId]?.label || '';
  const meta = document.createElement('span');
  meta.className = 'stream-tile-profile-meta';
  meta.textContent = [qualityLabel, fpsLabel].filter(Boolean).join(' · ');
  meta.hidden = !meta.textContent;
  return meta;
}

function createCollapsedExpandButton(
  participant: Participant,
  isActive: boolean,
  onEnter: (peerId: string) => void
): HTMLButtonElement {
  const expandButton = document.createElement('button');
  expandButton.type = 'button';
  expandButton.className = 'stream-tile-expand';
  expandButton.setAttribute('aria-pressed', String(isActive));
  expandButton.setAttribute(
    'aria-label',
    `Развернуть стрим ${participant.isLocal ? 'ваш' : participant.name}`
  );
  expandButton.addEventListener('click', () => onEnter(participant.id));
  return expandButton;
}

function createStreamTileTitle(participant: Participant): HTMLElement {
  const copy = document.createElement('span');
  copy.className = 'stream-tile-copy';
  const title = document.createElement('strong');
  title.textContent = participant.isLocal ? 'Ваш стрим' : participant.name;
  copy.append(title);
  return copy;
}

function createIdleStreamTileTitle(participant: Participant): HTMLElement {
  const copy = document.createElement('span');
  copy.className = 'stream-tile-copy stream-tile-copy-idle';
  const title = document.createElement('strong');
  title.textContent = participant.isLocal ? 'Ваш стрим' : participant.name;
  copy.append(title);
  return copy;
}

function createIdleTileActions(isSubscribed: boolean): HTMLElement {
  const actions = document.createElement('span');
  actions.className = 'stream-tile-actions';
  const primaryAction = document.createElement('span');
  primaryAction.className = 'stream-tile-action stream-tile-action-primary';
  primaryAction.textContent = isSubscribed ? 'Подключение' : 'Смотреть стрим';
  actions.append(primaryAction);
  return actions;
}

function mountStreamTileVideo(preview: HTMLElement, stream: MediaStream): void {
  const video = document.createElement('video');
  video.className = 'stream-tile-video';
  video.autoplay = true;
  video.muted = true;
  video.playsInline = true;
  video.srcObject = stream;
  preview.append(video);
  playMediaElement(video);
}

function createStreamTileIcon(): HTMLElement {
  const icon = document.createElement('span');
  icon.className = 'stream-tile-icon';
  icon.setAttribute('aria-hidden', 'true');
  icon.innerHTML = renderIcon('monitor');
  return icon;
}
