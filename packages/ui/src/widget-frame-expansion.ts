let closeExpandedFrame: (() => void) | undefined;

function transformBetween(bounds: DOMRect, base: DOMRect): string {
  return `translate(${bounds.left - base.left}px, ${bounds.top - base.top}px) scale(${bounds.width / base.width}, ${bounds.height / base.height})`;
}

export function createWidgetFrameExpansion(
  frame: HTMLElement,
  container: HTMLElement,
  changed: (active: boolean) => void
) {
  let active = false;
  let slot: HTMLDivElement | undefined;
  let frameStyle = '';
  let restoreContainment: (() => void) | undefined;
  let motion: Animation | undefined;

  function restore() {
    motion?.cancel();
    motion = undefined;
    if (!slot) return;
    if (frame.hasAttribute('popover')) {
      if (frame.isConnected) frame.hidePopover();
      frame.removeAttribute('popover');
    }
    frame.classList.remove('voiceroom-frame--expanded');
    frame.style.cssText = frameStyle;
    restoreContainment?.();
    restoreContainment = undefined;
    slot.remove();
    slot = undefined;
    if (closeExpandedFrame === closeImmediately) closeExpandedFrame = undefined;
  }

  function animate(from: DOMRect, to: DOMRect, base: DOMRect): Animation | undefined {
    if (!(from.width && from.height && to.width && to.height && base.width && base.height)) return;
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return;
    return frame.animate?.([{ transform: transformBetween(from, base) }, { transform: transformBetween(to, base) }], {
      duration: 220,
      easing: 'cubic-bezier(.22,.75,.25,1)',
      fill: 'both'
    });
  }

  function set(next: boolean, animated = true) {
    if (next === active && (next || !slot || animated)) return;
    const from = frame.getBoundingClientRect();
    const previous = active;
    active = next;
    motion?.cancel();
    motion = undefined;

    if (next) {
      if (closeExpandedFrame !== closeImmediately) closeExpandedFrame?.();
      closeExpandedFrame = closeImmediately;
      if (!slot) {
        frameStyle = frame.style.cssText;
        slot = document.createElement('div');
        slot.setAttribute('aria-hidden', 'true');
        slot.style.cssText = 'display:block;flex:none;visibility:hidden;pointer-events:none;';
        slot.style.width = frame.style.width || `${frame.offsetWidth}px`;
        slot.style.height = frame.style.height || `${frame.offsetHeight}px`;
        slot.style.position = frame.style.position;
        slot.style.inset = frame.style.inset;
        container.insertBefore(slot, frame);
        frame.style.cssText +=
          ';position:fixed;inset:0;margin:auto;padding:0;width:min(1200px,calc(100vw - 24px));height:min(900px,calc(100dvh - 24px));max-width:none;max-height:none;z-index:2147483647;transform-origin:top left;box-shadow:0 18px 90px #0008;';
        frame.classList.add('voiceroom-frame--expanded');
        if (typeof frame.showPopover === 'function') {
          frame.setAttribute('popover', 'manual');
          frame.showPopover();
        } else if (container.style.contain === 'size layout') {
          // Keep the inline slot sized, while releasing its fixed-position containing block.
          const position = container.style.position;
          if (getComputedStyle(container).position === 'static') container.style.position = 'relative';
          container.style.contain = 'size';
          restoreContainment = () => {
            container.style.position = position;
            container.style.contain = 'size layout';
          };
        }
      }
      const expanded = frame.getBoundingClientRect();
      motion = animate(from, expanded, expanded);
    } else if (animated && slot) {
      const expanded = frame.getBoundingClientRect();
      // Hold the top layer until the exit motion has finished.
      motion = animate(from, slot.getBoundingClientRect(), expanded);
      if (motion) motion.onfinish = restore;
      else restore();
    } else {
      restore();
    }
    if (previous !== active) changed(active);
  }

  function closeImmediately() {
    set(false, false);
  }

  function escape(event: KeyboardEvent) {
    if (!event.defaultPrevented && event.key === 'Escape' && active && closeExpandedFrame === closeImmediately) {
      event.preventDefault();
      set(false);
    }
  }

  window.addEventListener('keydown', escape);
  return {
    get active() {
      return active;
    },
    set,
    closeImmediately,
    dispose() {
      window.removeEventListener('keydown', escape);
      restore();
    }
  };
}
