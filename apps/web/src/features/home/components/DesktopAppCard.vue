<script setup lang="ts">
// The desktop app: what it adds and one row per build. The build for this
// computer is filled with the accent; a click downloads the latest release,
// or opens the releases page when it cannot be fetched.
import { faApple, faWindows } from '@fortawesome/free-brands-svg-icons';
import { Check, Clapperboard, Copy, Download, Gamepad2, Keyboard, Power } from '@lucide/vue';
import { onMounted, ref } from 'vue';
import { fetchDesktopRelease, type DesktopRelease } from '@/api/desktop';
import {
  DESKTOP_BUILDS,
  QUARANTINE_CMD,
  detectDesktopBuildId,
  formatDesktopReleaseMeta,
  type DesktopBuildId
} from '@/platform/desktop-builds';
import { startDesktopBuildDownload } from '@/platform/desktop-download';
import { MascotIcon } from '@/shared/ui';
import { Icon, iconSm, iconXs } from '@/shared/ui/icons';
import { copyText } from '@/shared/utils/clipboard';

// Embedded, it is a settings tab: no card of its own around it, the perks
// side by side so the whole tab fits without scrolling.
withDefaults(defineProps<{ title?: string; embedded?: boolean }>(), { title: 'VoiceRoom Desktop', embedded: false });

const PERKS = [
  { text: 'Оверлей поверх игры', icon: Gamepad2 },
  { text: 'Стрим со звуком системы', icon: Clapperboard },
  { text: 'Горячие клавиши в свёрнутом окне', icon: Keyboard },
  { text: 'Автозапуск и работа из трея', icon: Power }
];

const release = ref<DesktopRelease | null>(null);
const releaseLoading = ref(true);
const releaseError = ref(false);
const recommendedId = ref<DesktopBuildId>('mac-arm64');
const downloadingId = ref('');
const cmdCopied = ref(false);

onMounted(() => {
  recommendedId.value = detectDesktopBuildId();
  void fetchDesktopRelease()
    .then((value) => (release.value = value))
    .catch(() => (releaseError.value = true))
    .finally(() => (releaseLoading.value = false));
});

function download(buildId: DesktopBuildId): void {
  if (downloadingId.value) return;
  downloadingId.value = buildId;
  startDesktopBuildDownload(release.value, buildId);
  window.setTimeout(() => (downloadingId.value = ''), 1500);
}

async function copyCommand(): Promise<void> {
  try {
    await copyText(QUARANTINE_CMD);
  } catch {
    // Clipboard may be unavailable; still show feedback.
  }
  cmdCopied.value = true;
  window.setTimeout(() => (cmdCopied.value = false), 2000);
}
</script>

<template>
  <section
    :id="embedded ? undefined : 'download'"
    class="desktop-card"
    :class="{ 'desktop-card--embedded': embedded }"
    aria-label="Десктоп-приложение"
  >
    <div class="desktop-card__head">
      <span class="desktop-card__icon"><MascotIcon variant="blink" :size="32" /></span>
      <span class="desktop-card__titles">
        <span class="desktop-card__title">{{ title }}</span>
        <span class="desktop-card__sub">Всё то же, что в браузере, и немного больше</span>
      </span>
    </div>

    <ul class="desktop-card__perks">
      <li v-for="perk in PERKS" :key="perk.text" class="desktop-card__perk">
        <span class="desktop-card__perk-icon"><component :is="perk.icon" :size="14" aria-hidden="true" /></span>
        {{ perk.text }}
      </li>
    </ul>

    <div class="desktop-card__builds">
      <button
        v-for="build in DESKTOP_BUILDS"
        :key="build.id"
        class="desktop-card__build"
        :class="{ 'desktop-card__build--recommended': build.id === recommendedId }"
        type="button"
        :disabled="downloadingId === build.id"
        @click="download(build.id)"
      >
        <span class="desktop-card__build-icon">
          <Icon :icon="build.mac ? faApple : faWindows" size="sm" />
        </span>
        <span class="desktop-card__build-copy">
          <span class="desktop-card__build-name">{{ build.label }}</span>
          <span class="desktop-card__build-meta">{{
            formatDesktopReleaseMeta(build, release?.assets?.[build.id], release, releaseLoading, releaseError)
          }}</span>
        </span>
        <Check v-if="downloadingId === build.id" v-bind="iconSm" aria-hidden="true" />
        <Download v-else v-bind="iconSm" aria-hidden="true" />
      </button>
    </div>

    <div class="desktop-card__note">
      <p>
        Приложение не подписано. В macOS после установки выполните в Терминале, в Windows — «Подробнее» → «Выполнить в
        любом случае».
      </p>
      <div class="desktop-card__cmd">
        <code>{{ QUARANTINE_CMD }}</code>
        <button type="button" @click="copyCommand">
          <Check v-if="cmdCopied" v-bind="iconXs" aria-hidden="true" />
          <Copy v-else v-bind="iconXs" aria-hidden="true" />
          {{ cmdCopied ? 'Скопировано' : 'Копировать' }}
        </button>
      </div>
    </div>
  </section>
</template>
