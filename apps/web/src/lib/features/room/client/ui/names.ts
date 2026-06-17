import { elements } from './dom';
import { state } from '../core/state';
import { showToast } from './toast';
import { cleanDisplayName } from '../core/utils';

let guestNameDialogBound = false;
let pendingGuestNamePromise: Promise<string> | null = null;
let resolvePendingGuestName: ((name: string) => void) | null = null;

export function getDisplayName(): string {
  return state.savedName || 'Гость';
}

export function saveStartName(event: Event): void {
  event.preventDefault();
  saveNameFromInput(elements.startNameInput);
}

export function bindGuestNameDialog(): void {
  if (guestNameDialogBound) return;
  guestNameDialogBound = true;

  elements.guestNameDialog.addEventListener('click', handleGuestNameDialogClick);
  elements.guestNameDialog.addEventListener('keydown', handleGuestNameDialogKeydown);
  elements.guestNameForm.addEventListener('submit', handleGuestNameSubmit);
  elements.guestNameInput.addEventListener('input', () => {
    elements.guestNameError.textContent = '';
  });
}

export function requestGuestNameForRoom(): Promise<string> {
  if (pendingGuestNamePromise) return pendingGuestNamePromise;

  elements.guestNameInput.value = '';
  elements.guestNameError.textContent = '';
  elements.guestNameDialog.hidden = false;
  window.setTimeout(() => elements.guestNameInput.focus(), 0);

  pendingGuestNamePromise = new Promise((resolve) => {
    resolvePendingGuestName = resolve;
  });
  return pendingGuestNamePromise;
}

function handleGuestNameSubmit(event: Event): void {
  event.preventDefault();

  const name = cleanDisplayName(elements.guestNameInput.value);
  if (!name) {
    elements.guestNameError.textContent = 'Введите имя, чтобы войти в комнату';
    showToast('Введите имя');
    elements.guestNameInput.focus();
    return;
  }

  persistName(name);
  elements.guestNameDialog.hidden = true;
  const resolve = resolvePendingGuestName;
  resolvePendingGuestName = null;
  pendingGuestNamePromise = null;
  resolve?.(name);
}

function handleGuestNameDialogClick(event: MouseEvent): void {
  if (event.target === elements.guestNameDialog) {
    elements.guestNameInput.focus();
  }
}

function handleGuestNameDialogKeydown(event: KeyboardEvent): void {
  if (event.key === 'Escape') {
    event.preventDefault();
    elements.guestNameInput.focus();
    return;
  }

  if (event.key !== 'Tab') return;

  const focusableElements = Array.from(
    elements.guestNameDialog.querySelectorAll<HTMLElement>('input, button')
  ).filter((element) => !element.hasAttribute('disabled'));
  const first = focusableElements[0];
  const last = focusableElements.at(-1);
  if (!first || !last) return;

  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    last.focus();
    return;
  }

  if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first.focus();
  }
}

function saveNameFromInput(input: HTMLInputElement): string {
  const name = cleanDisplayName(input.value);
  if (!name) {
    showToast('Введите имя');
    input.focus();
    return '';
  }

  state.savedName = name;
  persistName(name);
  elements.startNameInput.value = name;
  updateNameStatuses();
  showToast('Имя сохранено');
  return name;
}

export function persistName(name: string): void {
  state.savedName = name;
  localStorage.setItem('voice-room:name', name);
  elements.startNameInput.value = name;
}

export function requireSavedName(input: HTMLInputElement): boolean {
  const currentName = cleanDisplayName(input.value);

  if (!state.savedName) {
    showToast('Сначала сохраните имя');
    input.focus();
    return false;
  }

  if (currentName && currentName !== state.savedName) {
    showToast('Сохраните новое имя');
    input.focus();
    return false;
  }

  if (!currentName) input.value = state.savedName;
  updateNameStatuses();
  return true;
}

export function updateNameStatuses(): void {
  renderNameStatus(elements.startNameInput, elements.startNameStatus);
}

function renderNameStatus(input: HTMLInputElement, status: HTMLElement): void {
  const currentName = cleanDisplayName(input.value);

  if (state.savedName && currentName === state.savedName) {
    status.textContent = `Сохранено: ${state.savedName}`;
    status.dataset.state = 'saved';
    return;
  }

  if (state.savedName && currentName && currentName !== state.savedName) {
    status.textContent = 'Новое имя еще не сохранено';
    status.dataset.state = 'dirty';
    return;
  }

  status.textContent = 'Имя не сохранено';
  status.dataset.state = 'empty';
}
