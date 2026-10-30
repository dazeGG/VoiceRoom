<script setup lang="ts">
// Not the shared Dialog: the story has no title bar or cross, only its own
// progress bars and buttons, so it keeps the Svelte card and traps focus itself.
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { fetchWhatsNew, markWhatsNewSeen } from '@/api/auth';
import { Button } from '@/shared/ui';
import { WHATS_NEW_SLIDES, WHATS_NEW_SLIDE_MS, shouldShowWhatsNew } from '../model/whats-new';

const props = withDefaults(defineProps<{ paused?: boolean }>(), { paused: false });

const emit = defineEmits<{
  openAppearance: [];
  /** Lets the lobby hold back other prompts while the story is on screen. */
  openChange: [open: boolean];
}>();

const due = ref(false);
// Waits while a more urgent dialog, such as a new sign-in question, is up.
const open = computed(() => due.value && !props.paused);

watch(open, (isOpen) => emit('openChange', isOpen), { immediate: true });

const index = ref(0);
// The last slide has run its time and stays up until the reader closes it.
const ended = ref(false);
const hovered = ref(false);
const held = ref(false);
const hiddenTab = ref(false);
const reducedMotion = ref(false);

const card = ref<HTMLElement | null>(null);
const stageEl = ref<HTMLElement | null>(null);

const slide = computed(() => WHATS_NEW_SLIDES[index.value] ?? WHATS_NEW_SLIDES[0]);
const last = computed(() => index.value === WHATS_NEW_SLIDES.length - 1);
// Slides turn by themselves like stories, but hold still while pointed at,
// pressed or in a background tab. With reduced motion they only turn by hand:
// the global rule shortens every animation, which would flick through them all.
const running = computed(() => !hovered.value && !held.value && !hiddenTab.value);

let pointerStart: { x: number; y: number; at: number } | null = null;
let previousFocus: HTMLElement | null = null;

// The card can disappear under a more urgent dialog while the pointer is over
// it or held down, and then no pointerleave or pointerup ever reaches it. Its
// reasons to wait go with it, so the story is never stuck when it comes back.
watch(
  open,
  (isOpen) => {
    if (isOpen) {
      previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      void nextTick(() => stageEl.value?.focus({ preventScroll: true }));
      return;
    }
    hovered.value = false;
    held.value = false;
    pointerStart = null;
    previousFocus?.focus();
    previousFocus = null;
  },
  { flush: 'post' }
);

let cancelled = false;
let motion: MediaQueryList | null = null;

function onMotionChange(): void {
  reducedMotion.value = motion?.matches ?? false;
}

function onVisibilityChange(): void {
  hiddenTab.value = document.hidden;
}

onMounted(() => {
  void fetchWhatsNew()
    .then((state) => {
      if (cancelled || !shouldShowWhatsNew(state)) return;
      // Every picture is fetched up front, so a slide never opens on an empty frame.
      for (const item of WHATS_NEW_SLIDES) new Image().src = item.image;
      due.value = true;
    })
    .catch(() => {
      // The announcement is optional; a failed check must not get in the way.
    });

  motion = window.matchMedia('(prefers-reduced-motion: reduce)');
  onMotionChange();
  onVisibilityChange();
  motion.addEventListener('change', onMotionChange);
  document.addEventListener('visibilitychange', onVisibilityChange);
  // The release happens wherever the pointer went, so the window hears it.
  window.addEventListener('keydown', onKeydown);
  window.addEventListener('pointerup', onPointerUp);
  window.addEventListener('pointercancel', onPointerCancel);
});

onBeforeUnmount(() => {
  cancelled = true;
  motion?.removeEventListener('change', onMotionChange);
  document.removeEventListener('visibilitychange', onVisibilityChange);
  window.removeEventListener('keydown', onKeydown);
  window.removeEventListener('pointerup', onPointerUp);
  window.removeEventListener('pointercancel', onPointerCancel);
});

// Recorded as seen however the dialog is closed, so each release is shown once.
function finish(openAppearance: boolean): void {
  due.value = false;
  void markWhatsNewSeen().catch(() => {});
  if (openAppearance) emit('openAppearance');
}

