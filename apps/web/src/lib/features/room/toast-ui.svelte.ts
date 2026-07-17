export const toastUi = $state({
  action: null as null | (() => void | Promise<void>),
  actionLabel: '',
  message: '',
  variant: 'info' as 'info' | 'error',
  visible: false
});

let toastTimer = 0;

export function showToastUi(message: string, options: { action?: () => void | Promise<void>; actionLabel?: string; duration?: number; variant?: 'info' | 'error' } = {}): void {
  const { action = null, actionLabel = '', duration = 2400, variant = 'info' } = options;
  toastUi.action = action;
  toastUi.actionLabel = actionLabel;
  toastUi.message = message;
  toastUi.variant = variant;
  toastUi.visible = true;
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => {
    toastUi.visible = false;
  }, duration);
}

export function dismissToastUi(): void {
  window.clearTimeout(toastTimer);
  toastUi.visible = false;
  toastUi.action = null;
  toastUi.actionLabel = '';
}

export async function invokeToastAction(): Promise<void> {
  const action = toastUi.action;
  dismissToastUi();
  await action?.();
}
