<script setup lang="ts">
// Callback props (onX) instead of emits: the menu renders differently depending on whether a handler was given.
// Right-click menu shared by the room chat and DMs. Quick reactions sit at the
// top so the most common action needs no submenu; everything else is a normal
// menu row. Which rows appear is decided by the caller through the flags.
import { t } from '@/shared/i18n';
import { computed, onBeforeUnmount, onMounted } from 'vue';
import { Copy, Download, Flag, Image as ImageIcon, Pencil, Pin, PinOff, Reply, SmilePlus, Trash2 } from '@lucide/vue';
import { ContextMenu, ContextMenuHeaderButton, MenuSeparator, MenuItem } from '@/shared/ui';
import { iconMd } from '@/shared/ui/icons';
import Emoji from './Emoji.vue';

const props = withDefaults(
  defineProps<{
    open: boolean;
    /** The picture the menu was opened on; its rows appear only when given. */
    onCopyImage?: (() => void) | undefined;
    onDownloadImage?: (() => void) | undefined;
    x: number;
    y: number;
    quickReactions?: readonly string[] | undefined;
    /** The emoji the viewer has already put on the message. */
    activeReactions?: readonly string[] | undefined;
    canReact?: boolean | undefined;
    canPin?: boolean | undefined;
    pinned?: boolean | undefined;
    canEdit?: boolean | undefined;
    canDelete?: boolean | undefined;
    busy?: boolean | undefined;
    onReact?: ((emoji: string) => void) | undefined;
    onOpenReactionPicker?: ((anchor: EventTarget | null) => void) | undefined;
    onReply?: (() => void) | undefined;
    onCopy?: (() => void) | undefined;
    onTogglePin?: (() => void) | undefined;
    onEdit?: (() => void) | undefined;
    onDelete?: (() => void) | undefined;
    /** Reporting to the service operator; the row appears only when given. */
    onReport?: (() => void) | undefined;
  }>(),
  {
    onCopyImage: undefined,
    onDownloadImage: undefined,
    quickReactions: () => [],
    activeReactions: () => [],
    canReact: false,
    canPin: false,
    pinned: false,
    canEdit: false,
    canDelete: false,
    busy: false,
    onReact: undefined,
    onOpenReactionPicker: undefined,
    onReply: undefined,
    onCopy: undefined,
    onTogglePin: undefined,
    onEdit: undefined,
    onDelete: undefined,
    onReport: undefined
  }
);

const emit = defineEmits<{ close: [] }>();

const menuProps = computed(() => ({
  open: props.open,
  x: props.x,
  y: props.y,
  ariaLabel: t('Действия с сообщением')
}));

function pick(action: (() => void) | undefined, close: () => void): void {
  try {
    action?.();
  } finally {
    close();
  }
}

function handleShortcut(event: KeyboardEvent): void {
  if (!props.open || event.isComposing || event.metaKey || event.ctrlKey || event.altKey) return;
  const target = event.target;
  if (
    target instanceof HTMLElement &&
    target.closest('input, textarea, select, [contenteditable="true"], [role="textbox"]')
  )
    return;
  if (event.key.toLowerCase() === 'e' && props.canEdit && props.onEdit) {
    event.preventDefault();
    event.stopPropagation();
    props.onEdit();
    emit('close');
  } else if ((event.key === 'Delete' || event.key === 'Backspace') && props.canDelete && props.onDelete) {
    event.preventDefault();
    event.stopPropagation();
    props.onDelete();
    emit('close');
  }
}

onMounted(() => window.addEventListener('keydown', handleShortcut));
onBeforeUnmount(() => window.removeEventListener('keydown', handleShortcut));
</script>

<template>
  <ContextMenu v-bind="menuProps" :header-label="t('Быстрые реакции')" @close="emit('close')">
    <template v-if="canReact && quickReactions.length > 0" #header="{ close }">
      <ContextMenuHeaderButton
        v-for="emoji in quickReactions"
        :key="emoji"
        :pressed="activeReactions.includes(emoji)"
        :disabled="busy"
        :label="t('Реакция {p0}', { p0: emoji })"
        @click="
          onReact?.(emoji);
          close();
        "
      >
        <Emoji :emoji="emoji" :size="20" decorative />
      </ContextMenuHeaderButton>
      <ContextMenuHeaderButton
        :disabled="busy"
        :label="t('Поставить реакцию')"
        @click="
          (event: MouseEvent) => {
            const anchor = event.currentTarget;
            onOpenReactionPicker?.(anchor);
            close();
          }
        "
      >
        <SmilePlus v-bind="iconMd" aria-hidden="true" />
      </ContextMenuHeaderButton>
    </template>

    <template #default="{ close }">
      <MenuItem v-if="onReply" :label="t('Ответить')" :disabled="busy" @select.prevent="pick(onReply, close)">
        <template #icon><Reply v-bind="iconMd" aria-hidden="true" /></template>
      </MenuItem>

      <MenuItem :label="t('Скопировать текст')" :disabled="busy" @select.prevent="pick(onCopy, close)">
        <template #icon><Copy v-bind="iconMd" aria-hidden="true" /></template>
      </MenuItem>

      <MenuItem
        v-if="onCopyImage"
        :label="t('Скопировать изображение')"
        :disabled="busy"
        @select.prevent="pick(onCopyImage, close)"
      >
        <template #icon><ImageIcon v-bind="iconMd" aria-hidden="true" /></template>
      </MenuItem>

      <MenuItem
        v-if="onDownloadImage"
        :label="t('Скачать изображение')"
        :disabled="busy"
        @select.prevent="pick(onDownloadImage, close)"
      >
        <template #icon><Download v-bind="iconMd" aria-hidden="true" /></template>
      </MenuItem>

      <MenuSeparator v-if="canPin || canEdit" />

      <MenuItem
        v-if="canPin"
        :label="pinned ? t('Открепить') : t('Закрепить в комнате')"
        :disabled="busy"
        @select.prevent="pick(onTogglePin, close)"
      >
        <template #icon>
          <PinOff v-if="pinned" v-bind="iconMd" aria-hidden="true" />
          <Pin v-else v-bind="iconMd" aria-hidden="true" />
        </template>
      </MenuItem>

      <MenuItem
        v-if="canEdit"
        :label="t('Изменить')"
        shortcut="E"
        :disabled="busy"
        @select.prevent="pick(onEdit, close)"
      >
        <template #icon><Pencil v-bind="iconMd" aria-hidden="true" /></template>
      </MenuItem>

      <!-- Moderation: reporting and deleting sit together, both in red. -->
      <MenuSeparator v-if="onReport || canDelete" />

      <MenuItem
        v-if="onReport"
        :label="t('Пожаловаться')"
        tone="danger"
        :disabled="busy"
        @select.prevent="
          onReport();
          close();
        "
      >
        <template #icon><Flag v-bind="iconMd" aria-hidden="true" /></template>
      </MenuItem>

      <MenuItem
        v-if="canDelete"
        :label="t('Удалить')"
        shortcut="⌫"
        tone="danger"
        :disabled="busy"
        @select.prevent="pick(onDelete, close)"
      >
        <template #icon><Trash2 v-bind="iconMd" aria-hidden="true" /></template>
      </MenuItem>
    </template>
  </ContextMenu>
</template>
