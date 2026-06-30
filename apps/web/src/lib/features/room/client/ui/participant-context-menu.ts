import { session } from '$lib/features/auth/session.svelte';
import { addFriendByUserId, getFriendRelationship, openDm, setMode } from '$lib/features/home/model/friends.svelte';
import { state } from '../core/state';
import {
  getParticipantAudioPreference,
  getParticipantAudioPreferenceKey,
  storeParticipantAudioPreference
} from '../core/settings';
import { applyRemoteParticipantAudioPreferences } from '../services/media-playback-service';
import { elements } from './dom';
import { showToast } from './toast';
import type { Participant } from '../core/types';

const MENU_WIDTH = 292;
const MENU_EDGE_GAP = 10;

let menu: HTMLElement | null = null;
let openPeerId = '';

export function bindParticipantContextMenu(signal: AbortSignal): void {
  elements.participants.addEventListener('contextmenu', openParticipantContextMenuFromEvent, { signal });
  document.addEventListener('pointerdown', closeParticipantContextMenuOnOutside, { capture: true, signal });
  document.addEventListener('keydown', closeParticipantContextMenuOnEscape, { signal });
  signal.addEventListener('abort', () => closeParticipantContextMenu(), { once: true });
}

export function closeParticipantContextMenu(peerId = ''): void {
  if (peerId && peerId !== openPeerId) return;
  menu?.remove();
  menu = null;
  openPeerId = '';
}

function openParticipantContextMenuFromEvent(event: MouseEvent): void {
  const tile = (event.target as Element | null)?.closest<HTMLElement>('.participant');
  const peerId = tile?.dataset.peerId || '';
  if (!tile || !peerId) return;

  const peer = state.peers.get(peerId);
  if (!peer || peer.isLocal) return;

  event.preventDefault();
  event.stopPropagation();
  openParticipantContextMenu(peer, event.clientX, event.clientY);
}

function openParticipantContextMenu(peer: Participant, clientX: number, clientY: number): void {
  closeParticipantContextMenu();
  openPeerId = peer.id;

  const preferenceKey = getParticipantAudioPreferenceKey(peer.accountUserId, peer.id);
  const preference = getParticipantAudioPreference(preferenceKey);
  const canUseSocialActions = Boolean(session.user && peer.accountUserId && peer.accountUserId !== session.user.id);
  const relationship = canUseSocialActions ? getFriendRelationship(peer.accountUserId) : 'none';

  const panel = document.createElement('section');
  panel.className = 'participant-context-menu';
  panel.dataset.peerId = peer.id;
  panel.setAttribute('role', 'menu');
  panel.setAttribute('aria-label', `Действия для ${peer.name}`);

  const header = document.createElement('div');
  header.className = 'participant-context-menu-head';
  const title = document.createElement('strong');
  title.textContent = peer.name;
  const subtitle = document.createElement('span');
  subtitle.textContent = peer.accountUserId ? 'Участник комнаты' : 'Гость комнаты';
  header.append(title, subtitle);
  panel.append(header);

  if (canUseSocialActions && relationship === 'friend') {
    panel.append(createActionButton('Написать сообщение', 'message', peer));
  } else if (canUseSocialActions) {
    panel.append(createActionButton('Добавить в друзья', 'add-friend', peer));
  } else if (!peer.accountUserId) {
    const note = document.createElement('p');
    note.className = 'participant-context-menu-note';
    note.textContent = 'Гость: доступны только локальные настройки звука.';
    panel.append(note);
  }

  if (panel.children.length > 1) {
    const divider = document.createElement('span');
    divider.className = 'participant-context-menu-divider';
    divider.setAttribute('aria-hidden', 'true');
    panel.append(divider);
  }

  const volumeBlock = createVolumeControl(peer, preferenceKey, preference.volume);
  const muteButton = createMuteButton(peer, preferenceKey, preference.muted);
  panel.append(volumeBlock, muteButton);

  document.body.append(panel);
  positionParticipantContextMenu(panel, clientX, clientY);
  menu = panel;
}

function createActionButton(label: string, action: 'message' | 'add-friend', peer: Participant): HTMLButtonElement {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'participant-context-menu-action';
  button.dataset.action = action;
  button.setAttribute('role', 'menuitem');
  button.textContent = label;
  button.addEventListener('click', () => {
    closeParticipantContextMenu(peer.id);
    if (action === 'message') {
      void openParticipantDirectMessage(peer);
      return;
    }
    void sendParticipantFriendRequest(peer);
  });
  return button;
}


async function openParticipantDirectMessage(peer: Participant): Promise<void> {
  if (!peer.accountUserId) return;
  try {
    setMode('friends');
    await openDm(peer.accountUserId);
  } catch (error) {
    console.error(error);
    showToast('Не удалось открыть личные сообщения', { variant: 'error' });
  }
}

