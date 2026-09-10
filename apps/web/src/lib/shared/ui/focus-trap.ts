type FocusTrapOptions = {
  enabled?: boolean;
  initialFocus?: string;
  restoreFocus?: boolean;
};

const FOCUSABLE_SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])'
].join(',');

function isHTMLElement(value: Element | null): value is HTMLElement {
  return value instanceof HTMLElement;
}

function getFocusableElements(root: HTMLElement): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter((element) => {
    if (element.hasAttribute('disabled')) return false;
    if (element.getAttribute('aria-hidden') === 'true') return false;
    return element.tabIndex >= 0;
  });
}

function focusInitialElement(root: HTMLElement, selector?: string): void {
  const explicitTarget = selector ? root.querySelector(selector) : null;
  const target = isHTMLElement(explicitTarget) ? explicitTarget : getFocusableElements(root)[0] ?? root;
  target.focus({ preventScroll: true });
}

export function dialogFocusTrap(root: HTMLElement, options: FocusTrapOptions = {}) {
  let currentOptions: Required<FocusTrapOptions> = {
    enabled: options.enabled ?? true,
    initialFocus: options.initialFocus ?? '[data-dialog-initial-focus]',
    restoreFocus: options.restoreFocus ?? true
  };
  let opener: HTMLElement | null = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  let active = false;
  let hasActivated = false;

  function activate(): void {
    if (active || !currentOptions.enabled) return;
    active = true;
    if (hasActivated) return;
    hasActivated = true;
    queueMicrotask(() => {
      if (!currentOptions.enabled || !root.isConnected) return;
      focusInitialElement(root, currentOptions.initialFocus);
    });
  }

  function suspend(): void {
    if (!active) return;
    active = false;
  }

  function restoreOpener(): void {
    if (!currentOptions.restoreFocus) return;
    queueMicrotask(() => {
      if (opener?.isConnected) opener.focus({ preventScroll: true });
    });
  }

  function onKeydown(event: KeyboardEvent): void {
    if (!currentOptions.enabled || event.key !== 'Tab') return;
    const focusable = getFocusableElements(root);
    if (focusable.length === 0) {
      event.preventDefault();
      root.focus({ preventScroll: true });
      return;
    }

    const first = focusable[0];
    const last = focusable.at(-1) ?? first;
    const activeElement = document.activeElement;
    if (!(activeElement instanceof Node) || !root.contains(activeElement)) {
      event.preventDefault();
      (event.shiftKey ? last : first).focus({ preventScroll: true });
    } else if (event.shiftKey && activeElement === first) {
      event.preventDefault();
      last.focus({ preventScroll: true });
    } else if (!event.shiftKey && activeElement === last) {
      event.preventDefault();
      first.focus({ preventScroll: true });
    }
  }

  root.addEventListener('keydown', onKeydown);
  activate();

  return {
    update(nextOptions: FocusTrapOptions = {}) {
      const wasEnabled = currentOptions.enabled;
      currentOptions = {
        enabled: nextOptions.enabled ?? true,
        initialFocus: nextOptions.initialFocus ?? '[data-dialog-initial-focus]',
        restoreFocus: nextOptions.restoreFocus ?? true
      };
      if (!wasEnabled && currentOptions.enabled) activate();
      if (wasEnabled && !currentOptions.enabled) suspend();
    },
    destroy() {
      root.removeEventListener('keydown', onKeydown);
      suspend();
      restoreOpener();
    }
  };
}
