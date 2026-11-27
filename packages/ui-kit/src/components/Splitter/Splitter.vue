<script setup lang="ts">
import { SplitterGroup, SplitterPanel, SplitterResizeHandle } from 'reka-ui';
import { computed, onBeforeUnmount, onMounted, ref, useId, useTemplateRef, watch } from 'vue';
import { formatNumber } from '../../i18n';
import type { SplitterProps, SplitterSize } from './types';

const props = defineProps<SplitterProps>();
const collapsed = defineModel<boolean>('collapsed', { default: false });
const emit = defineEmits<{
  resize: [size: number];
  commit: [layout: SplitterSize];
  dragging: [active: boolean];
}>();

const pane = useTemplateRef<InstanceType<typeof SplitterPanel>>('pane');
const id = useId();
// Reka re-registers the pointer handler if these margins change during a drag.
const hitAreaMargins = { fine: 0, coarse: 0 };
const defaultSize = computed(() => (collapsed.value ? props.collapsedSize : undefined) ?? props.size);
const pixels = ref(defaultSize.value);
const dragging = ref(false);
let dragStartSize = pixels.value;
let cancelled = false;

function isCollapsed(size: number): boolean {
  return props.collapsedSize !== undefined && size <= props.collapsedSize;
}

function resize(size: number): void {
  if (!Number.isFinite(size)) return;
  pixels.value = Math.round(size);
  const next = isCollapsed(pixels.value);
  if (collapsed.value !== next) collapsed.value = next;
  emit('resize', pixels.value);
}

function commit(): void {
  emit('commit', { size: pixels.value, collapsed: isCollapsed(pixels.value) });
}

function onDragging(active: boolean): void {
  if (active) {
    dragStartSize = pixels.value;
    cancelled = false;
  } else if (cancelled) {
    pane.value?.resize(dragStartSize);
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

watch([() => props.size, collapsed], ([size, isClosed]) => {
  if (dragging.value || !pane.value) return;
  if (isClosed && props.collapsedSize !== undefined) {
    if (!pane.value.isCollapsed) pane.value.collapse();
  } else if (pixels.value !== size) {
    pane.value.resize(size);
  }
});

// Reka's keyboard step is a percentage of the splitter. Apply a pixel step
// through the panel API so the distance stays the same at any available size.
function onKeydown(event: KeyboardEvent): void {
  const key = event.key;
  const vertical = props.direction === 'vertical';
  const decrease = vertical ? 'ArrowUp' : 'ArrowLeft';
  const increase = vertical ? 'ArrowDown' : 'ArrowRight';
  if (key !== decrease && key !== increase && key !== 'Home' && key !== 'End' && key !== 'Enter') return;
  event.preventDefault();
  if (!pane.value || event.altKey || event.ctrlKey || event.metaKey || dragging.value) return;
  const rtl =
    !vertical &&
    event.currentTarget instanceof HTMLElement &&
    getComputedStyle(event.currentTarget).direction === 'rtl';
  const step = rtl ? -16 : 16;
  if (key === decrease || key === increase) {
    const next = pixels.value + (key === increase ? step : -step);
    pane.value.resize(Math.max(props.minSize, Math.min(props.maxSize, next)));
  } else if (key === 'End') {
    pane.value.resize(props.maxSize);
  } else if (key === 'Home' || (key === 'Enter' && props.collapsedSize !== undefined)) {
    if (props.collapsedSize === undefined) pane.value.resize(props.minSize);
    else pane.value.collapse();
  } else {
    return;
  }
  commit();
}
</script>

<template>
  <SplitterGroup
    class="ui-splitter"
    :class="{ 'ui-splitter--vertical': direction === 'vertical' }"
    :direction="direction ?? 'horizontal'"
    style="height: var(--splitter-height, 100%)"
  >
    <SplitterPanel
      v-show="singlePane !== 'main'"
      ref="pane"
      class="ui-splitter__pane ui-splitter__pane--side"
      :class="sideClass"
      :default-size="defaultSize"
      :min-size="minSize"
      :max-size="maxSize"
      :collapsible="collapsedSize !== undefined"
      :collapsed-size="collapsedSize ?? 0"
      size-unit="px"
      style="overflow: visible"
      @resize="resize"
    >
      <slot name="side" />
    </SplitterPanel>
    <SplitterResizeHandle
      v-show="!singlePane && (!collapsed || dragging)"
      :id="handleId ?? id"
      class="ui-splitter__handle"
      :class="{ 'ui-splitter__handle--dragging': dragging }"
      :aria-label="label"
      :aria-orientation="direction === 'vertical' ? 'horizontal' : 'vertical'"
      :aria-valuetext="`${formatNumber(pixels)} px`"
      :aria-hidden="collapsed || undefined"
      :tabindex="collapsed ? -1 : 0"
      :disabled="Boolean(singlePane) || (collapsed && !dragging)"
      :hit-area-margins="hitAreaMargins"
      @keydown.capture="onKeydown"
      @dragging="onDragging"
    />
    <SplitterPanel v-show="singlePane !== 'side'" class="ui-splitter__pane ui-splitter__pane--main">
      <slot />
    </SplitterPanel>
  </SplitterGroup>
</template>
