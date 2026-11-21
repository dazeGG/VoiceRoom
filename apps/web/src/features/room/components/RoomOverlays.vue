<script setup lang="ts">
import {
  SegmentControl,
  RadioGroup,
  Separator,
  IconButton,
  Button,
  Dialog,
  Field,
  Switch,
  TextField,
  RadioGroupItem,
  Popover
} from '@voice-room/ui/components';
import { t } from '@/shared/i18n';
import { AppWindow, Check, Monitor, Play, Settings } from '@lucide/vue';
import { computed } from 'vue';
import { createLogger, errorContext } from '@/shared/log';
import { iconSm, iconXs } from '@voice-room/ui/icon-defaults';
import {
  cancelScreenSourcePicker,
  confirmScreenSourcePicker,
  switchScreenTab
} from '@voice-room/call/engine/ui/screen-source-picker';
import { unlockAudio } from '@voice-room/call/engine/services/media-playback-service';
import { clearGuestNameError, handleGuestNameSubmit } from '@voice-room/call/engine/ui/names';
import { useGuestNameUiStore } from '@voice-room/call/engine/core/guest-name-ui.store';
import { useScreenSourceUiStore } from '@voice-room/call/engine/core/screen-source-ui.store';
import { useStartUiStore } from '@voice-room/call/engine/core/start-ui.store';

const fpsOptions = computed(() => [
  { value: '30', label: '30' },
  { value: '60', label: '60', description: t('60 к/с: плавнее, но вдвое больше нагрузки на кодирование и сеть') }
]);

function selectFps(value: string): void {
  if (value === '30' || value === '60') screenSourceUi.fps = value;
}

const log = createLogger('room:overlays');

const guestNameUi = useGuestNameUiStore();
const screenSourceUi = useScreenSourceUiStore();
const startUi = useStartUiStore();

const hasScreenSources = computed(() => screenSourceUi.sources.some((s) => s.type === 'screen'));
const hasWindowSources = computed(() => screenSourceUi.sources.some((s) => s.type !== 'screen'));
const screenTabs = computed(() => [
  { value: 'screens', label: t('Экраны') },
  { value: 'windows', label: t('Окна') }
]);
const qualityOptions = [
  { value: 'balanced', label: 'SD' },
  { value: 'high', label: 'HD' }
];
const modes = computed(() => [
  { value: 'games', label: t('Плавное видео'), description: t('30–60 к/с · для игр и видео') },
  { value: 'text', label: t('Чёткая картинка'), description: t('5 к/с · для текста и кода') }
]);
const showTabs = computed(() => hasScreenSources.value && hasWindowSources.value);
const filteredSources = computed(() =>
  screenSourceUi.sources.filter((s) => (screenSourceUi.tab === 'screens' ? s.type === 'screen' : s.type !== 'screen'))
);
const selectedSource = computed(() => screenSourceUi.sources.find((s) => s.id === screenSourceUi.selectedSourceId));
const qualityLabel = computed(() =>
  screenSourceUi.mode === 'text' ? t('Источник') : screenSourceUi.quality === 'high' ? '1080p' : '720p'
);
const fpsLabel = computed(() =>
  screenSourceUi.mode === 'text' ? t('5 к/с') : t('{p0} к/с', { p0: screenSourceUi.fps })
);
const summaryName = computed(() => selectedSource.value?.name ?? t('Не выбрано'));
const summaryDetail = computed(
  () =>
    `${screenSourceUi.mode === 'text' ? t('Текст') : screenSourceUi.quality === 'high' ? 'HD' : 'SD'} · ${qualityLabel.value} · ${fpsLabel.value}${screenSourceUi.audio ? t(' · звук') : ''}`
);

function selectSource(value: string | null): void {
  if (value !== null) screenSourceUi.selectedSourceId = value;
}

function selectScreenTab(value: string): void {
  if (value === 'screens' || value === 'windows') switchScreenTab(value);
}

function selectQuality(value: string): void {
  if (value === 'balanced' || value === 'high') screenSourceUi.quality = value;
}

function selectMode(value: string | null): void {
  if (value === 'games' || value === 'text') screenSourceUi.mode = value;
}

function keepGuestNameOpen(): void {
  document.getElementById('guestNameInput')?.focus();
}
</script>

