<script setup lang="ts">
import '@/styles/widget/_configurator.scss';
import '@/styles/widget/_shell.scss';
import { computed, reactive, ref } from 'vue';
import { ArrowLeft, Check, Code, Copy, PanelTop, ShieldCheck } from '@lucide/vue';
import { defaultWidgetConfig, parseWidgetConfig, type WidgetConfig } from '@voice-room/shared/contracts/widget';
import { widgetSnippet } from '@/features/widget/snippet';
import WidgetJoinControls from '@/features/widget/WidgetJoinControls.vue';
import { Button } from '@/shared/ui/Button';
import { SegmentControl } from '@/shared/ui/SegmentControl';
import type { SegmentOption } from '@/shared/ui/SegmentControl/types';
import { Switch } from '@/shared/ui/Switch';
import { copyText } from '@/shared/utils/clipboard';

const config = reactive({ ...defaultWidgetConfig });
const copiedCode = ref('');
const failedCode = ref('');
const showValidation = ref(false);
const codeField = ref<HTMLTextAreaElement | null>(null);
const placementOptions: SegmentOption<WidgetConfig['mode']>[] = [
  { value: 'inline', label: 'Внутри страницы' },
  { value: 'floating', label: 'Плавающая панель' }
];
const colors = [
  { key: 'background', label: 'Фон' },
  { key: 'text', label: 'Текст' },
  { key: 'accent', label: 'Акцент' }
] as const;
const result = computed(() => {
  try {
    return { code: widgetSnippet(parseWidgetConfig(config), window.location.origin), error: '' };
  } catch {
    return { code: '', error: 'Проверьте размеры: ширина 280–960 px, высота 320–900 px, скругление 0–24 px.' };
  }
});
const copied = computed(() => result.value.code !== '' && result.value.code === copiedCode.value);
const copyFailed = computed(() => result.value.code !== '' && result.value.code === failedCode.value);
const previewStyle = computed(() => ({
  '--vr-bg': config.background,
  '--vr-text': config.text,
  '--vr-accent': config.accent,
  borderRadius: `${config.radius}px`,
  height: `${config.height}px`,
  minHeight: `${config.height}px`
}));
const sampleStyle = computed(() => ({
  width: `min(${config.width}px, 100%)`,
  ...(config.mode === 'floating'
    ? {
        marginInlineStart: config.corner.endsWith('right') ? 'auto' : '0',
        marginInlineEnd: config.corner.endsWith('left') ? 'auto' : '0',
        marginBlockStart: config.corner.startsWith('bottom') ? 'auto' : '0',
        marginBlockEnd: config.corner.startsWith('top') ? 'auto' : '0'
      }
    : {})
}));
function choosePlacement(value: string) {
  if (value === 'inline' || value === 'floating') config.mode = value;
}
async function copyCode() {
  const code = result.value.code;
  try {
    await copyText(code);
    copiedCode.value = code;
    failedCode.value = '';
  } catch {
    copiedCode.value = '';
    failedCode.value = code;
    codeField.value?.focus();
    codeField.value?.select();
  }
}
</script>

