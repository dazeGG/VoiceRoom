<script setup lang="ts">
// Everyone at once, filling the screen: rows of equal height, the tiles of a
// row sharing its width. With no camera on the tiles keep the room stage's
// 16:9 shape instead. Past nine people the grid pages sideways.
import { computed, ref } from 'vue';
import type { Participant } from '@/features/room/client/core/types';
import { useMobileCallUiStore } from '@/features/room/mobile-call-ui.store';
import MobileCallTile from './MobileCallTile.vue';
import MobileCameraFlip from './MobileCameraFlip.vue';

const props = withDefaults(defineProps<{ pages: Participant[][][]; voiceOnly?: boolean }>(), { voiceOnly: false });

const mobileCall = useMobileCallUiStore();

const scroller = ref<HTMLElement>();
const page = ref(0);
const currentPage = computed(() => Math.min(page.value, props.pages.length - 1));
const alone = computed(() => props.pages.flat(2).length < 2);
const lonelySelf = computed(() => {
  const first = props.pages[0]?.[0]?.[0];
  return alone.value && first?.isLocal ? first : null;
});

function syncPage(): void {
  if (!scroller.value?.clientWidth) return;
  page.value = Math.round(scroller.value.scrollLeft / scroller.value.clientWidth);
}

function goToPage(index: number): void {
  scroller.value?.scrollTo({ left: index * scroller.value.clientWidth, behavior: 'smooth' });
}

/** Tiles in reading order, each spanning its share of the six columns. */
function cells(rows: Participant[][]): Array<{ participant: Participant; span: number }> {
  return rows.flatMap((row) => row.map((participant) => ({ participant, span: 6 / row.length })));
}

// My own camera tile puts me in focus to see my camera big (alone, there is
// nothing to focus between); any other tile shows or hides the controls.
function tapTile(participant: Participant): void {
  if (participant.isLocal && participant.camera && !alone.value) mobileCall.pinInFocus(participant.id);
  else mobileCall.toggleChrome();
}
</script>

<template>
  <div
    :class="[
      'mobile-call-grid',
      { 'mobile-call-grid--paged': pages.length > 1, 'mobile-call-grid--voice-only': voiceOnly }
    ]"
  >
    <div ref="scroller" class="mobile-call-grid__pages" @scroll="syncPage">
      <div
        v-for="(rows, index) in pages"
        :key="index"
        class="mobile-call-grid__page"
        role="group"
        :aria-label="`Страница ${index + 1}`"
        :style="{ gridTemplateRows: `repeat(${rows.length}, ${voiceOnly ? 'auto' : 'minmax(0, 1fr)'})` }"
      >
        <!-- One flat list keyed by person: moving to another row keeps the tile and its video. -->
        <div
          v-for="{ participant, span } in cells(rows)"
          :key="participant.id"
          class="mobile-call-grid__cell"
          :style="{ gridColumn: `span ${span}` }"
        >
          <MobileCallTile :participant="participant" @tap="tapTile(participant)" />
        </div>
      </div>
    </div>
    <!-- Alone there is no focus to open, so the camera switch sits on my tile. -->
    <div v-if="lonelySelf?.cameraStream" class="mobile-call-grid__flip" :inert="!mobileCall.chromeVisible">
      <MobileCameraFlip />
    </div>
    <div
      v-if="pages.length > 1"
      class="mobile-call-grid__dots"
      role="group"
      aria-label="Страницы"
      :inert="!mobileCall.chromeVisible"
    >
      <button
        v-for="(_, index) in pages"
        :key="index"
        type="button"
        class="mobile-call-grid__dot"
        :aria-label="`Страница ${index + 1}`"
        :aria-current="index === currentPage ? 'page' : undefined"
        @click="goToPage(index)"
      ></button>
    </div>
  </div>
</template>
