<script setup lang="ts">
// Right-click menu shared by the room chat and DMs. Quick reactions sit at the
// top so the most common action needs no submenu; everything else is a normal
// menu row. Which rows appear is decided by the caller through the flags.
import { computed, onBeforeUnmount, onMounted } from 'vue';
import { Copy, Download, Flag, Image as ImageIcon, Pencil, Pin, PinOff, Reply, SmilePlus, Trash2 } from '@lucide/vue';
import { ContextMenu, PopoverDivider, PopoverMenuItem } from '@/shared/ui';
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
  ariaLabel: 'Действия с сообщением'
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
  <ContextMenu v-bind="menuProps" @close="emit('close')">
    <template #default="{ close }">
      <div class="message-menu">
        <template v-if="canReact && quickReactions.length > 0">
          <div class="message-menu__reactions" role="group" aria-label="Быстрые реакции">
            <button
              v-for="emoji in quickReactions"
              :key="emoji"
              class="message-menu__reaction"
              :class="{ 'message-menu__reaction--active': activeReactions.includes(emoji) }"
              type="button"
              role="menuitem"
              :disabled="busy"
              :aria-label="`Реакция ${emoji}`"
              :title="`Реакция ${emoji}`"
              @click="
                onReact?.(emoji);
                close();
              "
            >
              <Emoji :emoji="emoji" :size="20" decorative />
            </button>
            <button
              class="message-menu__reaction message-menu__reaction--more"
              type="button"
              role="menuitem"
              :disabled="busy"
              aria-label="Поставить реакцию"
              title="Поставить реакцию"
              @click="
                (event: MouseEvent) => {
                  const anchor = event.currentTarget;
                  onOpenReactionPicker?.(anchor);
                  close();
                }
              "
            >
              <SmilePlus v-bind="iconMd" aria-hidden="true" />
            </button>
          </div>

          <PopoverDivider />
        </template>

        <PopoverMenuItem v-if="onReply" label="Ответить" :disabled="busy" @click="pick(onReply, close)">
          <template #icon><Reply v-bind="iconMd" aria-hidden="true" /></template>
        </PopoverMenuItem>

        <PopoverMenuItem label="Скопировать текст" :disabled="busy" @click="pick(onCopy, close)">
          <template #icon><Copy v-bind="iconMd" aria-hidden="true" /></template>
        </PopoverMenuItem>

        <PopoverMenuItem
          v-if="onCopyImage"
          label="Скопировать изображение"
          :disabled="busy"
          @click="pick(onCopyImage, close)"
        >
          <template #icon><ImageIcon v-bind="iconMd" aria-hidden="true" /></template>
        </PopoverMenuItem>

        <PopoverMenuItem
          v-if="onDownloadImage"
          label="Скачать изображение"
          :disabled="busy"
          @click="pick(onDownloadImage, close)"
        >
          <template #icon><Download v-bind="iconMd" aria-hidden="true" /></template>
        </PopoverMenuItem>

        <PopoverDivider v-if="canPin || canEdit" />

        <PopoverMenuItem
          v-if="canPin"
          :label="pinned ? 'Открепить' : 'Закрепить в комнате'"
          :disabled="busy"
          @click="pick(onTogglePin, close)"
        >
          <template #icon>
            <PinOff v-if="pinned" v-bind="iconMd" aria-hidden="true" />
            <Pin v-else v-bind="iconMd" aria-hidden="true" />
          </template>
        </PopoverMenuItem>

        <PopoverMenuItem v-if="canEdit" label="Изменить" hint="E" :disabled="busy" @click="pick(onEdit, close)">
          <template #icon><Pencil v-bind="iconMd" aria-hidden="true" /></template>
        </PopoverMenuItem>

        <!-- Moderation: reporting and deleting sit together, both in red. -->
        <PopoverDivider v-if="onReport || canDelete" />

        <PopoverMenuItem
          v-if="onReport"
          label="Пожаловаться"
          variant="danger"
          :disabled="busy"
          @click="
            onReport();
            close();
          "
        >
          <template #icon><Flag v-bind="iconMd" aria-hidden="true" /></template>
        </PopoverMenuItem>

        <PopoverMenuItem
          v-if="canDelete"
          label="Удалить"
          hint="⌫"
          variant="danger"
          :disabled="busy"
          @click="pick(onDelete, close)"
        >
          <template #icon><Trash2 v-bind="iconMd" aria-hidden="true" /></template>
        </PopoverMenuItem>
      </div>
    </template>
  </ContextMenu>
</template>