<template>
  <main class="widget-configurator">
    <nav class="widget-configurator__nav" aria-label="Навигация">
      <a href="/app" class="widget-configurator__back"><ArrowLeft :size="16" aria-hidden="true" />VoiceRoom</a>
      <span class="widget-configurator__badge"><ShieldCheck :size="14" aria-hidden="true" />Без аккаунта</span>
    </nav>
    <header class="widget-configurator__header">
      <p class="eyebrow">Голос и видео на вашем сайте</p>
      <h1>Виджет для вашего сайта</h1>
      <p>Настройте VoiceRoom, скопируйте код — и общайтесь, не покидая игру.</p>
    </header>

    <div class="widget-configurator__builder">
      <form
        class="widget-configurator__settings"
        aria-label="Настройки виджета"
        @submit.prevent
        @focusout="showValidation = true"
        @input="showValidation = false"
      >
        <fieldset class="widget-configurator__group">
          <legend>Размещение</legend>
          <SegmentControl
            :value="config.mode"
            :options="placementOptions"
            v-bind="{ ariaLabel: 'Размещение' }"
            @change="choosePlacement"
          />
          <p class="widget-configurator__hint">
            {{
              config.mode === 'inline'
                ? 'Встраивается в выбранное место на странице.'
                : 'Остаётся под рукой в углу сайта. Можно свернуть во время звонка.'
            }}
          </p>
          <div v-if="config.mode === 'floating'" class="widget-configurator__pair">
            <label class="widget-configurator__field"
              >Положение
              <select v-model="config.corner" name="corner">
                <option value="bottom-right">Справа внизу</option>
                <option value="bottom-left">Слева внизу</option>
                <option value="top-right">Справа вверху</option>
                <option value="top-left">Слева вверху</option>
              </select>
            </label>
            <label class="widget-configurator__field"
              >Отступ
              <span class="widget-configurator__number"
                ><input v-model.number="config.offset" name="offset" type="number" min="0" max="48" /><span
                  aria-hidden="true"
                  >px</span
                ></span
              >
            </label>
          </div>
        </fieldset>

        <fieldset class="widget-configurator__group">
          <legend>Оформление</legend>
          <div class="widget-configurator__colors">
            <div v-for="color in colors" :key="color.key" class="widget-configurator__color">
              <label :for="`widget-${color.key}`">{{ color.label }}</label>
              <div class="widget-configurator__color-control">
                <input :id="`widget-${color.key}`" v-model="config[color.key]" :name="color.key" type="color" />
                <span aria-hidden="true">{{ config[color.key] }}</span>
              </div>
            </div>
          </div>
          <div class="widget-configurator__pair">
            <label class="widget-configurator__field"
              >Скругление
              <span class="widget-configurator__number"
                ><input v-model.number="config.radius" name="radius" type="number" min="0" max="24" /><span
                  aria-hidden="true"
                  >px</span
                ></span
              >
            </label>
          </div>
        </fieldset>

        <fieldset class="widget-configurator__group">
          <legend>Размеры</legend>
          <div class="widget-configurator__pair">
            <label class="widget-configurator__field"
              >Ширина
              <span class="widget-configurator__number"
                ><input v-model.number="config.width" name="width" type="number" min="280" max="960" /><span
                  aria-hidden="true"
                  >px</span
                ></span
              >
            </label>
            <label class="widget-configurator__field"
              >Высота
              <span class="widget-configurator__number"
                ><input v-model.number="config.height" name="height" type="number" min="320" max="900" /><span
                  aria-hidden="true"
                  >px</span
                ></span
              >
            </label>
          </div>
          <p class="widget-configurator__hint">На узком экране виджет подстроится под ширину сайта.</p>
        </fieldset>

        <fieldset class="widget-configurator__group">
          <legend>Возможности</legend>
          <div class="widget-configurator__toggle">
            <div>
              <label for="widget-chat">Текстовый чат</label>
              <p id="widget-chat-help" class="widget-configurator__hint">Сообщения рядом с голосом и видео.</p>
            </div>
            <Switch
              id="widget-chat"
              v-model="config.chat"
              v-bind="{ ariaLabel: 'Текстовый чат' }"
              aria-describedby="widget-chat-help"
            />
          </div>
          <p class="widget-configurator__hint">
            Правила чата задаются при создании комнаты. При входе по коду сохраняются правила этой комнаты.
          </p>
        </fieldset>
      </form>

      <section class="widget-configurator__preview" aria-label="Предпросмотр">
        <div class="widget-configurator__preview-head">
          <div>
            <PanelTop :size="18" aria-hidden="true" />
            <h2>Так увидят ваши игроки</h2>
          </div>
          <span>{{ config.width }} × {{ config.height }}</span>
        </div>
        <div
          class="widget-configurator__canvas"
          :class="{ 'widget-configurator__canvas--floating': config.mode === 'floating' }"
          :style="{ padding: config.mode === 'floating' ? `${config.offset}px` : undefined }"
        >
          <div class="widget-configurator__sample" :style="sampleStyle">
            <div class="widget-shell widget-shell--preview" :style="previewStyle" inert>
              <header class="widget-shell__header">
                <strong><span class="widget-shell__brand-mark" aria-hidden="true"></span>VoiceRoom</strong
                ><span class="widget-shell__guest">Гость</span>
              </header>
              <p class="widget-shell__status">Готов к подключению</p>
              <WidgetJoinControls preview />
              <p v-if="config.chat" class="widget-shell__chat-hint">Текстовый чат доступен в комнате</p>
            </div>
            <span
              v-if="config.mode === 'floating'"
              class="widget-configurator__launcher"
              :style="{
                '--vr-text': config.text,
                '--vr-bg': config.background,
                marginInlineStart: config.corner.endsWith('left') ? '0' : 'auto',
                marginInlineEnd: config.corner.endsWith('right') ? '0' : 'auto'
              }"
              >VoiceRoom</span
            >
          </div>
        </div>
        <p class="widget-configurator__preview-note">
          <ShieldCheck :size="16" aria-hidden="true" />Предпросмотр: камера и микрофон не включаются.
        </p>
      </section>
    </div>

    <section class="widget-configurator__code" aria-labelledby="widget-code-heading">
      <div class="widget-configurator__code-head">
        <div>
          <Code :size="20" aria-hidden="true" />
          <h2 id="widget-code-heading">Добавьте на свой сайт</h2>
        </div>
        <Button variant="primary" :disabled="!result.code" @click="copyCode"
          ><Check v-if="copied" :size="16" aria-hidden="true" /><Copy v-else :size="16" aria-hidden="true" />{{
            copied ? 'Скопировано' : 'Скопировать код'
          }}</Button
        >
      </div>
      <p>Вставьте этот код в HTML страницы. Чтобы изменить настройки, замените его новым.</p>
      <label class="widget-configurator__sr-only" for="widget-code">Код вставки</label>
      <textarea id="widget-code" ref="codeField" :value="result.code" readonly rows="4" spellcheck="false" />
      <p v-if="result.error && showValidation" role="alert" class="widget-configurator__error">{{ result.error }}</p>
      <p v-if="copyFailed" role="status">Не удалось скопировать автоматически. Код выделен — нажмите Ctrl+C или ⌘C.</p>
      <p v-else-if="copied" role="status" class="widget-configurator__copy-status">
        Код скопирован. Можно вставлять на сайт.
      </p>
      <details class="widget-configurator__help">
        <summary>Что нужно для работы?</summary>
        <p>
          Сайт должен работать по HTTPS. Игрок разрешает доступ к микрофону и камере при подключении. Если на сайте
          настроен CSP, разрешите скрипты и фреймы с адреса VoiceRoom.
        </p>
      </details>
    </section>
  </main>
</template>
