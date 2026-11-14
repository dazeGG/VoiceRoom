<script setup lang="ts">
import { t } from '@/shared/i18n';
import { onMounted, ref } from 'vue';
import { createDesktopDownload } from '@/platform/desktop-download';
import { Button, Dialog } from '@/shared/ui';

defineProps<{ open: boolean }>();

/** Emitted on close and after the download starts. */
const emit = defineEmits<{ close: [] }>();

const BENEFITS = [
  {
    get title() {
      return t('Оверлей поверх игр');
    },
    get text() {
      return t('Видно, кто говорит, не сворачивая игру.');
    }
  },
  {
    get title() {
      return t('Горячие клавиши и Push-to-talk');
    },
    get text() {
      return t('Микрофон и звук с клавиатуры, даже когда окно не в фокусе.');
    }
  },
  {
    get title() {
      return t('Запуск вместе с системой');
    },
    get text() {
      return t('Приложение уже открыто, когда друзья зовут в комнату.');
    }
  },
  {
    get title() {
      return t('Уведомления на рабочем столе');
    },
    get text() {
      return t('Сообщения и звонки не теряются во вкладках браузера.');
    }
  }
];

let startDownload: (() => Promise<void>) | null = null;
const downloading = ref(false);

onMounted(() => {
  startDownload = createDesktopDownload();
});

async function download(): Promise<void> {
  if (downloading.value || !startDownload) return;
  downloading.value = true;
  try {
    await startDownload();
    emit('close');
  } finally {
    downloading.value = false;
  }
}
</script>

<template>
  <Dialog :open="open" :title="t('VoiceRoom на компьютере')" :on-close="() => emit('close')" :width="460">
    <ul class="app-benefits">
      <li v-for="benefit in BENEFITS" :key="benefit.title" class="app-benefits__item">
        <strong class="app-benefits__title">{{ benefit.title }}</strong>
        <span class="app-benefits__text">{{ benefit.text }}</span>
      </li>
    </ul>
    <div class="app-benefits__actions">
      <Button variant="primary" type="button" :disabled="downloading" @click="download">{{
        t('Скачать приложение')
      }}</Button>
      <Button variant="ghost" type="button" @click="emit('close')">{{ t('Не сейчас') }}</Button>
    </div>
  </Dialog>
</template>
