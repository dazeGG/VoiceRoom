<script setup lang="ts">
import '@/styles/widget/_configurator.scss';
import '@/styles/widget/_shell.scss';
import { computed, onBeforeUnmount, onMounted, reactive, ref } from 'vue';
import { ArrowLeft, Check, Copy, PanelTop, ShieldCheck } from '@lucide/vue';
import {
  DEFAULT_WIDGET_HEIGHT,
  DEFAULT_WIDGET_TITLE,
  DEFAULT_WIDGET_WIDTH,
  DEFAULT_WIDGET_PREVIEW_HEIGHT,
  WIDGET_SERVICE_URL,
  WIDGET_SIZE_LIMITS,
  WIDGET_TITLE_LIMIT,
  defaultWidgetConfig,
  normalizeWidgetColor,
  type WidgetConfig
} from '@voice-room/shared/contracts/widget';
import { createRoomCode } from '@voice-room/shared/validation';
import { widgetSnippet } from '@/features/widget/snippet';
import WidgetJoinControls from '@/features/widget/WidgetJoinControls.vue';
import WidgetCallLayout from '@/features/widget/WidgetCallLayout.vue';
import { createWidgetFrameExpansion } from '@/features/widget/frame-expansion';
import { Button } from '@/shared/ui/Button';
import { SegmentControl } from '@/shared/ui/SegmentControl';
import type { SegmentOption } from '@/shared/ui/SegmentControl/types';
import { Switch } from '@/shared/ui/Switch';
import { Slider } from '@/shared/ui/Slider';
import { copyText } from '@/shared/utils/clipboard';

const config = reactive({ ...defaultWidgetConfig });
const cameraAllowed = ref(true);
const stage = ref<HTMLElement | null>(null);
const demoViewport = ref<HTMLElement | null>(null);
const demoExpanded = ref(false);
let demoExpansion: ReturnType<typeof createWidgetFrameExpansion> | undefined;
const stageWidth = ref(0);
const demoSize = reactive({ width: DEFAULT_WIDGET_WIDTH, height: DEFAULT_WIDGET_PREVIEW_HEIGHT });
const panelSize = reactive({ width: DEFAULT_WIDGET_WIDTH, height: DEFAULT_WIDGET_HEIGHT });
const sizeLabels = { width: 'Ширина', height: 'Высота' };
const isFloating = computed(() => config.mode === 'floating');
const previewSize = computed(() => (isFloating.value ? panelSize : demoSize));
const previewScreen = ref('entry');
const demoRoomCode = createRoomCode();
const demoCount = ref(4);
const demoDevice = ref<'input' | 'output' | 'camera' | null>(null);
const demoDevices = { input: 'Микрофон', output: 'Вывод звука', camera: 'Камера' };
const screenOptions: SegmentOption[] = [
  { value: 'entry', label: 'Вход' },
  { value: 'call', label: 'В комнате' }
];
const guests = ['Вы', 'Лена', 'Макс', 'Саша', 'Даша', 'Кирилл', 'Анна', 'Миша', 'Ира', 'Олег', 'Вика', 'Рома'];
const demoMembers = computed(() =>
  guests.slice(0, demoCount.value).map((name, index) => ({ id: name, name, self: index === 0, speaking: index === 1 }))
);
const scale = computed(() => Math.min(1, (stageWidth.value || previewSize.value.width) / previewSize.value.width));
let resize: ResizeObserver | undefined;
onMounted(() => {
  if (demoViewport.value?.parentElement) {
    demoExpansion = createWidgetFrameExpansion(demoViewport.value, demoViewport.value.parentElement, (active) => {
      demoExpanded.value = active;
    });
  }
  if (!stage.value || typeof ResizeObserver === 'undefined') return;
  resize = new ResizeObserver(([entry]) => {
    if (entry) stageWidth.value = entry.contentRect.width;
  });
  resize.observe(stage.value);
});
onBeforeUnmount(() => {
  demoExpansion?.dispose();
  resize?.disconnect();
  clearTimeout(copyTimer);
});

