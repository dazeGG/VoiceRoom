<script setup lang="ts">
import '@/styles/widget/_configurator.scss';
import '@voice-room/ui/styles/widget/shell';
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
  widgetEmbedMarkup,
  type WidgetConfig
} from '@voice-room/shared/contracts/widget';
import { createRoomCode } from '@voice-room/shared/validation';
import { WidgetCallLayout, WidgetJoinControls } from '@voice-room/ui/widget';
import { createWidgetFrameExpansion } from '@voice-room/ui/widget-frame-expansion';
import {
  Field,
  IconButton,
  NumberField,
  SegmentControl,
  Slider,
  Switch,
  Textarea,
  TextField,
  type SegmentOption
} from '@voice-room/ui/components';
import { copyText } from '@/shared/utils/clipboard';

const config = reactive({ ...defaultWidgetConfig });
const offset = ref<number | null>(config.offset);
// Reka commits on blur. Keep the draft available to the preview while the user types.
const offsetDraft = ref<number>();
const previewOffset = computed(() => offsetDraft.value ?? offset.value ?? NaN);

function previewTypedOffset(event: Event): void {
  if (!(event.target instanceof HTMLInputElement)) return;
  const typed = event.target.value.trim();
  offsetDraft.value = typed ? Number(typed.replace(',', '.')) : NaN;
}

function commitOffset(value: number | null): void {
  offset.value = value;
  offsetDraft.value = undefined;
}

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
const codeField = ref<{ textarea: HTMLTextAreaElement | null } | null>(null);
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
function updateColorSwatch(key: ColorKey, event: Event): void {
  if (event.target instanceof HTMLInputElement) updateColorCode(key, event.target.value);
}
const result = computed(() => {
  if (colors.some(({ key }) => !normalizeWidgetColor(colorCodes[key]))) {
    return { code: '', error: 'Введите цвет в формате HEX или RGB.' };
  }
  try {
    const settings = {
      ...config,
      offset: previewOffset.value,
      ...(isFloating.value ? panelSize : {}),
      ...(cameraAllowed.value ? {} : { camera: false }),
      ...(heading.value === DEFAULT_WIDGET_TITLE ? {} : { title: heading.value })
    };
    return { code: widgetEmbedMarkup(settings), error: '' };
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
    codeField.value?.textarea?.focus();
    codeField.value?.textarea?.select();
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
            <Field v-slot="{ control }" label="Положение">
              <select v-bind="control" v-model="config.corner" class="ui-select" name="corner">
                <option value="bottom-right">Справа внизу</option>
                <option value="bottom-left">Слева внизу</option>
                <option value="top-right">Справа вверху</option>
                <option value="top-left">Слева вверху</option>
              </select>
            </Field>
            <Field label="Отступ, px">
              <NumberField
                :model-value="offset"
                name="offset"
                :min="0"
                :max="48"
                allow-invalid
                @input="previewTypedOffset"
                @blur="offsetDraft = undefined"
                @update:model-value="commitOffset"
              />
            </Field>
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
          <Field label="Заголовок виджета">
            <TextField v-model="title" :maxlength="WIDGET_TITLE_LIMIT" />
          </Field>
          <div class="widget-configurator__colors">
            <Field
              v-for="color in colors"
              :key="color.key"
              :label="`${color.label} (HEX или RGB)`"
              :error="
                showValidation && !normalizeWidgetColor(colorCodes[color.key]) ? 'Введите HEX или RGB.' : undefined
              "
            >
              <div class="widget-configurator__color-control">
                <input
                  class="widget-configurator__swatch"
                  :value="config[color.key]"
                  :name="color.key"
                  :aria-label="color.label"
                  type="color"
                  @input="updateColorSwatch(color.key, $event)"
                />
                <TextField
                  :model-value="colorCodes[color.key]"
                  variant="mono"
                  spellcheck="false"
                  autocomplete="off"
                  @update:model-value="updateColorCode(color.key, $event)"
                />
              </div>
            </Field>
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
          :style="{ padding: config.mode === 'floating' ? `${previewOffset}px` : undefined }"
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
        <IconButton label="Скопировать код" :disabled="!result.code" @click="copyCode">
          <Check v-if="copied" aria-hidden="true" />
          <Copy v-else aria-hidden="true" />
        </IconButton>
      </div>
      <Field class="widget-configurator__code-field" label="Код вставки">
        <Textarea ref="codeField" :model-value="result.code" readonly spellcheck="false" />
      </Field>
      <p v-if="result.error && showValidation" role="alert" class="widget-configurator__error">{{ result.error }}</p>
      <p v-if="copyFailed" role="status">Не удалось скопировать автоматически. Код выделен — нажмите Ctrl+C или ⌘C.</p>
      <span class="widget-configurator__sr-only" aria-live="polite">{{ copied ? 'Код скопирован.' : '' }}</span>
    </section>
  </main>
</template>
