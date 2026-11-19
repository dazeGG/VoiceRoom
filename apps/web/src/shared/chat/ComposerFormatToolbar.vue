<script setup lang="ts">
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
const actions = computed(
  () =>
    [
      { format: 'bold', icon: Bold, label: t('Жирный') },
      { format: 'italic', icon: Italic, label: t('Курсив') },
      { format: 'strike', icon: Strikethrough, label: t('Зачёркнутый') },
      { format: 'code', icon: CodeXml, label: t('Код') }
    ] as const
);

const panel = ref<HTMLElement | null>(null);
const nativeFocusGroup = 'focusGroup' in HTMLElement.prototype;
const focusGroup = { focusgroup: 'toolbar wrap' };
const current = ref(0);

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

function onKeydown(event: KeyboardEvent): void {
  if (event.key === 'Escape') {
    event.preventDefault();
    emit('dismiss');
    return;
  }
  if (nativeFocusGroup) return;
  const count = actions.value.length;
  const steps: Record<string, number> = {
    ArrowLeft: (current.value + count - 1) % count,
    ArrowRight: (current.value + 1) % count,
    Home: 0,
    End: count - 1
  };
  const next = steps[event.key];
  if (next === undefined || !Object.hasOwn(steps, event.key)) return;
  event.preventDefault();
  panel.value?.querySelectorAll('button')[next]?.focus();
}
</script>

<template>
  <div ref="panel" popover="manual" class="composer-format">
    <div
      v-bind="focusGroup"
      role="toolbar"
      :aria-label="t('Форматирование сообщения')"
      class="composer-format__actions"
      @keydown="onKeydown"
    >
      <button
        v-for="(action, index) in actions"
        :key="action.format"
        type="button"
        :aria-label="action.label"
        :aria-pressed="active.includes(action.format)"
        :title="action.label"
        :tabindex="nativeFocusGroup ? undefined : index === current ? 0 : -1"
        @focus="current = index"
        @mousedown.prevent
        @click="emit('apply', action.format)"
      >
        <component :is="action.icon" :size="16" aria-hidden="true" />
      </button>
    </div>
    <p class="composer-format__status" role="status">
      {{ limit === null ? '' : t('Лимит сообщения — {p0} символов', { p0: limit }) }}
    </p>
  </div>
</template>
