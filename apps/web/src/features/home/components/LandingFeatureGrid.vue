<script setup lang="ts">
import { Clapperboard, Gamepad2, Link } from '@lucide/vue';

defineProps<{ items: { title: string; desc: string }[] }>();

const icons = [Clapperboard, Gamepad2, Link];
</script>

<template>
  <div class="landing-features">
    <div v-for="(item, i) in items" :key="item.title" class="landing-features__item">
      <span class="landing-features__title">
        <component :is="icons[i] ?? Link" :size="16" aria-hidden="true" />{{ item.title }}
      </span>
      <span class="landing-features__desc">{{ item.desc }}</span>
    </div>
  </div>
</template>
