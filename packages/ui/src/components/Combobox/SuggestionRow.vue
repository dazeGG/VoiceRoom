<script setup lang="ts">
defineProps<{ label: string; description?: string | undefined }>();
</script>

<template>
  <span v-if="$slots.avatar" class="ui-combobox__avatar" aria-hidden="true"><slot name="avatar" /></span>
  {{ ' ' }}
  <span class="ui-menu__text">
    <slot>{{ label }}</slot>
    {{ ' ' }}
    <small v-if="description" class="ui-menu__description">{{ description }}</small>
  </span>
</template>
