<script setup lang="ts">
// One person big and everyone else in a strip below, me first on its left.
import { PinOff } from '@lucide/vue';
import { computed } from 'vue';
import type { Participant } from '@/features/room/client/core/types';
import { STRIP_FITTING_TILES } from '@/features/room/mobile-call-layout';
import { useMobileCallUiStore } from '@/features/room/mobile-call-ui.store';
import MobileCallTile from './MobileCallTile.vue';
import MobileCameraFlip from './MobileCameraFlip.vue';

const props = defineProps<{ big: Participant; self: Participant | null; strip: Participant[] }>();

const mobileCall = useMobileCallUiStore();

const pinned = computed(() => mobileCall.pinnedId === props.big.id);
const fits = computed(() => props.strip.length + (props.self ? 1 : 0) <= STRIP_FITTING_TILES);
</script>

<template>
  <div class="mobile-call-focus">
    <div class="mobile-call-focus__big">
      <MobileCallTile :participant="big" variant="focus" @tap="mobileCall.toggleChrome" />
      <div v-if="pinned" class="mobile-call-focus__pin-controls" :inert="!mobileCall.chromeVisible">
        <MobileCameraFlip v-if="big.isLocal && big.cameraStream" />
        <button class="mobile-call-focus__unpin" type="button" @click="mobileCall.unpin">
          <PinOff :size="20" aria-hidden="true" />
          <span>Открепить</span>
        </button>
      </div>
    </div>
    <div
      :class="['mobile-call-focus__strip', { 'mobile-call-focus__strip--fits': fits }]"
      :style="{ '--strip-others': strip.length }"
    >
      <template v-if="self">
        <div class="mobile-call-focus__strip-self">
          <MobileCallTile :participant="self" variant="strip" @tap="mobileCall.pinInFocus(self.id)" />
        </div>
        <span class="mobile-call-focus__strip-divider" aria-hidden="true"></span>
      </template>
      <div class="mobile-call-focus__strip-scroller">
        <div v-for="participant in strip" :key="participant.id" class="mobile-call-focus__strip-item">
          <MobileCallTile :participant="participant" variant="strip" @tap="mobileCall.pinInFocus(participant.id)" />
        </div>
      </div>
    </div>
  </div>
</template>
