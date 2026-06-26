export type PopoverPlacement = 'bottom-end' | 'bottom-start' | 'top-end' | 'top-start';

export const POPOVER_PANEL_GAP_PX = 10;
export const POPOVER_VIEWPORT_MARGIN_PX = 8;

type PlacementAxis = {
  vertical: 'top' | 'bottom';
  horizontal: 'start' | 'end';
};

export function parsePlacement(placement: PopoverPlacement): PlacementAxis {
  const [vertical, horizontal] = placement.split('-') as ['top' | 'bottom', 'start' | 'end'];
  return { vertical, horizontal };
}

export function flipPlacementVertical(
  placement: PopoverPlacement,
  vertical: 'top' | 'bottom'
): PopoverPlacement {
  const { horizontal } = parsePlacement(placement);
  return `${vertical}-${horizontal}`;
}

export function effectivePanelHeight(panel: HTMLElement): number {
  const maxHeight = Number.parseFloat(getComputedStyle(panel).maxHeight);
  if (!Number.isFinite(maxHeight)) return panel.scrollHeight;
  return Math.min(panel.scrollHeight, maxHeight);
}

/** Prefer `placement`; flip vertically only when the panel would leave the viewport. */
export function resolvePopoverPlacement(
  triggerRect: DOMRect,
  panelHeight: number,
  preferred: PopoverPlacement,
  viewportHeight = window.innerHeight
): PopoverPlacement {
  const { vertical } = parsePlacement(preferred);
  const gap = POPOVER_PANEL_GAP_PX;
  const margin = POPOVER_VIEWPORT_MARGIN_PX;

  const spaceBelow = viewportHeight - triggerRect.bottom - gap - margin;
  const spaceAbove = triggerRect.top - gap - margin;

  if (vertical === 'bottom') {
    if (panelHeight <= spaceBelow) return preferred;
    if (spaceAbove > spaceBelow) return flipPlacementVertical(preferred, 'top');
    return preferred;
  }

  if (panelHeight <= spaceAbove) return preferred;
  if (spaceBelow > spaceAbove) return flipPlacementVertical(preferred, 'bottom');
  return preferred;
}