<script setup lang="ts">
import { faApple, faWindows } from '@fortawesome/free-brands-svg-icons';
import { Download } from '@lucide/vue';
import { ref } from 'vue';
import { fetchDesktopRelease, type DesktopRelease } from '@/api/desktop';
import { DESKTOP_BUILDS, type DesktopBuildId } from '@/platform/desktop-builds';
import { startDesktopBuildDownload } from '@/platform/desktop-download';
import { Popover, PopoverMenuItem } from '@/shared/ui';
import { Icon, iconSm } from '@/shared/ui/icons';

const open = ref(false);
const release = ref<DesktopRelease | null>(null);
const releaseLoading = ref(false);
const releaseError = ref(false);
const downloadingId = ref('');

async function ensureRelease(): Promise<DesktopRelease | null> {
  if (release.value) return release.value;
  if (releaseLoading.value) return null;
  releaseLoading.value = true;
  releaseError.value = false;
  try {
    release.value = await fetchDesktopRelease();
    return release.value;
  } catch {
    releaseError.value = true;
    return null;
  } finally {
    releaseLoading.value = false;
  }
}

async function download(buildId: DesktopBuildId, close: () => void): Promise<void> {
  if (downloadingId.value) return;
  downloadingId.value = buildId;
  try {
    startDesktopBuildDownload(release.value ?? (await ensureRelease()), buildId);
  } finally {
    downloadingId.value = '';
    close();
  }
}
</script>

<template>
  <Popover
    v-model:open="open"
    placement="top-end"
    flip
    floating
    role="menu"
    aria-label="Скачать приложение"
    root-class="sidebar-download"
    panel-class="sidebar-download__popover"
  >
    <template #trigger="{ open: isOpen, toggle, panelId }">
      <button
        class="sidebar-download__trigger"
        type="button"
        title="Скачать приложение"
        aria-label="Скачать приложение"
        aria-haspopup="menu"
        :aria-expanded="isOpen"
        :aria-controls="panelId"
        @click="toggle"
      >
        <Download v-bind="iconSm" />
      </button>
    </template>

    <template #content="{ close }">
      <div class="sidebar-download__head">Скачать приложение</div>
      <PopoverMenuItem
        v-for="build in DESKTOP_BUILDS"
        :key="build.id"
        :label="build.label"
        :disabled="Boolean(downloadingId) && downloadingId !== build.id"
        @click="download(build.id, close)"
      >
        <template #icon>
          <span v-if="downloadingId === build.id" class="home-spinner" aria-hidden="true"></span>
          <Icon v-else :icon="build.mac ? faApple : faWindows" size="lg" />
        </template>
      </PopoverMenuItem>
      <div v-if="releaseError" class="sidebar-download__note">
        Не удалось получить релиз — откроем страницу загрузок.
      </div>
    </template>
  </Popover>
</template>
