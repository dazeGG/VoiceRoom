<script setup lang="ts">
import { useId } from 'vue';

import type { MascotIconProps } from './types';

withDefaults(defineProps<MascotIconProps>(), { variant: 'blink', size: 44 });

const uid = useId();
const maskId = `mascot-band-${uid}`;
const headPath = 'M20 38 L20 10 L41 29 L59 29 L80 10 L80 38 Q85 46 85 56 Q85 86 50 86 Q15 86 15 56 Q15 46 20 38 Z';
</script>

<template>
  <svg
    :class="['mascot-icon', `mascot-icon--${variant}`]"
    viewBox="0 0 100 100"
    :width="size"
    :height="size"
    aria-hidden="true"
  >
    <defs>
      <mask :id="maskId">
        <rect width="100" height="100" fill="white" />
        <rect x="10" y="44" width="80" height="22" fill="black" />
      </mask>
    </defs>

    <g v-if="variant === 'scare'" class="mascot-icon__scare">
      <path class="mascot-icon__head" :mask="`url(#${maskId})`" :d="headPath" />
      <g class="mascot-icon__eyes-fade">
        <circle cx="38" cy="55" r="6.5" class="mascot-icon__eye" />
        <circle cx="62" cy="55" r="6.5" class="mascot-icon__eye" />
      </g>
      <g class="mascot-icon__x-fade">
        <path d="M32.5 49.5 L43.5 60.5 M43.5 49.5 L32.5 60.5" />
        <path d="M56.5 49.5 L67.5 60.5 M67.5 49.5 L56.5 60.5" />
      </g>
    </g>
    <template v-else>
      <path class="mascot-icon__head" :mask="`url(#${maskId})`" :d="headPath" />
      <g class="mascot-icon__eyes">
        <circle cx="38" cy="55" r="6.5" class="mascot-icon__eye" />
        <circle cx="62" cy="55" r="6.5" class="mascot-icon__eye" />
      </g>
    </template>
  </svg>
</template>
