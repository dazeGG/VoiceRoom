<script setup lang="ts">
import { IconButton } from '@voiceroom/ui-kit/components';
import { t } from '@voiceroom/ui-kit/i18n';
import { fitTiles } from '@voiceroom/ui/tile-grid';
import { ChevronDown, ChevronLeft, ChevronRight } from '@lucide/vue';
import { computed, ref, watch } from 'vue';
import type { Participant } from '../engine/core/types';

const props = defineProps<{
  participants: Participant[];
  focusedParticipant: Participant | null;
  screenFocused: boolean;
  streamCount: number;
}>();

defineSlots<{
  participants(props: { participants: Participant[]; variant: 'grid' | 'strip' }): unknown;
  streams(): unknown;
  contextMenu?(): unknown;
}>();

const totalCount = computed(() => props.participants.length + props.streamCount);
const stripParticipants = computed(() =>
  props.participants.filter((participant) => participant.id !== props.focusedParticipant?.id)
);
const carousel = ref<HTMLDivElement | null>(null);
const grid = ref<HTMLDivElement | null>(null);
const canScrollLeft = ref(false);
const canScrollRight = ref(false);
// fitTiles marks a grid that overflows with data-scroll; the stylesheet reads the class.
const gridScrolls = ref(false);

function moveCarousel(direction: number): void {
  carousel.value?.scrollBy({
    left: direction * Math.max(carousel.value.clientWidth - 60, 154),
    behavior: 'smooth'
  });
}

function updateCarouselNav(): void {
  const el = carousel.value;
  if (!el) {
    canScrollLeft.value = false;
    canScrollRight.value = false;
    return;
  }
  const maxScroll = el.scrollWidth - el.clientWidth;
  canScrollLeft.value = el.scrollLeft > 4;
  canScrollRight.value = el.scrollLeft < maxScroll - 4;
}

// Keep the arrows in sync with overflow: tiles join/leave, previews resize,
// and the stage itself resizes — none of which fire a scroll event.
watch(
  carousel,
  (el, _previous, onCleanup) => {
    if (!el) {
      updateCarouselNav();
      return;
    }
    const observer = new ResizeObserver(updateCarouselNav);
    observer.observe(el);
    if (el.firstElementChild) observer.observe(el.firstElementChild);
    updateCarouselNav();
    onCleanup(() => observer.disconnect());
  },
  { flush: 'post' }
);

watch(
  grid,
  (el, _previous, onCleanup) => {
    if (!el) return;
    const stopFitting = fitTiles(el);
    const mirrorScroll = (): void => {
      gridScrolls.value = el.dataset.scroll === 'true';
    };
    const observer = new MutationObserver(mirrorScroll);
    observer.observe(el, { attributes: true, attributeFilter: ['data-scroll'] });
    mirrorScroll();
    onCleanup(() => {
      observer.disconnect();
      stopFitting();
      gridScrolls.value = false;
    });
  },
  { flush: 'post' }
);
</script>

<template>
  <div id="stageStrip" class="stage-strip" :aria-label="t('Плитки комнаты')">
    <div class="stage-strip__bar" hidden>
      <div class="stage-strip__title">
        <span id="stageStripKicker" class="stage-strip__kicker">{{ t('В комнате') }}</span>
        <strong id="stageStripSummary" class="stage-strip__summary">{{ t('0 участников') }}</strong>
      </div>
      <IconButton
        id="stripToggleButton"
        :size="32"
        variant="outline"
        :tooltip="false"
        class="stage-strip__toggle"
        :label="t('Свернуть пользователей')"
        aria-pressed="false"
        hidden
      >
        <ChevronDown aria-hidden="true" />
      </IconButton>
    </div>

    <div v-if="focusedParticipant" class="participant-focus">
      <div class="participant-focus__stage">
        <slot name="participants" :participants="[focusedParticipant]" variant="grid" />
      </div>
      <div class="participant-carousel">
        <IconButton
          :size="32"
          variant="outline"
          :tooltip="false"
          pill
          :class="['participant-carousel__nav', { 'participant-carousel__nav--hidden': !canScrollLeft }]"
          :label="t('Предыдущие участники')"
          :tabindex="canScrollLeft ? 0 : -1"
          @click="moveCarousel(-1)"
        >
          <ChevronLeft :size="18" />
        </IconButton>
        <div ref="carousel" class="participant-carousel__viewport" @scroll="updateCarouselNav">
          <div class="participant-carousel__strip">
            <slot name="streams" />
            <slot name="participants" :participants="stripParticipants" variant="strip" />
          </div>
        </div>
        <IconButton
          :size="32"
          variant="outline"
          :tooltip="false"
          pill
          :class="['participant-carousel__nav', { 'participant-carousel__nav--hidden': !canScrollRight }]"
          :label="t('Следующие участники')"
          :tabindex="canScrollRight ? 0 : -1"
          @click="moveCarousel(1)"
        >
          <ChevronRight :size="18" />
        </IconButton>
      </div>
    </div>
    <!-- The focused stream itself is the sibling ScreenStage; the strip row
         below carries everyone else in the same spotlight carousel. -->
    <div v-else-if="screenFocused" class="participant-carousel">
      <IconButton
        :size="32"
        variant="outline"
        :tooltip="false"
        pill
        :class="['participant-carousel__nav', { 'participant-carousel__nav--hidden': !canScrollLeft }]"
        :label="t('Предыдущие участники')"
        :tabindex="canScrollLeft ? 0 : -1"
        @click="moveCarousel(-1)"
      >
        <ChevronLeft :size="18" />
      </IconButton>
      <div ref="carousel" class="participant-carousel__viewport" @scroll="updateCarouselNav">
        <div class="participant-carousel__strip">
          <slot name="streams" />
          <slot name="participants" :participants="participants" variant="strip" />
        </div>
      </div>
      <IconButton
        :size="32"
        variant="outline"
        :tooltip="false"
        pill
        :class="['participant-carousel__nav', { 'participant-carousel__nav--hidden': !canScrollRight }]"
        :label="t('Следующие участники')"
        :tabindex="canScrollRight ? 0 : -1"
        @click="moveCarousel(1)"
      >
        <ChevronRight :size="18" />
      </IconButton>
    </div>
    <div
      v-else
      id="tileGrid"
      ref="grid"
      :class="['tile-grid', { 'tile-grid--scroll': gridScrolls, 'tile-grid--empty': totalCount === 0 }]"
      aria-live="polite"
    >
      <slot name="streams" />
      <slot name="participants" :participants="participants" variant="grid" />
    </div>
  </div>
  <slot name="contextMenu" />
</template>
