<script setup lang="ts">
import '@/styles/widget/_call.scss';
import {
  Check,
  ChevronDown,
  Copy,
  HeadphoneOff,
  Headphones,
  Maximize2,
  Mic,
  MicOff,
  Minimize2,
  PhoneOff,
  Video,
  VideoOff
} from '@lucide/vue';
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue';
import ParticipantTileFace from '@/features/room/components/ParticipantTileFace.vue';
import { fitWidgetTiles } from '@/shared/ui/tile-grid';
import { avatarInitial } from '@/shared/utils/avatar-initial';
import { copyText } from '@/shared/utils/clipboard';

type Device = 'input' | 'output' | 'camera';
const props = withDefaults(
  defineProps<{
    members: {
      id: string;
      name: string;
      self?: boolean;
      muted?: boolean;
      speaking?: boolean;
      video?: HTMLVideoElement | undefined;
    }[];
    roomCode: string;
    status: string;
    quality?: 'excellent' | 'good' | 'poor' | 'lost' | 'unknown';
    muted?: boolean;
    outputMuted?: boolean;
    camera?: boolean;
    cameraAllowed?: boolean;
    floating?: boolean;
    preview?: boolean;
    expandable?: boolean;
    expanded?: boolean;
    panel?: Device | 'participant' | null;
  }>(),
  { cameraAllowed: true, quality: 'unknown', panel: null }
);

const connection = computed(() => {
  switch (props.quality) {
    case 'excellent':
      return { state: 'connected', label: 'Отличная связь' };
    case 'good':
      return { state: 'connected', label: 'Хорошая связь' };
    case 'poor':
      return { state: 'warning', label: 'Нестабильная связь' };
    case 'lost':
      return { state: 'error', label: 'Связь потеряна' };
    default:
      return { state: 'idle', label: 'Определяем качество связи' };
  }
});

const controls = computed(() =>
  (
    [
      {
        device: 'input',
        variant: 'mic',
        icon: props.muted ? MicOff : Mic,
        pressed: !props.muted,
        tint: props.muted ? 'muted' : '',
        label: props.muted ? 'Включить микрофон' : 'Выключить микрофон',
        choose: 'Выбрать микрофон'
      },
      {
        device: 'output',
        variant: 'output',
        icon: props.outputMuted ? HeadphoneOff : Headphones,
        pressed: !props.outputMuted,
        tint: props.outputMuted ? 'muted' : '',
        label: props.outputMuted ? 'Включить звук' : 'Выключить звук',
        choose: 'Выбрать динамик'
      },
      {
        device: 'camera',
        variant: 'camera',
        icon: props.camera ? Video : VideoOff,
        pressed: !!props.camera,
        tint: props.camera ? 'on' : '',
        label: props.camera ? 'Выключить камеру' : 'Включить камеру',
        choose: 'Выбрать камеру'
      }
    ] as const
  ).filter((control) => control.device !== 'camera' || props.cameraAllowed)
);

const panelNode = ref<HTMLElement | null>(null);
const grid = ref<HTMLElement | null>(null);
watch(
  grid,
  (element, _previous, onCleanup) => {
    if (element && typeof ResizeObserver !== 'undefined') onCleanup(fitWidgetTiles(element));
  },
  { flush: 'post' }
);
let opener: HTMLElement | null = null;
watch(
  () => props.panel,
  async (next) => {
    const focused = document.activeElement;
    if (next && focused instanceof HTMLElement && !panelNode.value?.contains(focused)) opener = focused;
    await nextTick();
    if (props.panel !== next) return;
    if (next) panelNode.value?.focus({ preventScroll: true });
    else opener?.focus({ preventScroll: true });
  }
);
const emit = defineEmits<{
  toggleDevice: [device: Device];
  device: [device: Device];
  participant: [id: string];
  leave: [];
  collapse: [];
  closePanel: [];
  expand: [expanded: boolean];
}>();

const codeNode = ref<HTMLElement | null>(null);
const copyResult = ref('');
let copyTimer: ReturnType<typeof setTimeout> | undefined;
function clearCopyFeedback() {
  clearTimeout(copyTimer);
  copyResult.value = '';
}
function reportCopy(message: string) {
  clearCopyFeedback();
  copyResult.value = message;
  copyTimer = setTimeout(clearCopyFeedback, 1800);
}
watch(() => props.roomCode, clearCopyFeedback);
onBeforeUnmount(clearCopyFeedback);
async function copyRoomCode() {
  try {
    await copyText(props.roomCode);
    reportCopy('Код скопирован');
  } catch {
    const selection = window.getSelection();
    if (!selection || !codeNode.value) {
      reportCopy('Не удалось скопировать код');
      return;
    }
    const range = document.createRange();
    range.selectNodeContents(codeNode.value);
    selection.removeAllRanges();
    selection.addRange(range);
    reportCopy('Код выделен для копирования');
  }
}

function escape(event: KeyboardEvent) {
  if (props.panel) emit('closePanel');
  else if (props.expanded) emit('expand', false);
  else return;
  event.stopPropagation();
}

function showVideo(mount: unknown, video?: HTMLVideoElement) {
  if (!(mount instanceof HTMLElement)) return;
  if (video && video.parentNode !== mount) mount.replaceChildren(video);
  else if (!video && mount.firstChild) mount.replaceChildren();
}

