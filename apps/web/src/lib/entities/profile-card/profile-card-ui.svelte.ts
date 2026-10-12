// Single open profile card for the whole app. Mounted once in the root layout,
// opened from anywhere an avatar or display name is clickable.

import type { ProfileCardPerson } from '$lib/shared/components/profile-card';

export const profileCardUi = $state({
  open: false,
  x: 0,
  y: 0,
  person: null as ProfileCardPerson | null,
  restoreFocus: null as HTMLElement | null
});

export type ProfileCardAnchor = {
  /** Captured before the opener/menu is removed from the DOM. */
  rect: Pick<DOMRect, 'left' | 'right' | 'top'> | null;
  /** A stable element outside the closing surface, when one exists. */
  restoreFocus?: HTMLElement | null;
};

export function closeProfileCard(restoreFocus = true): void {
  const target = restoreFocus ? profileCardUi.restoreFocus : null;
  profileCardUi.open = false;
  profileCardUi.person = null;
  profileCardUi.restoreFocus = null;
  if (target) queueMicrotask(() => target.focus());
}

const CARD_WIDTH = 300;
const CARD_GAP = 10;
const VIEWPORT_GAP = 12;

/**
 * Anchors the card beside the clicked element rather than at the pointer, so a
 * click anywhere on an avatar produces the same placement: to its right, or to
 * its left when there is no room.
 */
export function openProfileCardFor(person: ProfileCardPerson, anchor: EventTarget | ProfileCardAnchor | null): void {
  const element = anchor instanceof HTMLElement ? anchor : null;
  const explicit = !element && anchor && 'rect' in anchor ? anchor : null;
  const rect = explicit?.rect ?? element?.getBoundingClientRect() ?? null;
  profileCardUi.person = person;
  if (rect) {
    const fitsRight = rect.right + CARD_GAP + CARD_WIDTH + VIEWPORT_GAP <= window.innerWidth;
    profileCardUi.x = fitsRight ? rect.right + CARD_GAP : Math.max(VIEWPORT_GAP, rect.left - CARD_GAP - CARD_WIDTH);
    profileCardUi.y = rect.top - 16;
  } else {
    profileCardUi.x = 0;
    profileCardUi.y = 0;
  }
  profileCardUi.restoreFocus = explicit?.restoreFocus ?? element;
  profileCardUi.open = true;
}
