import { guestNameUi } from '../../guest-name-ui.svelte';
import { getNameStatusView, startUi } from '../../start-ui.svelte';
import { state } from '../core/state.svelte';
import { showToast } from './toast';
import { cleanDisplayName } from '../core/utils';

let pendingGuestNamePromise: Promise<string> | null = null;
let resolvePendingGuestName: ((name: string) => void) | null = null;
let rejectPendingGuestName: (() => void) | null = null;

export function getDisplayName(): string {
  return state.savedName || 'Гость';
}

export function saveStartName(event: Event): void {
  event.preventDefault();
  saveNameFromValue(startUi.nameInput);
}

export function saveNameFromValue(rawValue: string): string {
  const name = cleanDisplayName(rawValue);
  if (!name) {
    showToast('Введите имя');
    return '';
  }

  persistName(name);
  updateNameStatuses(name);
  showToast('Имя сохранено');
  return name;
}

export function handleGuestNameSubmit(event: Event): void {
  event.preventDefault();

  const name = cleanDisplayName(guestNameUi.inputValue);
  if (!name) {
    guestNameUi.error = 'Введите имя, чтобы войти в комнату';
    showToast('Введите имя');
    return;
  }

  persistName(name);
  setGuestNameDialogOpen(false);
  const resolve = resolvePendingGuestName;
  clearPendingGuestNameRequest();
  resolve?.(name);
}

export function clearGuestNameError(): void {
  guestNameUi.error = '';
}

export function requestGuestNameForRoom(): Promise<string> {
  if (pendingGuestNamePromise) return pendingGuestNamePromise;

  guestNameUi.inputValue = '';
  guestNameUi.error = '';
  setGuestNameDialogOpen(true);

  pendingGuestNamePromise = new Promise((resolve, reject) => {
    resolvePendingGuestName = resolve;
    rejectPendingGuestName = () => reject(new Error('Guest name request cancelled'));
  });
  return pendingGuestNamePromise;
}

function clearPendingGuestNameRequest(): void {
  pendingGuestNamePromise = null;
  resolvePendingGuestName = null;
  rejectPendingGuestName = null;
}

export function resetGuestNameDialog(): void {
  if (!pendingGuestNamePromise) {
    setGuestNameDialogOpen(false);
    return;
  }

  const reject = rejectPendingGuestName;
  clearPendingGuestNameRequest();
  setGuestNameDialogOpen(false);
  reject?.();
}

export function setGuestNameDialogOpen(open: boolean): void {
  guestNameUi.open = open;
}

export function persistName(name: string): void {
  state.savedName = name;
  localStorage.setItem('voice-room:name', name);
  updateNameStatuses(name);
}

export function requireSavedName(currentName = state.savedName): boolean {
  const cleaned = cleanDisplayName(currentName);

  if (!state.savedName) {
    showToast('Сначала сохраните имя');
    return false;
  }

  if (cleaned && cleaned !== state.savedName) {
    showToast('Сохраните новое имя');
    return false;
  }

  updateNameStatuses(cleaned || state.savedName);
  return true;
}

export function updateNameStatuses(currentName = state.savedName): void {
  const cleaned = cleanDisplayName(currentName);
  const view = getNameStatusView(cleaned, state.savedName);
  startUi.savedNameStatus = view.text;
  startUi.savedNameState = view.state;
}