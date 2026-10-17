<script lang="ts">
  // The small picture of a call between two people. It can be dragged to any
  // corner; a tap grows my own picture to show the camera switch, a second tap
  // puts me full screen, and a tap on the other person swaps straight back.
  import type { MobileCallScene } from '../mobile-call-ui.svelte';
  import { nearestCorner, type PipCorner } from '../mobile-call-layout';
  import { restartChromeTimer, setPipCorner, tapPip } from '../mobile-call-ui.svelte';
  import MobileCallTile from './MobileCallTile.svelte';
  import MobileCameraFlip from './MobileCameraFlip.svelte';

  let { scene, corner }: { scene: Extract<MobileCallScene, { kind: 'duo' }>; corner: PipCorner } = $props();

  /** Past this many pixels a touch is a drag, not a tap: a finger wobbles a few on its own. */
  const DRAG_THRESHOLD_PX = 10;

  let box = $state<HTMLElement>();
  let dragging = $state(false);
  let offsetX = $state(0);
  let offsetY = $state(0);
  let start: { x: number; y: number } | null = null;
  // The click that ends a drag must not count as a tap.
  let dragged = false;

  const participant = $derived(scene.pip);
  const expanded = $derived(scene.pipExpanded);
  const canFlip = $derived(expanded && Boolean(participant.cameraStream));

  function handlePointerDown(event: PointerEvent): void {
    // The stage underneath would take this touch as a tap on the big picture.
    event.stopPropagation();
    restartChromeTimer();
    if (event.button !== 0) return;
    start = { x: event.clientX, y: event.clientY };
    dragged = false;
  }

  function handlePointerMove(event: PointerEvent): void {
    if (!start) return;
    // A mouse let go outside the box never sent its pointerup here.
    if (event.pointerType === 'mouse' && event.buttons === 0) return handlePointerCancel();
    const x = event.clientX - start.x;
    const y = event.clientY - start.y;
    if (!dragging && Math.hypot(x, y) <= DRAG_THRESHOLD_PX) return;
    // Captured only once it is a drag: a captured tap would send its click to
    // this box instead of the tile, and the tap would be lost.
    if (!dragging) box?.setPointerCapture?.(event.pointerId);
    dragging = true;
    offsetX = x;
    offsetY = y;
  }

  function handlePointerUp(): void {
    start = null;
    if (!dragging) return;
    dragged = true;
    const area = box?.parentElement?.getBoundingClientRect();
    const rect = box?.getBoundingClientRect();
    if (area && rect) {
      setPipCorner(
        nearestCorner(
          { x: rect.left + rect.width / 2 - area.left, y: rect.top + rect.height / 2 - area.top },
          { width: area.width, height: area.height }
        )
      );
    }
    dragging = false;
    offsetX = 0;
    offsetY = 0;
  }

  function handlePointerCancel(): void {
    start = null;
    dragging = false;
    offsetX = 0;
    offsetY = 0;
  }

  // Dragging is for fingers; the tile inside stays a button for everyone.
  function followDrag(node: HTMLElement): () => void {
    const listeners = {
      pointerdown: handlePointerDown,
      pointermove: handlePointerMove,
      pointerup: handlePointerUp,
      pointercancel: handlePointerCancel
    } as const;
    for (const [type, listener] of Object.entries(listeners)) node.addEventListener(type, listener as EventListener);
    return () => {
      for (const [type, listener] of Object.entries(listeners))
        node.removeEventListener(type, listener as EventListener);
    };
  }

  function handleTap(): void {
    if (dragged) {
      dragged = false;
      return;
    }
    tapPip(scene);
  }
</script>

<div
  bind:this={box}
  class="mc-pip"
  data-corner={corner}
  data-expanded={expanded ? 'true' : undefined}
  data-dragging={dragging ? 'true' : undefined}
  style:transform={dragging ? `translate(${offsetX}px, ${offsetY}px)` : undefined}
  {@attach followDrag}
>
  <MobileCallTile {participant} variant="pip" ontap={handleTap} />
  {#if canFlip}
    <div class="mc-pip-flip"><MobileCameraFlip variant="round" /></div>
  {/if}
</div>

<style>
  .mc-pip {
    --pip-w: 100px;
    --pip-h: 178px;
    position: absolute;
    left: var(--pip-x);
    top: var(--pip-y);
    z-index: 4;
    width: var(--pip-w);
    height: var(--pip-h);
    overflow: hidden;
    border-radius: 14px;
    box-shadow:
      var(--vr-shadow-popover),
      0 0 0 1px var(--vr-line-strong);
    touch-action: none;
    transition:
      left 320ms cubic-bezier(0.2, 0.8, 0.2, 1),
      top 320ms cubic-bezier(0.2, 0.8, 0.2, 1),
      width 320ms cubic-bezier(0.2, 0.8, 0.2, 1),
      height 320ms cubic-bezier(0.2, 0.8, 0.2, 1),
      /* A dropped picture glides from where the finger left it. */ transform 320ms cubic-bezier(0.2, 0.8, 0.2, 1);
  }

  /* Grown to turn the camera: twice the size, as far as the screen allows. */
  .mc-pip[data-expanded='true'] {
    --pip-w: 200px;
    --pip-h: min(356px, calc(100% - 8px));
    border-radius: 18px;
  }

  .mc-pip[data-dragging='true'] {
    transition: none;
  }

  .mc-pip[data-corner^='t'] {
    --pip-y: 4px;
  }

  .mc-pip[data-corner^='b'] {
    --pip-y: calc(100% - 4px - var(--pip-h));
  }

  .mc-pip[data-corner$='l'] {
    --pip-x: 10px;
  }

  .mc-pip[data-corner$='r'] {
    --pip-x: calc(100% - 10px - var(--pip-w));
  }

  .mc-pip-flip {
    position: absolute;
    left: 50%;
    bottom: 38px;
    z-index: 4;
    transform: translateX(-50%);
  }
</style>
