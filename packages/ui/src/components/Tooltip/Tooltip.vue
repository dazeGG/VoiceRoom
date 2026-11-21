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
      <TooltipPortal>
        <TooltipContent class="ui-tooltip" :side="side" :side-offset="6" :aria-label="text">
          <span class="ui-tooltip__text">{{ text }}</span>
          <Kbd v-if="shortcut?.length" :keys="shortcut" />
        </TooltipContent>
      </TooltipPortal>
    </TooltipRoot>
  </TooltipProvider>
</template>
