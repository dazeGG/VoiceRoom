<script setup lang="ts">
import { ChevronDown, ChevronLeft, ChevronRight } from '@lucide/vue';
import { computed, ref, watch } from 'vue';
import { fitTiles } from '@/shared/ui/tile-grid';
import { state as roomState } from '../client/core/room-runtime.store';
import { getScreenParticipants } from '../client/ui/screen-view';
import { useParticipantsUiStore } from '../participants-ui.store';
import { useScreenUiStore } from '../screen-ui.store';
import ParticipantContextMenu from './ParticipantContextMenu.vue';
import ParticipantList from './ParticipantList.vue';
import StreamTiles from './StreamTiles.vue';

const participantsUi = useParticipantsUiStore();
const screenUi = useScreenUiStore();

const participantCount = computed(() => participantsUi.getParticipantCount());
const streamCount = computed(() => {
  // Streams change in place, which only the revision announces; it never is negative.
  if (screenUi.revision < 0) return 0;
  return getScreenParticipants().filter((participant) => participant.id !== roomState.viewedScreenPeerId).length;
});
const totalCount = computed(() => participantCount.value + streamCount.value);
const focusedParticipant = computed(() => participantsUi.getFocusedParticipant());
const screenFocused = computed(() => screenUi.stageVisible);
const stripParticipants = computed(() =>
  participantsUi.getSortedParticipants().filter((participant) => participant.id !== focusedParticipant.value?.id)
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
  <div id="stageStrip" class="stage-strip" aria-label="Плитки комнаты">
    <div class="stage-strip__bar" hidden>
      <div class="stage-strip__title">
        <span id="stageStripKicker" class="stage-strip__kicker">В комнате</span>
        <strong id="stageStripSummary" class="stage-strip__summary">0 участников</strong>
      </div>
      <button
        id="stripToggleButton"
        class="stage-strip__toggle"
        type="button"
        aria-label="Свернуть пользователей"
        aria-pressed="false"
        hidden
      >
        <ChevronDown aria-hidden="true" />
      </button>
    </div>

    <div v-if="focusedParticipant" class="participant-focus">
      <div class="participant-focus__stage">
        <ParticipantList :participants="[focusedParticipant]" variant="grid" />
      </div>
      <div class="participant-carousel">
        <button
          :class="['participant-carousel__nav', { 'participant-carousel__nav--hidden': !canScrollLeft }]"
          type="button"
          aria-label="Предыдущие участники"
          :tabindex="canScrollLeft ? 0 : -1"
          @click="moveCarousel(-1)"
        >
          <ChevronLeft :size="18" />
        </button>
        <div ref="carousel" class="participant-carousel__viewport" @scroll="updateCarouselNav">
          <div class="participant-carousel__strip">
            <StreamTiles />
            <ParticipantList :participants="stripParticipants" variant="strip" />
          </div>
        </div>
        <button
          :class="['participant-carousel__nav', { 'participant-carousel__nav--hidden': !canScrollRight }]"
          type="button"
          aria-label="Следующие участники"
          :tabindex="canScrollRight ? 0 : -1"
          @click="moveCarousel(1)"
        >
          <ChevronRight :size="18" />
        </button>
      </div>
    </div>
    <!-- The focused stream itself is the sibling ScreenStage; the strip row
         below carries everyone else in the same spotlight carousel. -->
    <div v-else-if="screenFocused" class="participant-carousel">
      <button
        :class="['participant-carousel__nav', { 'participant-carousel__nav--hidden': !canScrollLeft }]"
        type="button"
        aria-label="Предыдущие участники"
        :tabindex="canScrollLeft ? 0 : -1"
        @click="moveCarousel(-1)"
      >
        <ChevronLeft :size="18" />
      </button>
      <div ref="carousel" class="participant-carousel__viewport" @scroll="updateCarouselNav">
        <div class="participant-carousel__strip">
          <StreamTiles />
          <ParticipantList :participants="participantsUi.getSortedParticipants()" variant="strip" />
        </div>
      </div>
      <button
        :class="['participant-carousel__nav', { 'participant-carousel__nav--hidden': !canScrollRight }]"
        type="button"
        aria-label="Следующие участники"
        :tabindex="canScrollRight ? 0 : -1"
        @click="moveCarousel(1)"
      >
        <ChevronRight :size="18" />
      </button>
    </div>
    <div
      v-else
      id="tileGrid"
      ref="grid"
      :class="['tile-grid', { 'tile-grid--scroll': gridScrolls, 'tile-grid--empty': totalCount === 0 }]"
      aria-live="polite"
    >
      <StreamTiles />
      <ParticipantList />
    </div>
  </div>
  <ParticipantContextMenu />
</template>
