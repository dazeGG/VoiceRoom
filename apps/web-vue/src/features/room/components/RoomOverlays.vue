<script setup lang="ts">
import { AppWindow, Check, Monitor, Play, Settings, Type, X } from '@lucide/vue';
import { computed, onBeforeUnmount, ref, watch } from 'vue';
import { createLogger, errorContext } from '@/shared/log';
import { ToastStack } from '@/shared/ui';
import { iconMd, iconSm, iconXs } from '@/shared/ui/icons';
import {
  cancelScreenSourcePicker,
  closeScreenSourceOnBackdrop,
  confirmScreenSourcePicker,
  switchScreenTab
} from '../client/ui/screen-source-picker';
import { unlockAudio } from '../client/services/media-playback-service';
import {
  clearGuestNameError,
  handleGuestNameDialogClick,
  handleGuestNameDialogKeydown,
  handleGuestNameSubmit,
  syncGuestNameDialogInert
} from '../client/ui/names';
import { useGuestNameUiStore } from '../guest-name-ui.store';
import { useScreenSourceUiStore } from '../screen-source-ui.store';
import { useStartUiStore } from '../start-ui.store';
import { useToastUiStore } from '../toast-ui.store';

const log = createLogger('room:overlays');

const guestNameUi = useGuestNameUiStore();
const screenSourceUi = useScreenSourceUiStore();
const startUi = useStartUiStore();
const toastUi = useToastUiStore();

const guestNameDialog = ref<HTMLDivElement | null>(null);
const guestNameInput = ref<HTMLInputElement | null>(null);

const hasScreenSources = computed(() => screenSourceUi.sources.some((s) => s.type === 'screen'));
const hasWindowSources = computed(() => screenSourceUi.sources.some((s) => s.type !== 'screen'));
const showTabs = computed(() => hasScreenSources.value && hasWindowSources.value);
const filteredSources = computed(() =>
  screenSourceUi.sources.filter((s) => (screenSourceUi.tab === 'screens' ? s.type === 'screen' : s.type !== 'screen'))
);
const selectedSource = computed(() => screenSourceUi.sources.find((s) => s.id === screenSourceUi.selectedSourceId));
const qualityLabel = computed(() =>
  screenSourceUi.mode === 'text' ? 'Источник' : screenSourceUi.quality === 'high' ? '1080p' : '720p'
);
const fpsLabel = computed(() => (screenSourceUi.mode === 'text' ? '5 к/с' : `${screenSourceUi.fps} к/с`));
const summaryName = computed(() => selectedSource.value?.name ?? 'Не выбрано');
const summaryDetail = computed(
  () =>
    `${screenSourceUi.mode === 'text' ? 'Текст' : screenSourceUi.quality === 'high' ? 'HD' : 'SD'} · ${qualityLabel.value} · ${fpsLabel.value}${screenSourceUi.audio ? ' · звук' : ''}`
);

watch(
  () => guestNameUi.open,
  (open) => syncGuestNameDialogInert(open, guestNameDialog.value),
  { flush: 'post', immediate: true }
);

onBeforeUnmount(() => syncGuestNameDialogInert(false, guestNameDialog.value));

function onGuestNameKeydown(event: KeyboardEvent): void {
  if (guestNameDialog.value) handleGuestNameDialogKeydown(event, guestNameDialog.value, guestNameInput.value);
}
</script>

