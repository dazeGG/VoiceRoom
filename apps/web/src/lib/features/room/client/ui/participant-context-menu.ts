import { session } from '$lib/features/auth/session.svelte';
import {
  acceptRequestByUserId,
  addFriendByUserId,
  getFriendRelationship,
  openDm,
  setMode
} from '$lib/features/home/model/friends.svelte';
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
const FOCUSABLE_SELECTOR = 'button:not(:disabled), input:not(:disabled), [tabindex]:not([tabindex="-1"])';

let menu: HTMLElement | null = null;
let openPeerId = '';
let restoreFocusTo: HTMLElement | null = null;

export function bindParticipantContextMenu(signal: AbortSignal): void {
  elements.participants.addEventListener('contextmenu', openParticipantContextMenuFromPointerEvent, { signal });
  elements.participants.addEventListener('keydown', openParticipantContextMenuFromKeyboardEvent, { signal });
  document.addEventListener('pointerdown', closeParticipantContextMenuOnOutside, { capture: true, signal });
  document.addEventListener('focusin', closeParticipantContextMenuOnFocusOutside, { signal });
  document.addEventListener('keydown', handleParticipantContextMenuKeydown, { signal });
  signal.addEventListener('abort', () => closeParticipantContextMenu('', false), { once: true });
}

export function syncParticipantContextMenuA11y(tile: HTMLElement, peer: Participant): void {
  if (peer.isLocal) {
    tile.removeAttribute('aria-haspopup');
    tile.removeAttribute('aria-label');
    tile.removeAttribute('tabindex');
    return;
  }

  tile.tabIndex = 0;
  tile.setAttribute('aria-haspopup', 'dialog');
  tile.setAttribute('aria-label', `${peer.name}. Откройте контекстное меню Shift+F10 или клавишей меню.`);
}

export function closeParticipantContextMenu(peerId = '', restoreFocus = true): void {
  if (peerId && peerId !== openPeerId) return;
  const focusTarget = restoreFocusTo;
  menu?.remove();
  menu = null;
  openPeerId = '';
  restoreFocusTo = null;
  if (restoreFocus && focusTarget?.isConnected) {
    queueMicrotask(() => focusTarget.focus());
  }
}

function getParticipantTile(target: EventTarget | null): HTMLElement | null {
  return target instanceof Element ? target.closest<HTMLElement>('.participant') : null;
}

function getRemoteParticipantFromTile(tile: HTMLElement | null): Participant | null {
  const peerId = tile?.dataset.peerId || '';
  if (!tile || !peerId) return null;
  const peer = state.peers.get(peerId);
  return peer && !peer.isLocal ? peer : null;
}

function openParticipantContextMenuFromPointerEvent(event: MouseEvent): void {
  const tile = getParticipantTile(event.target);
  const peer = getRemoteParticipantFromTile(tile);
  if (!peer || !tile) return;

  event.preventDefault();
  event.stopPropagation();
  openParticipantContextMenu(peer, event.clientX, event.clientY, tile);
}

function openParticipantContextMenuFromKeyboardEvent(event: KeyboardEvent): void {
  const isContextKey = event.key === 'ContextMenu' || (event.key === 'F10' && event.shiftKey);
  if (!isContextKey) return;

  const tile = getParticipantTile(event.target);
  const peer = getRemoteParticipantFromTile(tile);
  if (!peer || !tile) return;

  event.preventDefault();
  event.stopPropagation();
  const rect = tile.getBoundingClientRect();
  openParticipantContextMenu(peer, rect.left + rect.width / 2, rect.top + rect.height / 2, tile);
}

