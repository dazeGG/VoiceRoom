<script setup lang="ts">
import { useId } from 'vue';
import Card from '../Card/Card.vue';
import type { SettingsGroupProps } from './types';

defineProps<SettingsGroupProps>();
const id = useId();
</script>

<template>
  <Card :as="heading ? 'section' : 'div'" class="ui-settings-group" :aria-labelledby="heading ? id : undefined">
    <header v-if="heading || description || $slots.actions" class="ui-settings-group__head">
      <div v-if="heading || description" class="ui-settings-group__text">
        <h3 v-if="heading" :id="id" class="ui-settings-group__title">{{ heading }}</h3>
        <p v-if="description" class="ui-settings-group__description">{{ description }}</p>
      </div>
      <slot name="actions" />
    </header>
    <slot />
  </Card>
</template>
