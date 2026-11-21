<script setup lang="ts">
import { Button, Dialog, Field, Switch, TextField } from '@voice-room/ui/components';
import { t } from '@/shared/i18n';
import { AppWindow, Check, Monitor, Play, Settings, Type } from '@lucide/vue';
import { computed } from 'vue';
import { createLogger, errorContext } from '@/shared/log';
import { iconMd, iconSm, iconXs } from '@/shared/ui/icons';
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

const log = createLogger('room:overlays');

const guestNameUi = useGuestNameUiStore();
const screenSourceUi = useScreenSourceUiStore();
const startUi = useStartUiStore();

const hasScreenSources = computed(() => screenSourceUi.sources.some((s) => s.type === 'screen'));
const hasWindowSources = computed(() => screenSourceUi.sources.some((s) => s.type !== 'screen'));
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
    size="lg"
    :title="t('Выберите, что показать')"
    :on-close="cancelScreenSourcePicker"
  >
    <!-- Tabs -->
    <div v-if="showTabs" class="screen-source-dialog__tabs">
      <button
        class="screen-source-dialog__tab"
        :aria-pressed="screenSourceUi.tab === 'screens'"
        @click="switchScreenTab('screens')"
      >
        <Monitor v-bind="iconSm" aria-hidden="true" /> {{ t('Экраны') }}
      </button>
      <button
        class="screen-source-dialog__tab"
        :aria-pressed="screenSourceUi.tab === 'windows'"
        @click="switchScreenTab('windows')"
      >
        <AppWindow v-bind="iconSm" aria-hidden="true" /> {{ t('Окна') }}
      </button>
    </div>

    <!-- Source grid -->
    <div id="screenSourceOptions" class="screen-source-dialog__options">
      <button
        v-for="source in filteredSources"
        :key="source.id"
        class="screen-source-dialog__option"
        type="button"
        :aria-pressed="source.id === screenSourceUi.selectedSourceId"
        :aria-label="source.name"
        @click="screenSourceUi.selectedSourceId = source.id"
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
      </button>
    </div>

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
            <div class="screen-source-dialog__toggle-group" role="group" :aria-label="t('Качество')">
              <button
                class="screen-source-dialog__toggle-button"
                :aria-pressed="screenSourceUi.quality === 'balanced'"
                @click="screenSourceUi.quality = 'balanced'"
              >
                SD
              </button>
              <button
                class="screen-source-dialog__toggle-button"
                :aria-pressed="screenSourceUi.quality === 'high'"
                @click="screenSourceUi.quality = 'high'"
              >
                HD
              </button>
            </div>
            <div class="screen-source-dialog__toggle-group" role="group" :aria-label="t('Частота кадров')">
              <button
                class="screen-source-dialog__toggle-button"
                :aria-pressed="screenSourceUi.fps === '30'"
                @click="screenSourceUi.fps = '30'"
              >
                30
              </button>
              <button
                class="screen-source-dialog__toggle-button"
                :aria-pressed="screenSourceUi.fps === '60'"
                :title="t('60 к/с: плавнее, но вдвое больше нагрузки на кодирование и сеть')"
                @click="screenSourceUi.fps = '60'"
              >
                60
              </button>
            </div>
          </template>

          <!-- Settings gear + popover -->
          <div class="screen-source-dialog__gear-wrap">
            <button
              class="screen-source-dialog__gear"
              :aria-pressed="screenSourceUi.popOpen"
              :title="t('Настройки стрима')"
              @click="screenSourceUi.popOpen = !screenSourceUi.popOpen"
            >
              <Settings v-bind="iconMd" aria-hidden="true" />
            </button>

            <div
              v-if="screenSourceUi.popOpen"
              class="screen-source-dialog__popover"
              role="dialog"
              :aria-label="t('Настройки стрима')"
            >
              <div class="screen-source-dialog__popover-label">{{ t('Режим стрима') }}</div>
              <div class="screen-source-dialog__presets">
                <button
                  class="screen-source-dialog__preset"
                  :aria-pressed="screenSourceUi.mode === 'games'"
                  @click="screenSourceUi.mode = 'games'"
                >
                  <span class="screen-source-dialog__preset-icon">
                    <Play v-bind="iconSm" aria-hidden="true" />
                  </span>
                  <span class="screen-source-dialog__preset-info">
                    <span class="screen-source-dialog__preset-title">{{ t('Плавное видео') }}</span>
                    <span class="screen-source-dialog__preset-desc">{{ t('30–60 к/с · для игр и видео') }}</span>
                  </span>
                  <span class="screen-source-dialog__preset-radio" aria-hidden="true">
                    <span v-if="screenSourceUi.mode === 'games'" class="screen-source-dialog__preset-dot"></span>
                  </span>
                </button>
                <button
                  class="screen-source-dialog__preset"
                  :aria-pressed="screenSourceUi.mode === 'text'"
                  @click="screenSourceUi.mode = 'text'"
                >
                  <span class="screen-source-dialog__preset-icon">
                    <Type v-bind="iconSm" aria-hidden="true" />
                  </span>
                  <span class="screen-source-dialog__preset-info">
                    <span class="screen-source-dialog__preset-title">{{ t('Чёткая картинка') }}</span>
                    <span class="screen-source-dialog__preset-desc">{{ t('5 к/с · для текста и кода') }}</span>
                  </span>
                  <span class="screen-source-dialog__preset-radio" aria-hidden="true">
                    <span v-if="screenSourceUi.mode === 'text'" class="screen-source-dialog__preset-dot"></span>
                  </span>
                </button>
              </div>
              <div class="screen-source-dialog__popover-sep"></div>
              <label class="screen-source-dialog__audio">
                <span class="screen-source-dialog__audio-label">{{ t('Звук стрима') }}</span>
                <Switch v-model="screenSourceUi.audio" size="sm" v-bind="{ ariaLabel: t('Звук стрима') }" />
              </label>
            </div>
          </div>

          <!-- Launch -->
          <button
            class="screen-source-dialog__launch"
            type="button"
            :disabled="!screenSourceUi.selectedSourceId"
            @click="confirmScreenSourcePicker"
          >
            <Play v-bind="iconSm" fill="currentColor" aria-hidden="true" /> {{ t('Запустить') }}
          </button>
        </div>
      </div>
    </template>
  </Dialog>

  <button
    id="soundButton"
    class="sound-button"
    type="button"
    :hidden="!startUi.soundButtonVisible"
    @click="unlockAudio().catch((error: unknown) => log.warn('audio unlock failed', errorContext(error)))"
  >
    {{ t('Разрешить звук') }}
  </button>
</template>