const title = ref(DEFAULT_WIDGET_TITLE);
const heading = computed(() => title.value.trim() || DEFAULT_WIDGET_TITLE);
const copiedCode = ref('');
let copyTimer: ReturnType<typeof setTimeout> | undefined;
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
const colorCodes = reactive({
  background: config.background,
  text: config.text,
  accent: config.accent
});
type ColorKey = keyof typeof colorCodes;
function updateColorCode(key: ColorKey, code: string) {
  colorCodes[key] = code;
  const color = normalizeWidgetColor(code);
  if (color) config[key] = color;
}
const result = computed(() => {
  if (colors.some(({ key }) => !normalizeWidgetColor(colorCodes[key]))) {
    return { code: '', error: 'Введите цвет в формате HEX или RGB.' };
  }
  try {
    const settings = {
      ...config,
      ...(isFloating.value ? panelSize : {}),
      ...(cameraAllowed.value ? {} : { camera: false }),
      ...(heading.value === DEFAULT_WIDGET_TITLE ? {} : { title: heading.value })
    };
    return { code: widgetSnippet(settings), error: '' };
  } catch {
    return { code: '', error: 'Проверьте скругление (0–24 px) и отступ (0–48 px).' };
  }
});
const copied = computed(() => result.value.code !== '' && result.value.code === copiedCode.value);
const copyFailed = computed(() => result.value.code !== '' && result.value.code === failedCode.value);
const previewStyle = computed(() => ({
  '--vr-bg': config.background,
  '--vr-text': config.text,
  '--vr-accent': config.accent,
  '--widget-radius': `${config.radius}px`,
  borderRadius: `${config.radius}px`,
  width: `${previewSize.value.width}px`,
  height: `${previewSize.value.height}px`,
  minHeight: '0',
  transform: `scale(${scale.value})`
}));
const sampleStyle = computed(() => ({
  width: `${previewSize.value.width * scale.value}px`,
  ...(isFloating.value
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
function chooseScreen(value: string) {
  demoExpansion?.closeImmediately();
  previewScreen.value = value;
  demoDevice.value = null;
}
function chooseDemoDevice(device: 'input' | 'output' | 'camera') {
  demoDevice.value = demoDevice.value === device ? null : device;
}
function updateCameraAllowed(enabled: boolean) {
  cameraAllowed.value = enabled;
  if (!enabled && demoDevice.value === 'camera') demoDevice.value = null;
}
function expandDemo(expanded: boolean) {
  demoExpansion?.set(expanded);
}
async function copyCode() {
  const code = result.value.code;
  if (!code) return;
  clearTimeout(copyTimer);
  copiedCode.value = '';
  failedCode.value = '';
  try {
    await copyText(code);
    if (result.value.code !== code) return;
    copiedCode.value = code;
    copyTimer = setTimeout(() => {
      copiedCode.value = '';
    }, 1800);
  } catch {
    if (result.value.code !== code) return;
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
      <a class="widget-configurator__back" href="https://docs.voiceroom.ru/widgets/install">Как встроить виджет</a>
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
          <div v-if="isFloating" class="widget-configurator__pair">
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
            <div v-for="(limits, dimension) in WIDGET_SIZE_LIMITS" :key="dimension" class="widget-configurator__size">
              <span class="widget-configurator__size-label">
                <span>{{ sizeLabels[dimension] }}</span
                ><output aria-hidden="true">{{ panelSize[dimension] }} px</output>
              </span>
              <Slider
                v-model="panelSize[dimension]"
                :min="limits.minimum"
                :max="limits.maximum"
                :aria-label="sizeLabels[dimension]"
                :aria-value-text="`${panelSize[dimension]} px`"
              />
            </div>
          </div>
        </fieldset>

        <fieldset class="widget-configurator__group">
          <legend>Оформление</legend>
          <label class="widget-configurator__field">
            Заголовок виджета
            <input v-model="title" class="widget-configurator__title-input" :maxlength="WIDGET_TITLE_LIMIT" />
          </label>
          <div class="widget-configurator__colors">
            <div v-for="color in colors" :key="color.key" class="widget-configurator__color">
              <label :for="`widget-${color.key}`">{{ color.label }}</label>
              <div class="widget-configurator__color-control">
                <input
                  :id="`widget-${color.key}`"
                  :value="config[color.key]"
                  :name="color.key"
                  type="color"
                  @input="updateColorCode(color.key, ($event.target as HTMLInputElement).value)"
                />
                <input
                  :aria-label="`${color.label} (HEX или RGB)`"
                  :aria-invalid="showValidation && !normalizeWidgetColor(colorCodes[color.key])"
                  :value="colorCodes[color.key]"
                  type="text"
                  spellcheck="false"
                  autocomplete="off"
                  @input="updateColorCode(color.key, ($event.target as HTMLInputElement).value)"
                />
              </div>
            </div>
          </div>
          <div class="widget-configurator__radius widget-configurator__size">
            <span class="widget-configurator__size-label">
              <span>Скругление</span><output aria-hidden="true">{{ config.radius }} px</output>
            </span>
            <Slider
              v-model="config.radius"
              :min="0"
              :max="24"
              aria-label="Скругление"
              :aria-value-text="`${config.radius} px`"
            />
          </div>
        </fieldset>

        <fieldset class="widget-configurator__group">
          <legend>Возможности</legend>
          <div class="widget-configurator__toggle">
            <label for="widget-camera">Камера</label>
            <Switch
              id="widget-camera"
              :model-value="cameraAllowed"
              v-bind="{ ariaLabel: 'Камера' }"
              @update:model-value="updateCameraAllowed"
            />
          </div>
        </fieldset>
      </form>

      <section class="widget-configurator__preview" aria-label="Предпросмотр">
        <div class="widget-configurator__preview-head">
          <div>
            <PanelTop :size="18" aria-hidden="true" />
            <h2>Так увидят ваши игроки</h2>
          </div>
          <span v-if="scale < 1">Масштаб {{ Math.round(scale * 100) }}%</span>
        </div>
        <fieldset class="widget-configurator__group widget-configurator__preview-controls">
          <legend>{{ isFloating ? 'Предпросмотр' : 'Демо-контейнер' }}</legend>
          <div v-if="!isFloating" class="widget-configurator__pair">
            <div class="widget-configurator__size">
              <span class="widget-configurator__size-label"
                ><span>Ширина</span><output aria-hidden="true">{{ demoSize.width }} px</output></span
              >
              <Slider
                v-model="demoSize.width"
                :min="240"
                :max="960"
                aria-label="Ширина"
                :aria-value-text="`${demoSize.width} px`"
              />
            </div>
            <div class="widget-configurator__size">
              <span class="widget-configurator__size-label"
                ><span>Высота</span><output aria-hidden="true">{{ demoSize.height }} px</output></span
              >
              <Slider
                v-model="demoSize.height"
                :min="260"
                :max="900"
                aria-label="Высота"
                :aria-value-text="`${demoSize.height} px`"
              />
            </div>
          </div>
          <div class="widget-configurator__preview-actions">
            <SegmentControl
              :value="previewScreen"
              :options="screenOptions"
              v-bind="{ ariaLabel: 'Экран виджета' }"
              size="sm"
              @change="chooseScreen"
            />
            <div v-if="previewScreen === 'call'" class="widget-configurator__size">
              <span class="widget-configurator__size-label"
                ><span>Участников</span><output aria-hidden="true">{{ demoCount }}</output></span
              >
              <Slider v-model="demoCount" :min="1" :max="guests.length" aria-label="Участников" />
            </div>
          </div>
        </fieldset>
        <div
          class="widget-configurator__canvas"
          :style="{ padding: config.mode === 'floating' ? `${config.offset}px` : undefined }"
        >
          <div ref="stage" class="widget-configurator__stage">
            <div class="widget-configurator__sample" :style="sampleStyle">
              <div class="widget-configurator__frame" :style="{ height: `${previewSize.height * scale}px` }">
                <div
                  ref="demoViewport"
                  class="widget-configurator__viewport"
                  style="
                    position: absolute;
                    inset: 0;
                    width: 100%;
                    height: 100%;
                    border: 0;
                    padding: 0;
                    background: transparent;
                  "
                >
                  <div
                    class="widget-shell widget-shell--preview"
                    :class="{ 'widget-shell--call': previewScreen === 'call' }"
                    :style="previewStyle"
                  >
                    <div v-if="previewScreen === 'entry'" class="widget-shell__body" inert>
                      <WidgetJoinControls preview :title="heading" />
                    </div>
                    <div v-else class="widget-shell__body">
                      <WidgetCallLayout
                        :members="demoMembers"
                        :room-code="demoRoomCode"
                        status="В комнате"
                        quality="good"
                        :camera-allowed="cameraAllowed"
                        :expandable="true"
                        :expanded="demoExpanded"
                        :floating="config.mode === 'floating'"
                        :panel="demoDevice"
                        preview
                        @device="chooseDemoDevice"
                        @close-panel="demoDevice = null"
                        @expand="expandDemo"
                      >
                        <div v-if="demoDevice" class="widget-call__settings">
                          <label
                            >{{ demoDevices[demoDevice] }}
                            <select disabled>
                              <option>По умолчанию</option>
                            </select></label
                          >
                          <label v-if="demoDevice === 'input'">
                            Шумоподавление
                            <select disabled>
                              <option>RNNoise</option>
                            </select>
                          </label>
                          <button type="button" @click="demoDevice = null">Закрыть</button>
                        </div>
                      </WidgetCallLayout>
                    </div>
                    <footer class="widget-shell__credit">
                      Powered by <a :href="WIDGET_SERVICE_URL" target="_blank" rel="noopener noreferrer">VoiceRoom</a>
                    </footer>
                  </div>
                </div>
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
        </div>
        <p class="widget-configurator__preview-note">
          <ShieldCheck :size="16" aria-hidden="true" />Камера и микрофон выключены.
        </p>
      </section>
    </div>

    <section class="widget-configurator__code" aria-labelledby="widget-code-heading">
      <div class="widget-configurator__code-head">
        <h2 id="widget-code-heading">Код вставки</h2>
        <Button
          variant="ghost"
          class="widget-configurator__copy"
          aria-label="Скопировать код"
          :title="copied ? 'Скопировано' : 'Скопировать код'"
          :disabled="!result.code"
          @click="copyCode"
        >
          <Check v-if="copied" :size="18" aria-hidden="true" />
          <Copy v-else :size="18" aria-hidden="true" />
        </Button>
      </div>
      <textarea
        ref="codeField"
        :value="result.code"
        aria-labelledby="widget-code-heading"
        readonly
        rows="4"
        spellcheck="false"
      />
      <p v-if="result.error && showValidation" role="alert" class="widget-configurator__error">{{ result.error }}</p>
      <p v-if="copyFailed" role="status">Не удалось скопировать автоматически. Код выделен — нажмите Ctrl+C или ⌘C.</p>
      <span class="widget-configurator__sr-only" aria-live="polite">{{ copied ? 'Код скопирован.' : '' }}</span>
    </section>
  </main>
</template>
