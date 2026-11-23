<script setup lang="ts">
defineProps<{ label: string }>();
</script>

<template>
  <div class="admin-stats" role="list" :aria-label="label"><slot /></div>
</template>
