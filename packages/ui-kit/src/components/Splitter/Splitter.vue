<script setup lang="ts">
import { SplitterGroup, SplitterPanel, SplitterResizeHandle } from 'reka-ui';
import { computed, onBeforeUnmount, onMounted, ref, useId, useTemplateRef, watch } from 'vue';
import { formatNumber } from '../../i18n';
import type { SplitterProps, SplitterWidth } from './types';

const props = defineProps<SplitterProps>();
const collapsed = defineModel<boolean>('collapsed', { default: false });
const emit = defineEmits<{
  resize: [width: number];
  commit: [layout: SplitterWidth];
  dragging: [active: boolean];
}>();

const pane = useTemplateRef<InstanceType<typeof SplitterPanel>>('pane');
const id = useId();
const defaultWidth = computed(() => (collapsed.value ? props.collapsedWidth : undefined) ?? props.width);
const pixels = ref(defaultWidth.value);
const dragging = ref(false);
let dragStartWidth = pixels.value;
let cancelled = false;

function isCollapsed(width: number): boolean {
  return props.collapsedWidth !== undefined && width <= props.collapsedWidth;
}

function resize(width: number): void {
  if (!Number.isFinite(width)) return;
  pixels.value = Math.round(width);
  const next = isCollapsed(pixels.value);
  if (collapsed.value !== next) collapsed.value = next;
  emit('resize', pixels.value);
}

function commit(): void {
  emit('commit', { width: pixels.value, collapsed: isCollapsed(pixels.value) });
}

function onDragging(active: boolean): void {
  if (active) {
    dragStartWidth = pixels.value;
    cancelled = false;
  } else if (cancelled) {
    pane.value?.resize(dragStartWidth);
  }
  dragging.value = active;
  emit('dragging', active);
  if (!active && !cancelled) commit();
}

function markCancelled(): void {
  if (dragging.value) cancelled = true;
}

onMounted(() => window.addEventListener('touchcancel', markCancelled, true));
onBeforeUnmount(() => window.removeEventListener('touchcancel', markCancelled, true));

watch([() => props.width, collapsed], ([width, isClosed]) => {
  if (dragging.value || !pane.value) return;
  if (isClosed && props.collapsedWidth !== undefined) {
    if (!pane.value.isCollapsed) pane.value.collapse();
  } else if (pixels.value !== width) {
    pane.value.resize(width);
  }
});

// Reka's keyboard step is a percentage of the splitter. Apply a pixel step
// through the panel API so the distance stays the same at any window width.
function onKeydown(event: KeyboardEvent): void {
  const key = event.key;
  if (key !== 'ArrowLeft' && key !== 'ArrowRight' && key !== 'Home' && key !== 'End' && key !== 'Enter') return;
  event.preventDefault();
  if (!pane.value || event.altKey || event.ctrlKey || event.metaKey || dragging.value) return;
  const rtl = event.currentTarget instanceof HTMLElement && getComputedStyle(event.currentTarget).direction === 'rtl';
  const step = rtl ? -16 : 16;
  if (key === 'ArrowLeft' || key === 'ArrowRight') {
    const next = pixels.value + (key === 'ArrowRight' ? step : -step);
    pane.value.resize(Math.max(props.minWidth, Math.min(props.maxWidth, next)));
  } else if (key === 'End') {
    pane.value.resize(props.maxWidth);
  } else if (key === 'Home' || (key === 'Enter' && props.collapsedWidth !== undefined)) {
    if (props.collapsedWidth === undefined) pane.value.resize(props.minWidth);
    else pane.value.collapse();
  } else {
    return;
  }
  commit();
}
</script>

<template>
  <SplitterGroup class="ui-splitter" direction="horizontal" style="height: var(--splitter-height, 100%)">
    <SplitterPanel
      ref="pane"
      class="ui-splitter__pane ui-splitter__pane--side"
      :class="sideClass"
      :default-size="defaultWidth"
      :min-size="minWidth"
      :max-size="maxWidth"
      :collapsible="collapsedWidth !== undefined"
      :collapsed-size="collapsedWidth ?? 0"
      size-unit="px"
      style="overflow: visible"
      @resize="resize"
    >
      <slot name="side" />
    </SplitterPanel>
    <SplitterResizeHandle
      v-show="!collapsed || dragging"
      :id="handleId ?? id"
      class="ui-splitter__handle"
      :class="{ 'ui-splitter__handle--dragging': dragging }"
      :aria-label="label"
      aria-orientation="vertical"
      :aria-valuetext="`${formatNumber(pixels)} px`"
      :aria-hidden="collapsed || undefined"
      :tabindex="collapsed ? -1 : 0"
      :disabled="collapsed && !dragging"
      :hit-area-margins="{ fine: 0, coarse: 0 }"
      @keydown.capture="onKeydown"
      @dragging="onDragging"
    />
    <SplitterPanel class="ui-splitter__pane ui-splitter__pane--main">
      <slot />
    </SplitterPanel>
  </SplitterGroup>
</template>
