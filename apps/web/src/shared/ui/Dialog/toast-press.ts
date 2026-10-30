// Reka reports a press anywhere outside the card as an outside press that closes
// the dialog. A toast raised from inside a dialog is outside the card, so a press
// on it must not count.
export function isToastPress(event: Event): boolean {
  if (!('detail' in event)) return false;
  const detail: unknown = event.detail;
  if (typeof detail !== 'object' || detail === null || !('originalEvent' in detail)) return false;
  const original = detail.originalEvent;
  const target = original instanceof Event ? original.target : null;
  return target instanceof Element && target.closest('.ui-toaststack') !== null;
}
