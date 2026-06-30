export const toastUi = $state({
  message: '',
  variant: 'info' as 'info' | 'error',
  visible: false
});

let toastTimer = 0;

export function showToastUi(message: string, options: { duration?: number; variant?: 'info' | 'error' } = {}): void {
  const { duration = 2400, variant = 'info' } = options;
  toastUi.message = message;
  toastUi.variant = variant;
  toastUi.visible = true;
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => {
    toastUi.visible = false;
  }, duration);
}