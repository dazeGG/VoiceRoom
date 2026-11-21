<script setup lang="ts" generic="T extends string">
import { TabsList, TabsRoot, TabsTrigger } from 'reka-ui';
import { useId } from 'vue';
import { formatNumber } from '../../i18n';
import type { TabsProps } from './types';

const props = withDefaults(defineProps<TabsProps<T>>(), { variant: 'line', stretch: false });
const value = defineModel<T>({ required: true });
const countId = useId();

function select(next: string | number): void {
  const item = props.items.find(({ value }) => value === next);
  if (item) value.value = item.value;
}
</script>

<template>
  <TabsRoot class="ui-tabs" :model-value="value" @update:model-value="select">
    <TabsList
      class="ui-tabs__list"
      :class="{
        'ui-tabs__list--line': variant === 'line',
        'ui-tabs__list--stretch': stretch,
        'ui-segment': variant === 'segmented'
      }"
      :aria-label="label"
      loop
    >
      <TabsTrigger
        v-for="(item, index) in items"
        :key="item.value"
        :value="item.value"
        :disabled="item.disabled ?? false"
        class="ui-tabs__tab"
        :class="{ 'ui-segment__item': variant === 'segmented' }"
        v-bind="{ ...(item.id && { id: item.id }), ...(item.panelId && { 'aria-controls': item.panelId }) }"
        :aria-describedby="item.count === undefined ? undefined : countId + '-' + index"
      >
        {{ item.label }}
        <span
          v-if="item.count !== undefined"
          :id="countId + '-' + index"
          class="ui-segment__count"
          aria-hidden="true"
          >{{ formatNumber(item.count) }}</span
        >
        <span
          v-if="item.dot || item.error"
          class="ui-segment__dot"
          :class="{ 'ui-tabs__dot--error': item.error }"
          aria-hidden="true"
        ></span>
      </TabsTrigger>
    </TabsList>
    <slot />
  </TabsRoot>
</template>
