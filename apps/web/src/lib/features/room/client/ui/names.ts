import { elements } from './dom';
import { state } from '../core/state';
import { showToast } from './toast';
import { cleanDisplayName } from '../core/utils';

export function getDisplayName(): string {
  return state.savedName || 'Гость';
}

export function saveStartName(event: Event): void {
  event.preventDefault();
  saveNameFromInput(elements.startNameInput);
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
