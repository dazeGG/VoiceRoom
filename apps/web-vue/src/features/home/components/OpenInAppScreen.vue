<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { createDesktopDownload } from '@/platform/desktop-download';
import { Button } from '@/shared/ui';

const emit = defineEmits<{ retry: []; continue: [] }>();

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
  } finally {
    downloading.value = false;
  }
}
</script>

<template>
  <div class="open-in-app" role="dialog" aria-modal="true" aria-labelledby="openInAppTitle">
    <div class="open-in-app__card">
      <h1 id="openInAppTitle" class="open-in-app__title">Открываем в приложении</h1>
      <p class="open-in-app__text">
        Если VoiceRoom установлен, комната откроется в нём. Разрешите браузеру открыть приложение, если он спросит.
      </p>
      <p class="open-in-app__text">
        Приложения ещё нет? Скачайте его: в нём оверлей поверх игр, горячие клавиши и Push-to-talk.
      </p>
      <div class="open-in-app__actions">
        <Button variant="primary" type="button" :disabled="downloading" @click="download">Скачать приложение</Button>
        <Button variant="ghost" type="button" @click="emit('retry')">Открыть снова</Button>
        <Button variant="ghost" type="button" @click="emit('continue')">Продолжить в браузере</Button>
      </div>
    </div>
  </div>
</template>
