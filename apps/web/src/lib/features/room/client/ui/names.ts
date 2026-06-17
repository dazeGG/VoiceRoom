import { elements } from './dom';
import { state } from '../core/state';
import { showToast } from './toast';
import { cleanDisplayName } from '../core/utils';

let guestNameDialogBound = false;
let pendingGuestNamePromise: Promise<string> | null = null;
let resolvePendingGuestName: ((name: string) => void) | null = null;
let rejectPendingGuestName: (() => void) | null = null;

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
  elements.guestNameInput.addEventListener('input', clearGuestNameError);
}

export function unbindGuestNameDialog(): void {
  if (!guestNameDialogBound) return;
  guestNameDialogBound = false;

  elements.guestNameDialog.removeEventListener('click', handleGuestNameDialogClick);
  elements.guestNameDialog.removeEventListener('keydown', handleGuestNameDialogKeydown);
  elements.guestNameForm.removeEventListener('submit', handleGuestNameSubmit);
  elements.guestNameInput.removeEventListener('input', clearGuestNameError);
}

function clearGuestNameError(): void {
  elements.guestNameError.textContent = '';
}

export function requestGuestNameForRoom(): Promise<string> {
  if (pendingGuestNamePromise) return pendingGuestNamePromise;

  elements.guestNameInput.value = '';
  elements.guestNameError.textContent = '';
  setGuestNameDialogOpen(true);
  window.setTimeout(() => elements.guestNameInput.focus(), 0);

  pendingGuestNamePromise = new Promise((resolve, reject) => {
    resolvePendingGuestName = resolve;
    rejectPendingGuestName = () => reject(new Error('Guest name request cancelled'));
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
  setGuestNameDialogOpen(false);
  const resolve = resolvePendingGuestName;
  clearPendingGuestNameRequest();
  resolve?.(name);
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

function clearPendingGuestNameRequest(): void {
  resolvePendingGuestName = null;
  rejectPendingGuestName = null;
  pendingGuestNamePromise = null;
}

function setGuestNameDialogOpen(open: boolean): void {
  elements.guestNameDialog.hidden = !open;
  setGuestNameSiblingInert(open);
}

function setGuestNameSiblingInert(inert: boolean): void {
  const shell = elements.guestNameDialog.closest('.app-shell');
  if (!shell) return;

  for (const child of Array.from(shell.children)) {
    if (child.contains(elements.guestNameDialog)) continue;
    if (inert) {
      child.setAttribute('inert', '');
      continue;
    }
    child.removeAttribute('inert');
  }
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
