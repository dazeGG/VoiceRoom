<script setup lang="ts">
import { Spinner, Tabs, TabsPanel, type TabOption } from '@voice-room/ui/components';
import { useLocalizedText } from '@/shared/i18n/localized-text';

import { t } from '@/shared/i18n';
import { Check, Clock } from '@lucide/vue';
import { computed, ref, useId, watch } from 'vue';
import { Button, Dialog } from '@/shared/ui';
import { iconSm } from '@/shared/ui/icons';

const props = defineProps<{ open: boolean; creating: boolean }>();

const emit = defineEmits<{ close: []; create: [payload: { name: string; isStatic: boolean }] }>();

const tab = ref<'permanent' | 'temp'>('permanent');
const formId = useId();
const name = ref('');
const error = useLocalizedText();
const items = computed<TabOption<'permanent' | 'temp'>[]>(() => [
  { value: 'permanent', label: t('Постоянная'), error: Boolean(error.value) },
  { value: 'temp', label: t('Временная') }
]);

// Reset the form each time the dialog opens.
watch(
  () => props.open,
  (open) => {
    if (!open) return;
    tab.value = 'permanent';
    name.value = '';
    error.value = '';
  },
  { immediate: true }
);

function submit(): void {
  if (props.creating) return;
  const trimmed = name.value.trim();
  if (tab.value === 'permanent' && !trimmed) {
    error.value = () => t('Дайте комнате название');
    return;
  }
  emit('create', {
    name: trimmed,
    isStatic: tab.value === 'permanent'
  });
}
</script>

<template>
  <Dialog
    :open="open"
    :title="t('Новая комната')"
    :on-close="() => emit('close')"
    size="sm"
    initial-focus="[role='tab'][aria-selected='true']"
  >
    <form :id="formId" @submit.prevent="submit">
      <Tabs v-model="tab" :items="items" :label="t('Тип комнаты')" stretch>
        <TabsPanel v-for="item in items" :key="item.value" :value="item.value">
          <div class="create-room__form">
            <p v-if="item.value === 'permanent' && error" class="create-room__error" role="alert">{{ error }}</p>
            <div class="create-room__field">
              <label class="create-room__label" :for="formId + '-' + item.value">
                {{ t('Название') }}
                <span v-if="item.value === 'temp'" class="create-room__label-soft">{{ t('· необязательно') }}</span>
              </label>
              <input
                :id="formId + '-' + item.value"
                v-model="name"
                class="create-room__input"
                maxlength="60"
                :placeholder="item.value === 'permanent' ? t('Название комнаты') : t('Название созвона')"
              />
            </div>
            <div v-if="item.value === 'permanent'" class="create-room__note create-room__note--ok">
              <Check v-bind="iconSm" aria-hidden="true" />
              <span>{{ t('Всегда остаётся в вашем списке — заходите в любой момент.') }}</span>
            </div>
            <div v-else class="create-room__note create-room__note--warn">
              <Clock v-bind="iconSm" aria-hidden="true" />
              <span>{{
                t('Код появится после создания. После выхода всех участников комната исчезнет примерно через 15 минут.')
              }}</span>
            </div>
          </div>
        </TabsPanel>
      </Tabs>
    </form>
    <template #footer>
      <Button variant="ghost" type="button" @click="emit('close')">{{ t('Отмена') }}</Button>
      <Button variant="primary" type="submit" :form="formId" :disabled="creating">
        <Spinner v-if="creating" aria-hidden="true" />
        {{ tab === 'permanent' ? t('Создать комнату') : t('Создать на время') }}
      </Button>
    </template>
  </Dialog>
</template>
