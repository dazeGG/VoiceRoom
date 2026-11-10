// The 404 page's room field: a code or a pasted room link opens the room
// itself. Without this script the form opens the app, which asks for the code.

import { extractRoomId, roomHref } from '@voice-room/shared/app-home';

const form = document.querySelector<HTMLFormElement>('form[data-join-room]');
const input = form?.querySelector<HTMLInputElement>('input');

if (form && input) {
  input.addEventListener('input', () => input.setCustomValidity(''));
  form.addEventListener('submit', (event) => {
    if (!input.value.trim()) return;
    event.preventDefault();
    const roomId = extractRoomId(input.value, window.location.origin);
    if (roomId) {
      window.location.assign(roomHref(roomId));
      return;
    }
    input.setCustomValidity('Не похоже на код или ссылку комнаты');
    input.reportValidity();
  });
}
