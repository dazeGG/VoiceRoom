// Single open profile card for the whole app. Mounted once in the root layout,
// opened from anywhere an avatar or display name is clickable.

import { defineStore } from 'pinia';
import { markRaw, onScopeDispose, reactive } from 'vue';
import type { ProfileCardPerson } from '@/shared/components/profile-card/types';

export type ProfileCardAnchor = {
  /** Captured before the opener/menu is removed from the DOM. */
  rect: Pick<DOMRect, 'left' | 'right' | 'top'> | null;
  /** A stable element outside the closing surface, when one exists. */
  restoreFocus?: HTMLElement | null;
};

const CARD_WIDTH = 300;
const CARD_GAP = 10;
const VIEWPORT_GAP = 12;

export const useProfileCardUiStore = defineStore('profile-card-ui', () => {
  const profileCardUi = reactive<{
    open: boolean;
    x: number;
    y: number;
    person: ProfileCardPerson | null;
    preview: boolean;
    restoreFocus: HTMLElement | null;
  }>({
    open: false,
    x: 0,
    y: 0,
    person: null,
    preview: false,
    restoreFocus: null
  });

  let previewTimer: ReturnType<typeof setTimeout> | undefined;
  let closeTimer: ReturnType<typeof setTimeout> | undefined;
  let previewTarget: HTMLElement | null = null;
  let pointerOverTrigger = false;
  let triggerFocused = false;
  let restoringFocus = false;
  const clearPreviewTimers = (): void => {
    clearTimeout(previewTimer);
    clearTimeout(closeTimer);
  };
  onScopeDispose(clearPreviewTimers);

  function closeProfileCard(restoreFocus = true): void {
    clearPreviewTimers();
    previewTarget = null;
    const target = restoreFocus ? profileCardUi.restoreFocus : null;
    profileCardUi.open = false;
    profileCardUi.preview = false;
    profileCardUi.person = null;
    profileCardUi.restoreFocus = null;
    if (target)
      queueMicrotask(() => {
        restoringFocus = true;
        target.focus();
        restoringFocus = false;
      });
  }

  /**
   * Anchors the card beside the clicked element rather than at the pointer, so a
   * click anywhere on an avatar produces the same placement: to its right, or to
   * its left when there is no room.
   */
  function openProfileCardFor(person: ProfileCardPerson, anchor: EventTarget | ProfileCardAnchor | null): void {
    clearPreviewTimers();
    previewTarget = null;
    profileCardUi.preview = false;
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
    const restoreFocus = explicit?.restoreFocus ?? element;
    profileCardUi.restoreFocus = restoreFocus ? markRaw(restoreFocus) : null;
    profileCardUi.open = true;
  }

  function previewProfileCardFor(person: ProfileCardPerson, event: PointerEvent | FocusEvent): void {
    const target = event.currentTarget;
    if (!(target instanceof HTMLElement) || restoringFocus || (profileCardUi.open && !profileCardUi.preview)) return;
    if (window.matchMedia?.('(pointer: coarse)').matches || ('pointerType' in event && event.pointerType === 'touch'))
      return;
    clearPreviewTimers();
    if (previewTarget !== target) {
      previewTarget = target;
      pointerOverTrigger = false;
      triggerFocused = false;
    }
    if (event.type === 'focus') triggerFocused = true;
    else pointerOverTrigger = true;

    const show = (): void => {
      if (!target.isConnected) return;
      profileCardUi.person = person;
      profileCardUi.restoreFocus = markRaw(target);
      profileCardUi.preview = true;
      profileCardUi.open = true;
    };
    if (triggerFocused) show();
    else previewTimer = setTimeout(show, 400);
  }

  function keepProfilePreview(): void {
    clearTimeout(closeTimer);
  }

  function schedulePreviewClose(): void {
    if (!profileCardUi.preview || triggerFocused || pointerOverTrigger) return;
    clearTimeout(closeTimer);
    closeTimer = setTimeout(() => closeProfileCard(false), 250);
  }

  function leaveProfileCardPreview(event: PointerEvent | FocusEvent): void {
    if (event.currentTarget !== previewTarget) return;
    if (event.type === 'blur') triggerFocused = false;
    else pointerOverTrigger = false;
    if (triggerFocused || pointerOverTrigger) return;
    clearTimeout(previewTimer);
    schedulePreviewClose();
  }

  return {
    profileCardUi,
    closeProfileCard,
    openProfileCardFor,
    previewProfileCardFor,
    leaveProfileCardPreview,
    keepProfilePreview,
    schedulePreviewClose
  };
});