function step(delta: number): void {
  const next = index.value + delta;
  if (next < 0 || next >= WHATS_NEW_SLIDES.length) return;
  index.value = next;
  ended.value = false;
}

function onSlideTimeUp(): void {
  if (last.value) ended.value = true;
  else step(1);
}

function onKeydown(event: KeyboardEvent): void {
  if (!open.value) return;
  if (event.key === 'Escape') finish(false);
  else if (event.key === 'ArrowRight') step(1);
  else if (event.key === 'ArrowLeft') step(-1);
}

// Tab stays on the card's own buttons.
function onCardKeydown(event: KeyboardEvent): void {
  if (event.key !== 'Tab' || !card.value) return;
  const focusable = [...card.value.querySelectorAll<HTMLElement>('button:not(:disabled)')];
  const first = focusable[0];
  const lastButton = focusable[focusable.length - 1];
  if (!first || !lastButton) return;
  if (event.shiftKey && (document.activeElement === first || document.activeElement === card.value)) {
    event.preventDefault();
    lastButton.focus();
  } else if (!event.shiftKey && document.activeElement === lastButton) {
    event.preventDefault();
    first.focus();
  }
}

function onPointerDown(event: PointerEvent): void {
  if (event.button !== 0) return;
  pointerStart = { x: event.clientX, y: event.clientY, at: performance.now() };
  held.value = true;
}

function onPointerUp(event: PointerEvent): void {
  held.value = false;
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
    const rect = stageEl.value?.getBoundingClientRect();
    if (rect) step(event.clientX - rect.left < rect.width / 3 ? -1 : 1);
  }
}

function onPointerCancel(): void {
  held.value = false;
  pointerStart = null;
}

function onHover(event: PointerEvent, value: boolean): void {
  if (event.pointerType === 'mouse') hovered.value = value;
}
</script>

<template>
  <div v-if="open" class="stories__overlay" role="presentation">
    <div
      ref="card"
      class="stories__card"
      role="dialog"
      aria-modal="true"
      aria-labelledby="whatsNewSlideTitle"
      aria-describedby="whatsNewSlideText"
      tabindex="-1"
      @keydown="onCardKeydown"
      @pointerenter="onHover($event, true)"
      @pointerleave="onHover($event, false)"
    >
      <div class="stories__progress" aria-hidden="true">
        <span v-for="(item, i) in WHATS_NEW_SLIDES" :key="item.image" class="stories__segment">
          <span
            v-if="i < index || (i === index && (ended || reducedMotion))"
            class="stories__fill stories__fill--full"
          ></span>
          <span
            v-else-if="i === index"
            class="stories__fill stories__fill--run"
            :class="{ 'stories__fill--paused': !running }"
            :style="{ animationDuration: `${WHATS_NEW_SLIDE_MS}ms` }"
            @animationend="onSlideTimeUp"
          ></span>
        </span>
      </div>

      <div class="stories__head">
        <span class="stories__kicker">Что нового в VoiceRoom · {{ index + 1 }} из {{ WHATS_NEW_SLIDES.length }}</span>
        <button v-if="!last" class="stories__quiet" type="button" @click="finish(false)">Пропустить</button>
      </div>

      <div ref="stageEl" class="stories__stage" role="presentation" tabindex="-1" @pointerdown="onPointerDown">
        <div :key="index" class="stories__slide">
          <img class="stories__image" :src="slide.image" :alt="slide.alt" width="1088" height="816" draggable="false" />
          <h2 id="whatsNewSlideTitle" class="stories__title">{{ slide.title }}</h2>
          <p id="whatsNewSlideText" class="stories__text">{{ slide.text }}</p>
        </div>
      </div>

      <div class="stories__actions">
        <button v-if="index > 0" class="stories__quiet" type="button" @click="step(-1)">Назад</button>
        <span class="stories__spacer"></span>
        <Button v-if="last && slide.action === 'appearance'" variant="ghost" type="button" @click="finish(true)">
          Настроить
        </Button>
        <Button v-if="last" variant="primary" type="button" @click="finish(false)">Понятно</Button>
        <Button v-else variant="primary" type="button" @click="step(1)">Далее</Button>
      </div>
    </div>
  </div>
</template>
