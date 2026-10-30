<script setup lang="ts">
defineProps<{ items: { title: string; desc: string }[] }>();
</script>

<template>
  <ul class="feature-list">
    <li v-for="(item, i) in items" :key="i" class="feature-list__item">
      <span class="feature-list__num">{{ String(i + 1).padStart(2, '0') }}</span>
      <div class="feature-list__body">
        <p class="feature-list__title">{{ item.title }}</p>
        <p class="feature-list__desc">{{ item.desc }}</p>
      </div>
    </li>
  </ul>
</template>