<template>
  <Dialog
    :open="guestNameUi.open"
    size="sm"
    :title="t('Как вас зовут?')"
    :description="t('Имя будет видно участникам этой голосовой комнаты.')"
    initial-focus="#guestNameInput"
    :closable="false"
    :on-close="keepGuestNameOpen"
  >
    <p class="eyebrow guest-name-dialog__eyebrow">{{ t('Вход в комнату') }}</p>

    <form id="guestNameForm" class="guest-name-dialog__form" @submit="handleGuestNameSubmit">
      <Field id="guestNameInput" :label="t('Ваше имя')">
        <TextField
          v-model="guestNameUi.inputValue"
          size="lg"
          maxlength="40"
          autocomplete="name"
          :placeholder="t('Ваше имя')"
          :aria-invalid="Boolean(guestNameUi.error) || undefined"
          :aria-describedby="guestNameUi.error ? 'guestNameError' : undefined"
          @input="clearGuestNameError"
        />
      </Field>
      <p id="guestNameError" class="guest-name-dialog__error" role="alert" aria-live="polite">
        {{ guestNameUi.error }}
      </p>
      <Button id="guestNameSubmitButton" variant="primary" size="lg" type="submit">
        {{ t('Войти в комнату') }}
      </Button>
      <!-- Information, not consent: a call needs no consent (152-FZ art. 6 part 1 item 5). -->
      <p class="guest-name-dialog__legal">
        {{ t('Входя в комнату, вы принимаете') }}
        <a href="/terms" target="_blank" rel="noopener">{{ t('Пользовательское соглашение') }}</a
        >{{ t('. Какие данные мы храним и сколько — в') }}
        <a href="/privacy" target="_blank" rel="noopener">{{ t('Политике обработки персональных данных') }}</a
        >.
      </p>
    </form>
  </Dialog>

  <Dialog
    :open="screenSourceUi.open"
    overflow-visible
    size="lg"
    :title="t('Выберите, что показать')"
    :on-close="cancelScreenSourcePicker"
  >
    <!-- Tabs -->
    <SegmentControl
      v-if="showTabs"
      class="screen-source-dialog__tabs"
      :value="screenSourceUi.tab"
      :options="screenTabs"
      v-bind="{ ariaLabel: t('Выберите, что показать') }"
      size="sm"
      @change="selectScreenTab"
    />

    <!-- Source grid -->
    <RadioGroup
      id="screenSourceOptions"
      class="screen-source-dialog__options"
      :aria-label="t('Выберите, что показать')"
      :model-value="screenSourceUi.selectedSourceId"
      @update:model-value="selectSource"
    >
      <template #item>
        <RadioGroupItem
          v-for="source in filteredSources"
          :key="source.id"
          variant="tile"
          :option="{ value: source.id, label: source.name }"
        >
          <span class="screen-source-dialog__preview">
            <img v-if="source.thumbnail" alt="" :src="source.thumbnail" />
            <span v-else class="screen-source-dialog__placeholder" aria-hidden="true">
              <span class="screen-source-dialog__placeholder-bar"></span>
              <span class="screen-source-dialog__placeholder-left"></span>
              <span class="screen-source-dialog__placeholder-right"></span>
            </span>
            <span
              v-if="source.id === screenSourceUi.selectedSourceId"
              class="screen-source-dialog__check"
              aria-hidden="true"
            >
              <Check v-bind="iconXs" color="var(--vr-accent-ink)" aria-hidden="true" />
            </span>
          </span>
          <span class="screen-source-dialog__label">
            <img v-if="source.appIcon" alt="" :src="source.appIcon" />
            <Monitor v-else-if="source.type === 'screen'" v-bind="iconSm" aria-hidden="true" />
            <AppWindow v-else v-bind="iconSm" aria-hidden="true" />
            <span>{{ source.name }}</span>
          </span>
        </RadioGroupItem>
      </template>
    </RadioGroup>

    <template #footer>
      <div class="screen-source-dialog__footer">
        <div class="screen-source-dialog__summary">
          <span class="screen-source-dialog__summary-icon" aria-hidden="true">
            <Monitor v-bind="iconSm" aria-hidden="true" />
          </span>
          <div class="screen-source-dialog__summary-text">
            <div class="screen-source-dialog__summary-name">{{ summaryName }}</div>
            <div class="screen-source-dialog__summary-detail">{{ summaryDetail }}</div>
          </div>
        </div>

        <div class="screen-source-dialog__footer-actions">
          <!-- SD / HD toggle -->
          <template v-if="screenSourceUi.mode === 'games'">
            <SegmentControl
              :value="screenSourceUi.quality"
              :options="qualityOptions"
              v-bind="{ ariaLabel: t('Качество') }"
              size="sm"
              @change="selectQuality"
            />
            <SegmentControl
              :value="screenSourceUi.fps"
              :options="fpsOptions"
              v-bind="{ ariaLabel: t('Частота кадров') }"
              size="sm"
              @change="selectFps"
            />
          </template>

          <!-- Settings gear + popover -->
          <Popover
            v-model:open="screenSourceUi.popOpen"
            role="dialog"
            placement="top-end"
            :aria-label="t('Настройки стрима')"
          >
            <template #trigger="{ open, toggle, panelId }">
              <IconButton
                :aria-expanded="open"
                :aria-controls="panelId"
                :label="t('Настройки стрима')"
                :size="40"
                variant="outline"
                @click="toggle"
              >
                <Settings aria-hidden="true" />
              </IconButton>
            </template>
            <template #content>
              <RadioGroup
                :model-value="screenSourceUi.mode"
                :options="modes"
                :aria-label="t('Режим стрима')"
                @update:model-value="selectMode"
              />
              <Separator decorative />
              <label class="screen-source-dialog__audio">
                <span class="screen-source-dialog__audio-label">{{ t('Звук стрима') }}</span>
                <Switch v-model="screenSourceUi.audio" size="sm" v-bind="{ ariaLabel: t('Звук стрима') }" />
              </label>
            </template>
          </Popover>

          <!-- Launch -->
          <Button
            variant="primary"
            size="sm"
            class="screen-source-dialog__launch"
            :disabled="!screenSourceUi.selectedSourceId"
            @click="confirmScreenSourcePicker"
          >
            <template #icon><Play v-bind="iconSm" fill="currentColor" aria-hidden="true" /></template>
            {{ t('Запустить') }}
          </Button>
        </div>
      </div>
    </template>
  </Dialog>

  <Button
    id="soundButton"
    variant="ghost"
    size="xl"
    pill
    class="sound-button"
    :hidden="!startUi.soundButtonVisible"
    @click="unlockAudio().catch((error: unknown) => log.warn('audio unlock failed', errorContext(error)))"
  >
    {{ t('Разрешить звук') }}
  </Button>
</template>
