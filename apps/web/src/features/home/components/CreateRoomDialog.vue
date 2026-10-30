<script setup lang="ts">
import { Check, Clock } from '@lucide/vue';
import { ref, watch } from 'vue';
import { Button, Dialog } from '@/shared/ui';
import { iconSm } from '@/shared/ui/icons';

const props = defineProps<{ open: boolean; creating: boolean }>();

const emit = defineEmits<{ close: []; create: [payload: { name: string; isStatic: boolean }] }>();

const tab = ref<'permanent' | 'temp'>('permanent');
const name = ref('');
const error = ref('');
const permanentTab = ref<HTMLButtonElement | null>(null);
const tempTab = ref<HTMLButtonElement | null>(null);

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
    error.value = 'Дайте комнате название';
    return;
  }
  emit('create', {
    name: trimmed,
    isStatic: tab.value === 'permanent'
  });
}

function selectTab(nextTab: 'permanent' | 'temp', focus = false): void {
  tab.value = nextTab;
  if (focus) queueMicrotask(() => (nextTab === 'permanent' ? permanentTab.value : tempTab.value)?.focus());
}

function onTabsKeydown(event: KeyboardEvent): void {
  if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') {
    event.preventDefault();
    selectTab(tab.value === 'permanent' ? 'temp' : 'permanent', true);
  } else if (event.key === 'ArrowRight' || event.key === 'ArrowDown') {
    event.preventDefault();
    selectTab(tab.value === 'permanent' ? 'temp' : 'permanent', true);
  } else if (event.key === 'Home') {
    event.preventDefault();
    selectTab('permanent', true);
  } else if (event.key === 'End') {
    event.preventDefault();
    selectTab('temp', true);
  }
}
</script>

<template>
  <Dialog
    :open="open"
    title="Новая комната"
    :on-close="() => emit('close')"
    :width="430"
    initial-focus="#createRoomPermanentTab"
  >
    <div class="create-room__tabs" role="tablist" aria-label="Тип комнаты" tabindex="-1" @keydown="onTabsKeydown">
      <button
        id="createRoomPermanentTab"
        ref="permanentTab"
        class="create-room__tab"
        role="tab"
        :aria-selected="tab === 'permanent'"
        aria-controls="createRoomPermanentPanel"
        type="button"
        :tabindex="tab === 'permanent' ? 0 : -1"
        @click="selectTab('permanent')"
      >
        Постоянная
      </button>
      <button
        id="createRoomTempTab"
        ref="tempTab"
        class="create-room__tab"
        role="tab"
        :aria-selected="tab === 'temp'"
        aria-controls="createRoomTempPanel"
        type="button"
        :tabindex="tab === 'temp' ? 0 : -1"
        @click="selectTab('temp')"
      >
        Временная
      </button>
    </div>

    <form class="create-room__form" @submit.prevent="submit">
      <p v-if="error" class="create-room__error" role="alert">{{ error }}</p>

      <div class="create-room__field">
        <label class="create-room__label" for="createRoomName">
          Название<span v-if="tab === 'temp'" class="create-room__label-soft"> · необязательно</span>
        </label>
        <input
          id="createRoomName"
          v-model="name"
          class="create-room__input"
          maxlength="60"
          :placeholder="tab === 'permanent' ? 'Название комнаты' : 'Название созвона'"
        />
      </div>

      <div
        v-if="tab === 'permanent'"
        id="createRoomPermanentPanel"
        class="create-room__note create-room__note--ok"
        role="tabpanel"
        aria-labelledby="createRoomPermanentTab"
      >
        <Check v-bind="iconSm" aria-hidden="true" />
        <span>Всегда остаётся в вашем списке — заходите в любой момент.</span>
      </div>
      <div
        v-else
        id="createRoomTempPanel"
        class="create-room__note create-room__note--warn"
        role="tabpanel"
        aria-labelledby="createRoomTempTab"
      >
        <Clock v-bind="iconSm" aria-hidden="true" />
        <span>Код появится после создания. После выхода всех участников комната исчезнет примерно через 15 минут.</span>
      </div>

      <div class="home-dialog__actions">
        <Button variant="ghost" type="button" @click="emit('close')">Отмена</Button>
        <Button variant="primary" type="submit" :disabled="creating">
          <span v-if="creating" class="home-spinner" aria-hidden="true"></span>
          {{ tab === 'permanent' ? 'Создать комнату' : 'Создать на время' }}
        </Button>
      </div>
    </form>
  </Dialog>
</template>
