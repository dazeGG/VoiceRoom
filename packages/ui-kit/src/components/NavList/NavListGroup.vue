<script setup lang="ts">
import { useId } from 'vue';
import type { NavListGroupProps } from './types';

defineProps<NavListGroupProps>();
const id = useId();
</script>

<template>
  <div class="ui-nav__group" :role="label ? 'group' : undefined" :aria-labelledby="label ? id : undefined">
    <p v-if="label" :id="id" class="ui-nav__label">{{ label }}</p>
    <slot />
  </div>
</template>