async function sendParticipantFriendRequest(peer: Participant): Promise<void> {
  if (!peer.accountUserId) return;
  try {
    const result = await addFriendByUserId(peer.accountUserId);
    showToast(getFriendRequestToast(result.status));
  } catch (error) {
    console.error(error);
    showToast('Не удалось отправить заявку в друзья', { variant: 'error' });
  }
}

function getFriendRequestToast(status: 'sent' | 'accepted' | 'already_sent' | 'already_friends'): string {
  switch (status) {
    case 'accepted':
      return 'Теперь вы друзья';
    case 'already_friends':
      return 'Уже в друзьях';
    case 'already_sent':
      return 'Заявка уже отправлена';
    case 'sent':
    default:
      return 'Заявка в друзья отправлена';
  }
}

function createVolumeControl(peer: Participant, preferenceKey: string, volume: number): HTMLElement {
  const wrap = document.createElement('label');
  wrap.className = 'participant-context-menu-volume';

  const labelRow = document.createElement('span');
  labelRow.className = 'participant-context-menu-label-row';
  const label = document.createElement('span');
  label.textContent = 'Громкость';
  const value = document.createElement('output');
  value.value = String(Math.round(volume * 100));
  value.textContent = `${Math.round(volume * 100)}%`;
  labelRow.append(label, value);

  const control = document.createElement('span');
  control.className = 'gate-control participant-volume-control';
  const meterWrap = document.createElement('span');
  meterWrap.className = 'gate-meter-wrap';
  const track = document.createElement('span');
  track.className = 'mic-level-track participant-volume-track';
  const fill = document.createElement('span');
  fill.className = 'mic-level-fill participant-volume-fill';
  track.append(fill);

  const slider = document.createElement('input');
  slider.type = 'range';
  slider.min = '0';
  slider.max = '200';
  slider.step = '1';
  slider.value = String(Math.round(volume * 100));
  slider.setAttribute('aria-label', `Громкость ${peer.name}`);
  meterWrap.append(track, slider);
  control.append(meterWrap);

  const syncVolumeUi = (percent: number) => {
    value.value = String(percent);
    value.textContent = `${percent}%`;
    fill.style.width = `${Math.max(0, Math.min(100, percent / 2))}%`;
    track.dataset.boosted = String(percent > 100);
  };
  syncVolumeUi(Number(slider.value));

  slider.addEventListener('input', () => {
    const percent = Number.parseInt(slider.value, 10);
    const safePercent = Number.isFinite(percent) ? percent : 100;
    storeParticipantAudioPreference(preferenceKey, { volume: safePercent / 100 });
    syncVolumeUi(safePercent);
    applyRemoteParticipantAudioPreferences(peer);
  });

  wrap.append(labelRow, control);
  return wrap;
}

function createMuteButton(peer: Participant, preferenceKey: string, muted: boolean): HTMLButtonElement {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'participant-context-menu-action participant-context-menu-mute';
  button.dataset.action = 'local-mute';
  button.setAttribute('role', 'menuitemcheckbox');

  const render = (nextMuted: boolean) => {
    button.setAttribute('aria-checked', String(nextMuted));
    button.textContent = nextMuted ? 'Включить локально' : 'Заглушить локально';
  };
  render(muted);

  button.addEventListener('click', () => {
    const next = storeParticipantAudioPreference(preferenceKey, {
      muted: !getParticipantAudioPreference(preferenceKey).muted
    });
    render(next.muted);
    applyRemoteParticipantAudioPreferences(peer);
    closeParticipantContextMenu(peer.id);
  });

  return button;
}

function positionParticipantContextMenu(panel: HTMLElement, clientX: number, clientY: number): void {
  const viewportWidth = document.documentElement.clientWidth || window.innerWidth;
  const viewportHeight = document.documentElement.clientHeight || window.innerHeight;
  const rect = panel.getBoundingClientRect();
  const width = Math.max(rect.width || MENU_WIDTH, MENU_WIDTH);
  const height = rect.height || 260;
  const left = Math.min(Math.max(MENU_EDGE_GAP, clientX), Math.max(MENU_EDGE_GAP, viewportWidth - width - MENU_EDGE_GAP));
  const top = Math.min(Math.max(MENU_EDGE_GAP, clientY), Math.max(MENU_EDGE_GAP, viewportHeight - height - MENU_EDGE_GAP));
  panel.style.left = `${left}px`;
  panel.style.top = `${top}px`;
}

function closeParticipantContextMenuOnOutside(event: PointerEvent): void {
  if (!menu || menu.contains(event.target as Node | null)) return;
  closeParticipantContextMenu();
}

function closeParticipantContextMenuOnEscape(event: KeyboardEvent): void {
  if (event.key !== 'Escape') return;
  closeParticipantContextMenu();
}