function openParticipantContextMenu(peer: Participant, clientX: number, clientY: number, opener: HTMLElement): void {
  closeParticipantContextMenu('', false);
  openPeerId = peer.id;
  restoreFocusTo = opener;

  const preferenceKey = getParticipantAudioPreferenceKey(peer.accountUserId, peer.id);
  const preference = getParticipantAudioPreference(preferenceKey);
  const canUseSocialActions = Boolean(session.user && peer.accountUserId && peer.accountUserId !== session.user.id);
  const relationship = canUseSocialActions ? getFriendRelationship(peer.accountUserId) : 'none';

  const panel = document.createElement('section');
  panel.className = 'participant-context-menu';
  panel.dataset.peerId = peer.id;
  panel.setAttribute('role', 'dialog');
  panel.setAttribute('aria-label', `Действия для ${peer.name}`);
  panel.tabIndex = -1;

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
  } else if (canUseSocialActions && relationship === 'incoming') {
    panel.append(createActionButton('Принять заявку', 'accept-request', peer));
  } else if (canUseSocialActions && relationship === 'outgoing') {
    panel.append(createPendingRequestNote());
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
  focusParticipantContextMenu(panel);
}

type ParticipantContextAction = 'message' | 'add-friend' | 'accept-request';

function createActionButton(label: string, action: ParticipantContextAction, peer: Participant): HTMLButtonElement {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'participant-context-menu-action';
  button.dataset.action = action;
  button.textContent = label;
  button.addEventListener('click', () => {
    closeParticipantContextMenu(peer.id);
    if (action === 'message') {
      void openParticipantDirectMessage(peer);
      return;
    }
    if (action === 'accept-request') {
      void acceptParticipantFriendRequest(peer);
      return;
    }
    void sendParticipantFriendRequest(peer);
  });
  return button;
}

function createPendingRequestNote(): HTMLElement {
  const note = document.createElement('p');
  note.className = 'participant-context-menu-note';
  note.textContent = 'Заявка в друзья уже отправлена.';
  return note;
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

async function acceptParticipantFriendRequest(peer: Participant): Promise<void> {
  if (!peer.accountUserId) return;
  try {
    await acceptRequestByUserId(peer.accountUserId);
    showToast('Заявка принята');
  } catch (error) {
    console.error(error);
    showToast('Не удалось принять заявку в друзья', { variant: 'error' });
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

  const render = (nextMuted: boolean) => {
    button.setAttribute('aria-pressed', String(nextMuted));
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

function focusParticipantContextMenu(panel: HTMLElement): void {
  const firstFocusable = panel.querySelector<HTMLElement>(FOCUSABLE_SELECTOR);
  queueMicrotask(() => (firstFocusable || panel).focus());
}

function getFocusableMenuItems(): HTMLElement[] {
  return menu ? [...menu.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)] : [];
}

function moveMenuFocus(delta: number): void {
  const items = getFocusableMenuItems();
  if (items.length === 0) return;
  const currentIndex = Math.max(0, items.indexOf(document.activeElement as HTMLElement));
  const nextIndex = (currentIndex + delta + items.length) % items.length;
  items[nextIndex]?.focus();
}

function closeParticipantContextMenuOnOutside(event: PointerEvent): void {
  if (!menu || menu.contains(event.target as Node | null)) return;
  closeParticipantContextMenu('', false);
}

function closeParticipantContextMenuOnFocusOutside(event: FocusEvent): void {
  if (!menu || menu.contains(event.target as Node | null)) return;
  if (restoreFocusTo?.contains(event.target as Node | null)) return;
  closeParticipantContextMenu('', false);
}

function handleParticipantContextMenuKeydown(event: KeyboardEvent): void {
  if (!menu) return;
  const activeElement = document.activeElement;
  const isRangeInput = activeElement instanceof HTMLInputElement && activeElement.type === 'range';
  if (event.key === 'Escape') {
    event.preventDefault();
    closeParticipantContextMenu();
    return;
  }
  if (event.key === 'ArrowDown' && !isRangeInput) {
    event.preventDefault();
    moveMenuFocus(1);
    return;
  }
  if (event.key === 'ArrowUp' && !isRangeInput) {
    event.preventDefault();
    moveMenuFocus(-1);
  }
}
