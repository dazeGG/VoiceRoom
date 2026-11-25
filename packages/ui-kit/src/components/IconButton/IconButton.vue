<script setup lang="ts">
import { computed } from 'vue';
import { t } from '../../i18n';
import Tooltip from '../Tooltip/Tooltip.vue';
import type { IconButtonProps } from './types';

defineOptions({ inheritAttrs: false });

const props = withDefaults(defineProps<IconButtonProps>(), {
  size: 32,
  variant: 'default',
  tooltip: true,
  disabled: false,
  type: 'button'
});

const emit = defineEmits<{ click: [event: MouseEvent] }>();
const accessibleLabel = computed(() =>
  props.tooltipDescription
    ? t('{label}. {description}', { label: props.label, description: props.tooltipDescription })
    : props.label
);
</script>

<template>
  <Tooltip
    v-if="tooltip"
    :text="label"
    :description="tooltipDescription"
    :description-in-label="Boolean(tooltipDescription)"
    :side="tooltipSide"
    :shortcut="shortcut"
    :portal-target="tooltipTarget"
  >
    <component
      :is="href ? 'a' : 'button'"
      v-bind="tooltipDescription ? { 'aria-describedby': null, ...$attrs } : $attrs"
      :class="[
        'ui-icon-button',
        `ui-icon-button--${variant}`,
        `ui-icon-button--size-${size}`,
        {
          'ui-icon-button--scrim': scrim,
          'ui-icon-button--pill': pill,
          'ui-icon-button--neutral-expanded': neutralExpanded
        }
      ]"
      :href="href && !disabled ? href : undefined"
      :type="href ? undefined : type"
      :disabled="href ? undefined : disabled"
      :aria-disabled="href && disabled ? true : undefined"
      :aria-label="accessibleLabel"
      @click="
        (event: MouseEvent) => {
          if (!disabled) emit('click', event);
        }
      "
    >
      <slot />
      <span v-if="dot" class="ui-icon-button__dot" aria-hidden="true" />
    </component>
  </Tooltip>
  <component
    :is="href ? 'a' : 'button'"
    v-else
    v-bind="$attrs"
    :class="[
      'ui-icon-button',
      `ui-icon-button--${variant}`,
      `ui-icon-button--size-${size}`,
      {
        'ui-icon-button--scrim': scrim,
        'ui-icon-button--pill': pill,
        'ui-icon-button--neutral-expanded': neutralExpanded
      }
    ]"
    :href="href && !disabled ? href : undefined"
    :type="href ? undefined : type"
    :disabled="href ? undefined : disabled"
    :aria-disabled="href && disabled ? true : undefined"
    :aria-label="accessibleLabel"
    @click="
      (event: MouseEvent) => {
        if (!disabled) emit('click', event);
      }
    "
  >
    <slot />
    <span v-if="dot" class="ui-icon-button__dot" aria-hidden="true" />
  </component>
</template>
