<script setup lang="ts">
import {
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogPortal,
  AlertDialogRoot,
  AlertDialogTitle
} from 'reka-ui';
import { t } from '../../i18n';
import Button from '../Button/Button.vue';
import type { AlertDialogProps } from './types';

withDefaults(defineProps<AlertDialogProps>(), { tone: 'default' });

const emit = defineEmits<{ confirm: []; cancel: [] }>();

function onOpenChange(next: boolean): void {
  if (!next) emit('cancel');
}
</script>

<template>
  <AlertDialogRoot :open="open" @update:open="onOpenChange">
    <AlertDialogPortal>
      <div v-if="open" class="ui-overlay ui-overlay--alert">
        <AlertDialogContent class="ui-dialog ui-dialog--sm ui-dialog--alert" aria-modal="true">
          <header class="ui-dialog__head">
            <div class="ui-dialog__titles">
              <AlertDialogTitle as="h2" class="ui-dialog__title">{{ title }}</AlertDialogTitle>
              <AlertDialogDescription class="ui-dialog__desc">{{ description }}</AlertDialogDescription>
            </div>
          </header>
          <div v-if="$slots.default" class="ui-dialog__body">
            <slot />
          </div>
          <footer class="ui-dialog__foot">
            <AlertDialogCancel as-child>
              <Button variant="ghost">{{ cancelLabel ?? t('Отмена') }}</Button>
            </AlertDialogCancel>
            <Button :variant="tone === 'danger' ? 'danger' : 'primary'" :busy="busy" @click="emit('confirm')">
              {{ confirmLabel }}
            </Button>
          </footer>
        </AlertDialogContent>
      </div>
    </AlertDialogPortal>
  </AlertDialogRoot>
</template>
