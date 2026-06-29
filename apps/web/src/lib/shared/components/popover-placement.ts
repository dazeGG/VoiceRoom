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

export function viewportSpaceAroundTrigger(
  triggerRect: DOMRect,
  viewportHeight = window.innerHeight
): { spaceAbove: number; spaceBelow: number } {
  const gap = POPOVER_PANEL_GAP_PX;
  const margin = POPOVER_VIEWPORT_MARGIN_PX;
  return {
    spaceAbove: triggerRect.top - gap - margin,
    spaceBelow: viewportHeight - triggerRect.bottom - gap - margin
  };
}

/** Prefer `placement`; flip vertically only after measuring the rendered panel box. */
export function resolvePopoverPlacement(
  triggerRect: DOMRect,
  panelRect: DOMRect,
  preferred: PopoverPlacement,
  viewportHeight = window.innerHeight
): PopoverPlacement {
  const { vertical } = parsePlacement(preferred);
  const margin = POPOVER_VIEWPORT_MARGIN_PX;
  const { spaceAbove, spaceBelow } = viewportSpaceAroundTrigger(triggerRect, viewportHeight);

  if (vertical === 'bottom') {
    const overflowsBelow =
      panelRect.bottom > viewportHeight - margin || panelRect.height > spaceBelow;
    if (!overflowsBelow) return preferred;
    if (spaceAbove > spaceBelow) return flipPlacementVertical(preferred, 'top');
    return preferred;
  }

  const overflowsAbove =
    panelRect.top < margin || panelRect.height > spaceAbove;
  if (!overflowsAbove) return preferred;
  if (spaceBelow > spaceAbove) return flipPlacementVertical(preferred, 'bottom');
  return preferred;
}