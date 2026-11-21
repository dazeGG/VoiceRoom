<script setup lang="ts">
import { IconButton, Spinner, DropdownMenu, MenuItem, MenuLabel, BrandIcon } from '@voiceroom/ui-kit/components';
import { t } from '@/shared/i18n';
import { faApple, faWindows } from '@fortawesome/free-brands-svg-icons';
import { Download } from '@lucide/vue';
import { ref } from 'vue';
import { fetchDesktopRelease, type DesktopRelease } from '@/api/desktop';
import { DESKTOP_BUILDS, type DesktopBuildId } from '@/platform/desktop-builds';
import { startDesktopBuildDownload } from '@/platform/desktop-download';

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
  <DropdownMenu side="top" :aria-label="t('Скачать приложение')">
    <template #trigger>
      <IconButton class="sidebar-download" :label="t('Скачать приложение')" :size="32">
        <Download aria-hidden="true" />
      </IconButton>
    </template>

    <template #content="{ close }">
      <MenuLabel :text="t('Скачать приложение')" />
      <MenuItem
        v-for="build in DESKTOP_BUILDS"
        :key="build.id"
        :label="build.label"
        :disabled="Boolean(downloadingId) && downloadingId !== build.id"
        @select.prevent="download(build.id, close)"
      >
        <template #icon>
          <Spinner v-if="downloadingId === build.id" aria-hidden="true" />
          <BrandIcon v-else :icon="build.mac ? faApple : faWindows" size="lg" />
        </template>
      </MenuItem>
      <div v-if="releaseError" class="sidebar-download__note">
        {{ t('Не удалось получить релиз — откроем страницу загрузок.') }}
      </div>
    </template>
  </DropdownMenu>
</template>
