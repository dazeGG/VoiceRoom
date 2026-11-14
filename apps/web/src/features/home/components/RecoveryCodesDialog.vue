<script setup lang="ts">
import { useLocalizedText, currentErrorMessage } from '@/shared/i18n/localized-text';

import { t } from '@/shared/i18n';
import { Copy, Download } from '@lucide/vue';
import { ref, watch } from 'vue';
import { generateRecoveryCodes, type RecoveryCodesStatus } from '@/api/auth';
import { Button, Dialog } from '@/shared/ui';
import { iconSm } from '@/shared/ui/icons';
import { recoveryCodesFileText } from '../model/account-security';
import type { ToastOptions } from '../model/toasts.store';

const props = withDefaults(defineProps<{ open: boolean; login: string; replacing?: boolean }>(), {
  replacing: false
});

const emit = defineEmits<{
  close: [];
  generated: [status: RecoveryCodesStatus];
  toast: [message: string, options?: ToastOptions];
}>();

const password = ref('');
const codes = ref<string[]>([]);
const saved = ref(false);
const generating = ref(false);
const error = useLocalizedText();

watch(
  () => props.open,
  (open) => {
    if (!open) return;
    password.value = '';
    codes.value = [];
    saved.value = false;
    error.value = '';
  },
  { immediate: true }
);

// Codes exist on the page only while the dialog shows them.
function close(): void {
  codes.value = [];
  password.value = '';
  emit('close');
}

async function generate(): Promise<void> {
  if (generating.value) return;
  if (!password.value) {
    error.value = () => t('Введите текущий пароль');
    return;
  }
  generating.value = true;
  error.value = '';
  try {
    const result = await generateRecoveryCodes(password.value);
    password.value = '';
    codes.value = result.codes;
    emit('generated', result.recoveryCodes);
  } catch (cause) {
    error.value = () =>
      cause instanceof Error && currentErrorMessage(cause) ? currentErrorMessage(cause) : t('Не удалось создать коды');
  } finally {
    generating.value = false;
  }
}

async function copyCodes(): Promise<void> {
  try {
    await navigator.clipboard.writeText(codes.value.join('\n'));
    emit('toast', t('Коды скопированы'));
  } catch {
    emit('toast', t('Не удалось скопировать коды'), { variant: 'error' });
  }
}

function downloadCodes(): void {
  const url = URL.createObjectURL(
    new Blob([recoveryCodesFileText(codes.value, props.login)], { type: 'text/plain;charset=utf-8' })
  );
  const link = document.createElement('a');
  link.href = url;
  link.download = `voiceroom-recovery-codes-${props.login}.txt`;
  document.body.append(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}
</script>

<template>
  <!-- Opened from the settings modal, whose overlay sits at z-index 60 (_recovery-codes.scss lifts this one). -->
  <Dialog
    :open="open"
    :title="codes.length > 0 ? t('Сохраните коды восстановления') : t('Коды восстановления')"
    :on-close="close"
    :width="480"
    :initial-focus="codes.length > 0 ? '.recovery-dialog__codes' : '#recoveryPasswordInput'"
  >
    <form v-if="codes.length === 0" class="recovery-dialog recovery-dialog__form" @submit.prevent="generate">
      <p class="recovery-dialog__text">
        {{
          t(
            'Если вы забудете пароль, войти можно будет по логину и одному из десяти кодов. Каждый код срабатывает один раз.'
          )
        }}
      </p>
      <p v-if="replacing" class="recovery-dialog__warning">
        {{ t('Новые коды заменят старые — старые сразу перестанут работать.') }}
      </p>
      <div>
        <label class="settings__field-label" for="recoveryPasswordInput">{{ t('Текущий пароль') }}</label>
        <input
          id="recoveryPasswordInput"
          v-model="password"
          class="settings__input"
          type="password"
          autocomplete="current-password"
          placeholder="••••••••"
        />
      </div>
      <p v-if="error" class="recovery-dialog__error" role="alert">{{ error }}</p>
      <div class="home-dialog__actions">
        <Button variant="ghost" type="button" @click="close">{{ t('Отмена') }}</Button>
        <Button variant="primary" type="submit" :disabled="generating">
          {{ generating ? t('Создаём…') : t('Создать коды') }}
        </Button>
      </div>
    </form>
    <div v-else class="recovery-dialog">
      <p class="recovery-dialog__text">
        {{
          t('Коды показываются только сейчас. Сохраните их там, где не потеряете: в менеджере паролей или на бумаге.')
        }}
      </p>
      <ol class="recovery-dialog__codes" tabindex="-1">
        <li v-for="code in codes" :key="code">
          <code>{{ code }}</code>
        </li>
      </ol>
      <div class="recovery-dialog__tools">
        <Button variant="ghost" type="button" @click="copyCodes">
          <template #icon><Copy v-bind="iconSm" aria-hidden="true" /></template> {{ t('Скопировать') }}
        </Button>
        <Button variant="ghost" type="button" @click="downloadCodes">
          <template #icon><Download v-bind="iconSm" aria-hidden="true" /></template> {{ t('Скачать .txt') }}
        </Button>
      </div>
      <label class="recovery-dialog__confirm">
        <input v-model="saved" type="checkbox" />
        <span>{{ t('Я сохранил коды') }}</span>
      </label>
      <div class="home-dialog__actions">
        <Button variant="primary" type="button" :disabled="!saved" @click="close">{{ t('Готово') }}</Button>
      </div>
    </div>
  </Dialog>
</template>
