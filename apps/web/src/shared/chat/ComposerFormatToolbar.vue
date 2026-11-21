<script setup lang="ts">
import { Toolbar, ToolbarToggle } from '@voice-room/ui/components';
import { isApplePlatform } from '@voice-room/ui/hotkey';
import { t } from '@/shared/i18n';
import { Bold, CodeXml, Italic, Strikethrough } from '@lucide/vue';
import { computed, ref, watch } from 'vue';
import type { MarkdownFormat } from './composer-markdown';

const props = defineProps<{
  anchor: { x: number; top: number; bottom: number };
  active: readonly MarkdownFormat[];
  limit: number | null;
}>();
const emit = defineEmits<{ apply: [format: MarkdownFormat]; dismiss: [] }>();
const modifier = isApplePlatform() ? '⌘' : 'Ctrl';
const actions = computed(() => [
  { format: 'bold' as const, icon: Bold, label: t('Жирный'), shortcut: [modifier, 'B'] },
  { format: 'italic' as const, icon: Italic, label: t('Курсив'), shortcut: [modifier, 'I'] },
  { format: 'strike' as const, icon: Strikethrough, label: t('Зачёркнутый'), shortcut: undefined },
  { format: 'code' as const, icon: CodeXml, label: t('Код'), shortcut: undefined }
]);

const panel = ref<HTMLElement | null>(null);

watch(
  [panel, () => props.anchor, () => props.limit],
  ([element, anchor]) => {
    if (!element) return;
    if (element.showPopover && !element.matches(':popover-open')) element.showPopover();
    const { offsetWidth: width, offsetHeight: height } = element;
    const gap = 6;
    const maxLeft = document.documentElement.clientWidth - width - gap;
    const maxTop = document.documentElement.clientHeight - height - gap;
    const above = anchor.top - height - gap;
    element.style.left = `${Math.max(gap, Math.min(anchor.x - width / 2, maxLeft))}px`;
    element.style.top = `${Math.max(gap, Math.min(above >= gap ? above : anchor.bottom + gap, maxTop))}px`;
  },
  { flush: 'post' }
);
</script>

<template>
  <div ref="panel" popover="manual" class="composer-format">
    <Toolbar :label="t('Форматирование сообщения')" @keydown.esc.prevent="emit('dismiss')">
      <ToolbarToggle
        v-for="action in actions"
        :key="action.format"
        :label="action.label"
        :pressed="active.includes(action.format)"
        :shortcut="action.shortcut"
        :tooltip-target="panel ?? undefined"
        @mousedown.prevent
        @update:pressed="emit('apply', action.format)"
      >
        <component :is="action.icon" aria-hidden="true" />
      </ToolbarToggle>
    </Toolbar>
    <p class="composer-format__status" role="status">
      {{ limit === null ? '' : t('Лимит сообщения — {p0} символов', { p0: limit }) }}
    </p>
  </div>
</template>
