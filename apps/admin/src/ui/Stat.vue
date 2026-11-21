<script setup lang="ts">
import type { Tone } from './types.ts';

defineProps<{ label: string; note?: string; tone?: Tone; dot?: Tone }>();
</script>

<template>
  <div class="admin-stat" role="listitem">
    <span class="admin-stat__label">
      <span v-if="dot" class="admin-stat__dot" :class="'admin-tone--' + dot" aria-hidden="true" />{{ label }}
    </span>
    <span class="admin-stat__value" :class="tone && 'admin-tone--' + tone"><slot /></span>
    <span v-if="note || $slots.note" class="admin-stat__note"
      ><slot name="note">{{ note }}</slot></span
    >
  </div>
</template>
