import { beforeAll } from 'vitest';

// jsdom has no dialog lifecycle APIs. This adapter only models visibility and
// initial focus; actual modal inertness/Tab/Escape behavior is browser-tested.
beforeAll(() => {
  HTMLDialogElement.prototype.showModal = function () {
    this.open = true;
    this.querySelector<HTMLElement>(
      'input:not(:disabled), textarea:not(:disabled), select:not(:disabled), button:not(:disabled)'
    )?.focus();
  };
  HTMLDialogElement.prototype.close = function () {
    if (!this.open) return;
    this.open = false;
    this.dispatchEvent(new Event('close'));
  };
});
