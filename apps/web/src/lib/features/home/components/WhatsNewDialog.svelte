<script lang="ts">
  import { onMount } from 'svelte';
  import { fetchWhatsNew, markWhatsNewSeen } from '$lib/api/auth';
  import { Button } from '$lib/shared/ui';
  import { dialogFocusTrap } from '$lib/shared/ui/focus-trap';
  import { WHATS_NEW_SLIDES, WHATS_NEW_SLIDE_MS, shouldShowWhatsNew } from '../model/whats-new';

  let {
    paused = false,
    onOpenSecurity,
    onOpenChange
  } = $props<{
    paused?: boolean;
    onOpenSecurity: () => void;
    /** Lets the lobby hold back other prompts while the story is on screen. */
    onOpenChange?: (open: boolean) => void;
  }>();

  let due = $state(false);
  // Waits while a more urgent dialog, such as a new sign-in question, is up.
  const open = $derived(due && !paused);

  $effect(() => {
    onOpenChange?.(open);
  });

  let index = $state(0);
  // The last slide has run its time and stays up until the reader closes it.
  let ended = $state(false);
  let hovered = $state(false);
  let held = $state(false);
  let hiddenTab = $state(false);
  let reducedMotion = $state(false);

  const slide = $derived(WHATS_NEW_SLIDES[index]);
  const last = $derived(index === WHATS_NEW_SLIDES.length - 1);
  // Slides turn by themselves like stories, but hold still while pointed at,
  // pressed or in a background tab. With reduced motion they only turn by hand:
  // the global rule shortens every animation, which would flick through them all.
  const running = $derived(!hovered && !held && !hiddenTab);

  // The card can disappear under a more urgent dialog while the pointer is over
  // it or held down, and then no pointerleave or pointerup ever reaches it. Its
  // reasons to wait go with it, so the story is never stuck when it comes back.
  $effect(() => {
    if (open) return;
    hovered = false;
    held = false;
    pointerStart = null;
  });

  onMount(() => {
    let cancelled = false;
    void fetchWhatsNew()
      .then((state) => {
        if (cancelled || !shouldShowWhatsNew(state)) return;
        // Every picture is fetched up front, so a slide never opens on an empty frame.
        for (const item of WHATS_NEW_SLIDES) new Image().src = item.image;
        due = true;
      })
      .catch(() => {
        // The announcement is optional; a failed check must not get in the way.
      });

    const motion = window.matchMedia('(prefers-reduced-motion: reduce)');
    const onMotionChange = () => {
      reducedMotion = motion.matches;
    };
    const onVisibilityChange = () => {
      hiddenTab = document.hidden;
    };
    onMotionChange();
    onVisibilityChange();
    motion.addEventListener('change', onMotionChange);
    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => {
      cancelled = true;
      motion.removeEventListener('change', onMotionChange);
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
  });

  // Recorded as seen however the dialog is closed, so each release is shown once.
  function finish(openSecurity: boolean): void {
    due = false;
    void markWhatsNewSeen().catch(() => {});
    if (openSecurity) onOpenSecurity();
  }

  function step(delta: number): void {
    const next = index + delta;
    if (next < 0 || next >= WHATS_NEW_SLIDES.length) return;
    index = next;
    ended = false;
  }

  function onSlideTimeUp(): void {
    if (last) ended = true;
    else step(1);
  }

  function onKeydown(event: KeyboardEvent): void {
    if (!open) return;
    if (event.key === 'Escape') finish(false);
    else if (event.key === 'ArrowRight') step(1);
    else if (event.key === 'ArrowLeft') step(-1);
  }

  let stageEl: HTMLElement | undefined = $state();
  let pointerStart: { x: number; y: number; at: number } | null = null;

  function onPointerDown(event: PointerEvent): void {
    if (event.button !== 0) return;
    pointerStart = { x: event.clientX, y: event.clientY, at: performance.now() };
    held = true;
  }

  function onPointerUp(event: PointerEvent): void {
    held = false;
    const start = pointerStart;
    pointerStart = null;
    if (!start) return;
    const dx = event.clientX - start.x;
    const dy = event.clientY - start.y;
    if (Math.abs(dx) > 40 && Math.abs(dx) > Math.abs(dy)) {
      step(dx < 0 ? 1 : -1);
      return;
    }
    // A quick tap turns the page as in stories: the left third goes back.
    if (Math.abs(dx) < 10 && Math.abs(dy) < 10 && performance.now() - start.at < 300) {
      const rect = stageEl?.getBoundingClientRect();
      if (rect) step(event.clientX - rect.left < rect.width / 3 ? -1 : 1);
    }
  }

  function onPointerCancel(): void {
    held = false;
    pointerStart = null;
  }

  function onHover(event: PointerEvent, value: boolean): void {
    if (event.pointerType === 'mouse') hovered = value;
  }
</script>

<!-- The release happens wherever the pointer went, so the window hears it. -->
<svelte:window onkeydown={onKeydown} onpointerup={onPointerUp} onpointercancel={onPointerCancel} />

{#if open}
  <div class="stories-overlay" role="presentation">
    <div
      class="stories-card"
      role="dialog"
      aria-modal="true"
      aria-labelledby="whatsNewSlideTitle"
      aria-describedby="whatsNewSlideText"
      tabindex="-1"
      use:dialogFocusTrap={{ enabled: open, initialFocus: '.stories-stage' }}
      onpointerenter={(event) => onHover(event, true)}
      onpointerleave={(event) => onHover(event, false)}
    >
      <div class="stories-progress" aria-hidden="true">
        {#each WHATS_NEW_SLIDES as item, i (item.image)}
          <span class="stories-segment">
            {#if i < index || (i === index && (ended || reducedMotion))}
              <span class="stories-fill stories-fill--full"></span>
            {:else if i === index}
              <span
                class="stories-fill stories-fill--run"
                class:stories-fill--paused={!running}
                style:animation-duration={`${WHATS_NEW_SLIDE_MS}ms`}
                onanimationend={onSlideTimeUp}
              ></span>
            {/if}
          </span>
        {/each}
      </div>

      <div class="stories-head">
        <span class="stories-kicker">Что нового в Voice Room · {index + 1} из {WHATS_NEW_SLIDES.length}</span>
        {#if !last}
          <button class="stories-quiet" type="button" onclick={() => finish(false)}>Пропустить</button>
        {/if}
      </div>

      <div class="stories-stage" role="presentation" tabindex="-1" bind:this={stageEl} onpointerdown={onPointerDown}>
        {#key index}
          <div class="stories-slide">
            <img class="stories-image" src={slide.image} alt={slide.alt} width="1088" height="816" draggable="false" />
            <h2 class="stories-title" id="whatsNewSlideTitle">{slide.title}</h2>
            <p class="stories-text" id="whatsNewSlideText">{slide.text}</p>
          </div>
        {/key}
      </div>

      <div class="stories-actions">
        {#if index > 0}
          <button class="stories-quiet" type="button" onclick={() => step(-1)}>Назад</button>
        {/if}
        <span class="stories-spacer"></span>
        {#if last && slide.action === 'security'}
          <Button variant="ghost" type="button" onclick={() => finish(true)}>Настроить</Button>
        {/if}
        {#if last}
          <Button variant="primary" type="button" onclick={() => finish(false)}>Понятно</Button>
        {:else}
          <Button variant="primary" type="button" onclick={() => step(1)}>Далее</Button>
        {/if}
      </div>
    </div>
  </div>
{/if}

<style>
  .stories-overlay {
    position: fixed;
    inset: 0;
    z-index: 40;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 16px;
    background: color-mix(in srgb, var(--warm-950) 62%, transparent);
    backdrop-filter: blur(4px);
    -webkit-backdrop-filter: blur(4px);
  }

  .stories-card {
    width: min(520px, 100%);
    padding: 14px 16px 16px;
    border: 1px solid rgba(255, 255, 255, 0.1);
    border-radius: var(--radius-xl);
    background: var(--warm-800);
    box-shadow: var(--shadow);
    outline: none;
  }

  .stories-progress {
    display: flex;
    gap: 4px;
  }

  .stories-segment {
    flex: 1;
    height: 3px;
    overflow: hidden;
    border-radius: var(--radius-pill);
    background: color-mix(in oklch, var(--warm-ink), transparent 82%);
  }

  .stories-fill {
    display: block;
    height: 100%;
    background: var(--warm-ink);
    transform-origin: left center;
  }

  .stories-fill--run {
    animation-name: stories-fill;
    animation-timing-function: linear;
    animation-fill-mode: forwards;
  }

  .stories-fill--paused {
    animation-play-state: paused;
  }

  @keyframes stories-fill {
    from {
      transform: scaleX(0);
    }
    to {
      transform: scaleX(1);
    }
  }

  .stories-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    min-height: 30px;
    margin: 8px 0 8px;
  }

  .stories-kicker {
    color: var(--warm-muted);
    font-size: 12px;
  }

  .stories-quiet {
    padding: 4px 8px;
    border: none;
    border-radius: var(--radius-sm);
    background: none;
    color: var(--warm-muted);
    font: inherit;
    font-size: 13px;
    cursor: pointer;
  }

  .stories-quiet:hover,
  .stories-quiet:focus-visible {
    background: var(--control);
    color: var(--warm-ink);
  }

  .stories-stage {
    outline: none;
    touch-action: pan-y;
    cursor: default;
  }

  .stories-slide {
    animation: stories-in 220ms ease-out;
  }

  /* A screenshot of the real app, framed like the surfaces around it. */
  .stories-image {
    display: block;
    width: 100%;
    height: auto;
    aspect-ratio: 4 / 3;
    border: 1px solid rgba(255, 255, 255, 0.08);
    border-radius: var(--radius-lg);
    background: var(--panel);
    object-fit: cover;
    user-select: none;
  }

  @keyframes stories-in {
    from {
      opacity: 0;
      transform: translateY(6px);
    }
    to {
      opacity: 1;
      transform: none;
    }
  }

  .stories-title {
    margin: 16px 0 4px;
    color: var(--warm-ink);
    font-family: var(--font-ui);
    font-size: 18px;
    font-weight: 700;
    letter-spacing: -0.01em;
  }

  .stories-text {
    min-height: calc(2 * 1.45em);
    margin: 0;
    color: var(--warm-muted);
    font-size: 14px;
    line-height: 1.45;
  }

  .stories-actions {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 8px;
    margin-top: 16px;
  }

  .stories-spacer {
    flex: 1;
  }

  @media (prefers-reduced-motion: reduce) {
    .stories-slide {
      animation: none;
    }
  }
</style>
