<script setup lang="ts">
import { TooltipContent, TooltipPortal, TooltipProvider, TooltipRoot, TooltipTrigger } from 'reka-ui';
import Kbd from '../Kbd/Kbd.vue';
import type { TooltipProps } from './types';

defineOptions({ inheritAttrs: false });

withDefaults(defineProps<TooltipProps>(), { side: 'top' });
</script>

<template>
  <TooltipProvider :delay-duration="400">
    <TooltipRoot>
      <TooltipTrigger as-child v-bind="$attrs"><slot /></TooltipTrigger>
      <TooltipPortal :to="portalTarget ?? 'body'">
        <TooltipContent
          :class="['ui-tooltip', { 'ui-tooltip--described': description }]"
          :side="side"
          :side-offset="6"
          :aria-label="description || text"
          :aria-hidden="descriptionInLabel || undefined"
        >
          <span class="ui-tooltip__copy">
            <span class="ui-tooltip__text">{{ text }}</span>
            <span v-if="description" class="ui-tooltip__description">{{ description }}</span>
          </span>
          <Kbd v-if="shortcut?.length" :keys="shortcut" />
        </TooltipContent>
      </TooltipPortal>
    </TooltipRoot>
  </TooltipProvider>
</template>
