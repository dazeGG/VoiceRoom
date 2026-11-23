<script setup lang="ts">
import { useId } from 'vue';

defineProps<{ label?: string }>();
const mask = 'vr-band-' + useId();
</script>

<template>
  <svg viewBox="0 0 100 100" :role="label ? 'img' : undefined" :aria-label="label" :aria-hidden="!label || undefined">
    <defs>
      <mask :id="mask" mask-type="alpha">
        <path d="M0 0H100V100H0Z M10 44H90V66H10Z" fill="currentColor" fill-rule="evenodd" />
      </mask>
    </defs>
    <path
      d="M20 38 L20 10 L41 29 L59 29 L80 10 L80 38 Q85 46 85 56 Q85 86 50 86 Q15 86 15 56 Q15 46 20 38 Z"
      fill="currentColor"
      :mask="'url(#' + mask + ')'"
    />
    <circle cx="38" cy="55" r="6.5" fill="currentColor" />
    <circle cx="62" cy="55" r="6.5" fill="currentColor" />
  </svg>
</template>