function openParticipantMenu(event: MouseEvent | KeyboardEvent, member: (typeof props.members)[number]) {
  if (props.preview || member.self) return;
  if (
    event instanceof KeyboardEvent &&
    !['Enter', ' ', 'ContextMenu'].includes(event.key) &&
    !(event.shiftKey && event.key === 'F10')
  )
    return;
  event.preventDefault();
  emit('participant', member.id);
}
</script>

<template>
  <div class="widget-call" @keydown.esc="escape">
    <span class="widget-call__sr-only" role="status">{{ status }}</span>
    <header
      class="widget-call__header widget-call__chrome"
      :class="{ 'widget-call__header--copy-feedback': copyResult }"
    >
      <button
        type="button"
        class="widget-call__code-button"
        aria-label="Скопировать код комнаты"
        :title="copyResult || 'Скопировать код комнаты'"
        @click="copyRoomCode"
      >
        <code ref="codeNode" class="widget-call__code">{{ roomCode }}</code>
        <Check v-if="copyResult === 'Код скопирован'" :size="14" aria-hidden="true" />
        <Copy v-else :size="14" aria-hidden="true" />
      </button>
      <span class="widget-call__copy-feedback" aria-live="polite">{{ copyResult }}</span>
      <button
        v-if="floating"
        type="button"
        aria-label="Свернуть"
        title="Свернуть"
        :disabled="preview"
        @click="$emit('collapse')"
      >
        <Minimize2 :size="16" aria-hidden="true" />
      </button>
    </header>

    <ul ref="grid" class="tile-grid widget-call__tiles" aria-label="Участники звонка" tabindex="0">
      <li v-for="member in members" :key="member.id">
        <div
          class="participant participant--grid"
          :class="{
            'participant--local': member.self,
            'participant--muted': member.muted,
            'participant--speaking': member.speaking,
            'participant--camera': member.video
          }"
          :data-peer-id="member.id"
          :role="preview || member.self ? undefined : 'button'"
          :tabindex="preview || member.self ? undefined : 0"
          :aria-haspopup="preview || member.self ? undefined : 'dialog'"
          :aria-label="preview || member.self ? undefined : `Звук участника ${member.name}`"
          @click="openParticipantMenu($event, member)"
          @contextmenu="openParticipantMenu($event, member)"
          @keydown="openParticipantMenu($event, member)"
        >
          <div
            :ref="(mount) => showVideo(mount, member.video)"
            class="participant__camera"
            :hidden="!member.video"
            aria-hidden="true"
          />
          <ParticipantTileFace
            :name="member.name"
            :initials="avatarInitial(member.name)"
            :local="member.self === true"
          />
        </div>
      </li>
    </ul>

    <div
      v-if="panel"
      ref="panelNode"
      class="widget-call__panel room-dock__device-popover"
      role="dialog"
      aria-label="Настройки звонка"
      tabindex="-1"
    >
      <slot />
    </div>
    <div class="room-dock room-dock--widget widget-call__chrome" role="group" aria-label="Управление звонком">
      <div class="room-dock__shell">
        <div v-for="control in controls" :key="control.device" class="room-dock__cluster">
          <div class="room-dock__split" :class="control.tint && `room-dock__split--${control.tint}`">
            <button
              type="button"
              class="room-dock__button"
              :class="`room-dock__button--${control.variant}`"
              :aria-label="control.label"
              :title="control.label"
              :aria-pressed="control.pressed"
              :disabled="preview"
              @click="$emit('toggleDevice', control.device)"
            >
              <component :is="control.icon" aria-hidden="true" />
            </button>
            <button
              type="button"
              class="room-dock__menu-button"
              :aria-label="control.choose"
              :title="control.choose"
              :aria-expanded="panel === control.device"
              @click="$emit('device', control.device)"
            >
              <ChevronDown aria-hidden="true" />
            </button>
          </div>
        </div>
        <span class="room-dock__divider" aria-hidden="true"></span>
        <div class="room-dock__connection-wrap">
          <span
            class="room-dock__connection"
            :class="`room-dock__connection--${connection.state}`"
            role="img"
            :aria-label="connection.label"
            :title="connection.label"
          >
            <span class="room-dock__bar"></span><span class="room-dock__bar"></span><span class="room-dock__bar"></span>
          </span>
        </div>
        <button
          type="button"
          class="room-dock__button room-dock__button--leave"
          aria-label="Выйти"
          title="Покинуть звонок"
          :disabled="preview"
          @click="$emit('leave')"
        >
          <PhoneOff aria-hidden="true" />
        </button>
      </div>
    </div>
    <button
      v-if="expandable"
      type="button"
      class="widget-call__expand widget-call__chrome"
      :aria-label="expanded ? 'Вернуть размер виджета' : 'Развернуть виджет'"
      :title="expanded ? 'Вернуть размер виджета' : 'Развернуть виджет'"
      :aria-pressed="expanded"
      @click="$emit('expand', !expanded)"
    >
      <Minimize2 v-if="expanded" :size="16" aria-hidden="true" />
      <Maximize2 v-else :size="16" aria-hidden="true" />
    </button>
  </div>
</template>
