<script setup lang="ts">
import { Image, Upload } from '@lucide/vue';
import { computed, ref, useId, useTemplateRef } from 'vue';
import { t } from '../../i18n';
import Avatar from '../Avatar/Avatar.vue';
import Button from '../Button/Button.vue';
import type { FileDropProps } from './types';

const props = withDefaults(defineProps<FileDropProps>(), { variant: 'dropzone', validateAccept: true });

const emit = defineEmits<{ files: [files: File[]]; remove: [] }>();
const input = useTemplateRef<HTMLInputElement>('input');
const dragDepth = ref(0);
const captionId = useId();
const acceptRules = computed(() =>
  (props.accept ?? '')
    .toLowerCase()
    .split(',')
    .map((rule) => rule.trim())
    .filter(Boolean)
);

function choose(): void {
  if (!props.disabled) input.value?.click();
}

function report(files: FileList): void {
  if (props.disabled) return;
  const accepted = Array.from(files).filter((file) => !props.validateAccept || matchesAccept(file));
  const selected = props.multiple ? accepted : accepted.slice(0, 1);
  if (selected.length) emit('files', selected);
}

function matchesAccept(file: File): boolean {
  if (!acceptRules.value.length) return true;
  const name = file.name.toLowerCase();
  const mime = file.type.toLowerCase();
  return acceptRules.value.some((rule) => {
    if (rule.startsWith('.')) return name.endsWith(rule);
    if (rule.endsWith('/*')) return mime.startsWith(rule.slice(0, -1));
    return mime === rule;
  });
}

function pick(event: Event): void {
  const target = event.currentTarget;
  if (!(target instanceof HTMLInputElement) || !target.files) return;
  report(target.files);
  target.value = '';
}

function enter(event: DragEvent): void {
  if (props.disabled || !event.dataTransfer?.types.includes('Files')) return;
  dragDepth.value += 1;
}

function leave(): void {
  dragDepth.value = Math.max(0, dragDepth.value - 1);
}

function dragOver(event: DragEvent): void {
  if (event.dataTransfer) event.dataTransfer.dropEffect = props.disabled ? 'none' : 'copy';
}

function drop(event: DragEvent): void {
  dragDepth.value = 0;
  if (event.dataTransfer?.files) report(event.dataTransfer.files);
}
</script>

<template>
  <div
    :class="[
      variant === 'trigger' ? 'ui-dropzone-trigger' : 'ui-dropzone',
      {
        'ui-dropzone--avatar': variant === 'avatar',
        'ui-dropzone--over': variant !== 'trigger' && dragDepth > 0 && !disabled
      }
    ]"
    @dragenter.prevent="enter"
    @dragleave="leave"
    @dragover.prevent="dragOver"
    @drop.prevent="drop"
  >
    <input
      ref="input"
      type="file"
      hidden
      :aria-label="inputLabel"
      :accept="accept"
      :multiple="multiple"
      :disabled="disabled"
      @change="pick"
    />
    <slot v-if="variant === 'trigger'" :choose="choose" />
    <template v-else-if="variant === 'avatar'">
      <div class="ui-dropzone__actions">
        <Avatar v-bind="avatar" :name="avatar?.name ?? t('Аватар')" :size="56" />
        <Button
          size="sm"
          variant="ghost"
          :disabled="disabled"
          :aria-describedby="caption ? captionId : undefined"
          @click="choose"
        >
          <template #icon><Image aria-hidden="true" /></template>
          {{ t('Загрузить') }}
        </Button>
        <Button size="sm" variant="danger-ghost" :disabled="disabled" @click="emit('remove')">
          {{ t('Удалить') }}
        </Button>
      </div>
      <p v-if="caption" :id="captionId" class="ui-dropzone__hint">{{ caption }}</p>
    </template>
    <template v-else>
      <span class="ui-dropzone__icon" aria-hidden="true"><Upload /></span>
      <p class="ui-dropzone__title">{{ t('Перетащите файлы сюда') }}</p>
      <p v-if="caption" :id="captionId" class="ui-dropzone__hint">{{ caption }}</p>
      <Button
        size="sm"
        variant="ghost"
        :disabled="disabled"
        :aria-describedby="caption ? captionId : undefined"
        @click="choose"
      >
        {{ t('Выбрать файл') }}
      </Button>
    </template>
  </div>
</template>
