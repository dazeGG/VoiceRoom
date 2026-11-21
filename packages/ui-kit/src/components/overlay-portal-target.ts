/** Keep nested overlays inside the modal's focus and accessibility scope. */
export function overlayPortalTarget(anchor: unknown): HTMLElement | 'body' {
  return anchor instanceof HTMLElement ? (anchor.closest<HTMLElement>('[aria-modal="true"]') ?? 'body') : 'body';
}