<template>
  <ToastStack id="toast" :toasts="toastUi.items" :on-dismiss="toastUi.dismissToastUi" />

  <div
    id="guestNameDialog"
    ref="guestNameDialog"
    class="guest-name-dialog"
    role="dialog"
    aria-modal="true"
    aria-labelledby="guestNameTitle"
    :hidden="!guestNameUi.open"
    tabindex="-1"
    @click="handleGuestNameDialogClick($event, guestNameInput)"
    @keydown="onGuestNameKeydown"
  >
    <section class="guest-name-dialog__panel">
      <div class="guest-name-dialog__heading">
        <p class="eyebrow guest-name-dialog__eyebrow">Вход в комнату</p>
        <h2 id="guestNameTitle">Как вас зовут?</h2>
        <p class="guest-name-dialog__lead">Имя будет видно участникам этой голосовой комнаты.</p>
      </div>

      <form id="guestNameForm" class="guest-name-dialog__form" @submit="handleGuestNameSubmit">
        <label class="guest-name-dialog__field" for="guestNameInput">
          <span>Ваше имя</span>
          <input
            id="guestNameInput"
            ref="guestNameInput"
            v-model="guestNameUi.inputValue"
            class="guest-name-dialog__input"
            maxlength="40"
            autocomplete="name"
            placeholder="Ваше имя"
            @input="clearGuestNameError"
          />
        </label>
        <p id="guestNameError" class="guest-name-dialog__error" role="alert" aria-live="polite">
          {{ guestNameUi.error }}
        </p>
        <button id="guestNameSubmitButton" class="guest-name-dialog__submit" type="submit">Войти в комнату</button>
        <!-- Information, not consent: a call needs no consent (152-FZ art. 6 part 1 item 5). -->
        <p class="guest-name-dialog__legal">
          Входя в комнату, вы принимаете
          <a href="/terms" target="_blank" rel="noopener">Пользовательское соглашение</a>. Какие данные мы храним и
          сколько — в <a href="/privacy" target="_blank" rel="noopener">Политике обработки персональных данных</a>.
        </p>
      </form>
    </section>
  </div>

  <div
    id="screenSourceDialog"
    class="screen-source-dialog"
    role="dialog"
    aria-modal="true"
    aria-labelledby="screenSourceTitle"
    :hidden="!screenSourceUi.open"
    tabindex="-1"
    @pointerdown="closeScreenSourceOnBackdrop"
  >
    <section class="screen-source-dialog__panel">
      <!-- Header -->
      <div class="screen-source-dialog__heading">
        <h2 id="screenSourceTitle">Выберите, что показать</h2>
        <button
          class="screen-source-dialog__close"
          type="button"
          aria-label="Отменить выбор"
          @click="cancelScreenSourcePicker"
        >
          <X v-bind="iconMd" aria-hidden="true" />
        </button>
      </div>

      <!-- Tabs -->
      <div v-if="showTabs" class="screen-source-dialog__tabs">
        <button
          class="screen-source-dialog__tab"
          :aria-pressed="screenSourceUi.tab === 'screens'"
          @click="switchScreenTab('screens')"
        >
          <Monitor v-bind="iconSm" aria-hidden="true" />
          Экраны
        </button>
        <button
          class="screen-source-dialog__tab"
          :aria-pressed="screenSourceUi.tab === 'windows'"
          @click="switchScreenTab('windows')"
        >
          <AppWindow v-bind="iconSm" aria-hidden="true" />
          Окна
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

      <!-- Footer bar -->
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
            <div class="screen-source-dialog__toggle-group" role="group" aria-label="Качество">
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
            <div class="screen-source-dialog__toggle-group" role="group" aria-label="Частота кадров">
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
                title="60 к/с: плавнее, но вдвое больше нагрузки на кодирование и сеть"
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
              title="Настройки стрима"
              @click="screenSourceUi.popOpen = !screenSourceUi.popOpen"
            >
              <Settings v-bind="iconMd" aria-hidden="true" />
            </button>

            <div
              v-if="screenSourceUi.popOpen"
              class="screen-source-dialog__popover"
              role="dialog"
              aria-label="Настройки стрима"
            >
              <div class="screen-source-dialog__popover-label">Режим стрима</div>
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
                    <span class="screen-source-dialog__preset-title">Плавное видео</span>
                    <span class="screen-source-dialog__preset-desc">30–60 к/с · для игр и видео</span>
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
                    <span class="screen-source-dialog__preset-title">Чёткая картинка</span>
                    <span class="screen-source-dialog__preset-desc">5 к/с · для текста и кода</span>
                  </span>
                  <span class="screen-source-dialog__preset-radio" aria-hidden="true">
                    <span v-if="screenSourceUi.mode === 'text'" class="screen-source-dialog__preset-dot"></span>
                  </span>
                </button>
              </div>
              <div class="screen-source-dialog__popover-sep"></div>
              <button
                class="screen-source-dialog__audio"
                role="switch"
                :aria-checked="screenSourceUi.audio"
                @click="screenSourceUi.audio = !screenSourceUi.audio"
              >
                <span class="screen-source-dialog__audio-label">Звук стрима</span>
                <span
                  :class="[
                    'screen-source-dialog__switch',
                    { 'screen-source-dialog__switch--on': screenSourceUi.audio }
                  ]"
                  aria-hidden="true"
                >
                  <span class="screen-source-dialog__switch-knob"></span>
                </span>
              </button>
            </div>
          </div>

          <!-- Launch -->
          <button
            class="screen-source-dialog__launch"
            type="button"
            :disabled="!screenSourceUi.selectedSourceId"
            @click="confirmScreenSourcePicker"
          >
            <Play v-bind="iconSm" fill="currentColor" aria-hidden="true" />
            Запустить
          </button>
        </div>
      </div>
    </section>
  </div>

  <button
    id="soundButton"
    class="sound-button"
    type="button"
    :hidden="!startUi.soundButtonVisible"
    @click="unlockAudio().catch((error: unknown) => log.warn('audio unlock failed', errorContext(error)))"
  >
    Разрешить звук
  </button>
</template>
