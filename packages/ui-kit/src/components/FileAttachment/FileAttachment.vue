<script setup lang="ts">
import { Download, FileText } from '@lucide/vue';
import { computed } from 'vue';
import { t } from '../../i18n';
import IconButton from '../IconButton/IconButton.vue';

const props = defineProps<{ name: string; bytes: number; url?: string | null | undefined }>();
const caption = computed(() =>
  props.bytes < 1024
    ? t('Диагностика · {size} Б', { size: props.bytes })
    : t('Диагностика · {size} КБ', { size: Math.round(props.bytes / 1024) })
);
</script>

<template>
  <div class="ui-file-attachment">
    <span class="ui-file-attachment__icon" aria-hidden="true"><FileText /></span>
    <span class="ui-file-attachment__text">
      <span class="ui-file-attachment__name" :title="name">{{ name }}</span>
      <span class="ui-file-attachment__caption">{{ caption }}</span>
    </span>
    <IconButton v-if="url" :label="t('Скачать файл')" :href="url" :download="name" :size="32">
      <Download aria-hidden="true" />
    </IconButton>
    <slot name="actions" />
  </div>
</template>
