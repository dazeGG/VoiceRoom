<script setup lang="ts">
import { useLocalizedText, currentErrorMessage } from '@/shared/i18n/localized-text';

import { t } from '@/shared/i18n';
import { computed, ref, useId, watchEffect } from 'vue';
import { AlertDialog, Checkbox, Field, TextField } from '@voice-room/ui/components';
import { fetchAccountDeletionPreview, requestAccountDeletion, type AccountDeletionPreview } from '@/api/auth';
import { useSessionStore } from '@/features/auth/session.store';
import EmojiText from '@/shared/chat/EmojiText.vue';
import { Button, Dialog } from '@/shared/ui';
import { dayMonth } from '@/shared/utils/date-format';
import { displayNameOf } from '@/shared/utils/display-name';
import type { ToastOptions } from '../model/toasts.store';

const props = defineProps<{ open: boolean }>();

const emit = defineEmits<{ close: []; toast: [message: string, options?: ToastOptions] }>();

const DAY_MS = 24 * 60 * 60 * 1000;

const session = useSessionStore();

const preview = ref<AccountDeletionPreview | null>(null);
const formId = useId();
const password = ref('');
const understood = ref(false);
const confirming = ref(false);
const deleting = ref(false);
const error = useLocalizedText();

const graceDays = computed(() => preview.value?.graceDays ?? 7);

watchEffect((onCleanup) => {
  if (!props.open) return;
  password.value = '';
  understood.value = false;
  confirming.value = false;
  error.value = '';
  preview.value = null;
  let cancelled = false;
  void fetchAccountDeletionPreview()
    .then((result) => {
      if (!cancelled) preview.value = result;
    })
    .catch((cause: unknown) => {
      if (!cancelled)
        error.value = () =>
          cause instanceof Error && currentErrorMessage(cause)
            ? currentErrorMessage(cause)
            : t('Не удалось подготовить удаление');
    });
  onCleanup(() => {
    cancelled = true;
  });
});

function requestConfirmation(): void {
  if (deleting.value || !understood.value || !password.value) return;
  error.value = '';
  confirming.value = true;
}

function cancelConfirmation(): void {
  if (!deleting.value) confirming.value = false;
}

async function confirmDeletion(): Promise<void> {
  if (deleting.value || !understood.value || !password.value) return;
  deleting.value = true;
  error.value = '';
  // The server ends every session of the account, this one included.
  session.expectSessionEnd();
  try {
    const { deletionScheduledFor } = await requestAccountDeletion(password.value);
    password.value = '';
    confirming.value = false;
    session.clearSession();
    emit(
      'toast',
      t('Аккаунт будет удалён {p0}. Передумали — просто войдите снова', { p0: dayMonth(deletionScheduledFor) })
    );
  } catch (cause) {
    session.expectSessionEnd(false);
    error.value = () =>
      cause instanceof Error && currentErrorMessage(cause)
        ? currentErrorMessage(cause)
        : t('Не удалось удалить аккаунт');
  } finally {
    deleting.value = false;
  }
}
</script>

<template>
  <Dialog
    :open="open"
    :title="t('Удалить аккаунт')"
    :on-close="() => emit('close')"
    :close-disabled="deleting"
    initial-focus="#deleteAccountPassword"
  >
    <form :id="formId" class="delete-account" @submit.prevent="requestConfirmation">
      <p class="delete-account__text">
        {{ t('Аккаунт сразу скроется, а все сеансы завершатся. До') }} {{ dayMonth(Date.now() + graceDays * DAY_MS) }}
        {{ t('его можно восстановить, просто войдя с паролем. После этого удаление окончательное:') }}
      </p>
      <ul class="delete-account__list">
        <li>{{ t('друзья, заявки, блокировки, настройки и коды восстановления удалятся;') }}</li>
        <li>{{ t('ваши сообщения останутся у собеседников от имени «Удалённый аккаунт»;') }}</li>
        <li>{{ t('занять этот логин снова будет нельзя.') }}</li>
      </ul>

      <div v-if="preview && preview.rooms.length > 0" class="delete-account__rooms">
        <span class="settings__field-label"
          >{{ t('Ваши постоянные комнаты через') }} {{ graceDays }} {{ t('дней') }}</span
        >
        <div v-for="room in preview.rooms" :key="room.roomId" class="delete-account__room">
          <strong class="delete-account__room-name"
            ><EmojiText :text="room.name || t('Комната без названия')"
          /></strong>
          <small class="delete-account__room-fate">
            <EmojiText
              :text="
                room.heir
                  ? t('перейдёт к {p0} — самому давнему участнику', { p0: displayNameOf(room.heir) })
                  : t('удалится: других участников нет')
              "
            />
          </small>
        </div>
      </div>

      <Field id="deleteAccountPassword" :label="t('Текущий пароль')">
        <TextField
          v-model="password"
          size="lg"
          type="password"
          autocomplete="current-password"
          placeholder="••••••••"
        />
      </Field>

      <Checkbox :model-value="understood" @update:model-value="understood = $event === true">
        {{ t('Я понимаю, что через') }} {{ graceDays }} {{ t('дней аккаунт удалится навсегда') }}
      </Checkbox>

      <p v-if="error && !confirming" class="delete-account__error" role="alert">{{ error }}</p>
    </form>

    <template #footer>
      <Button variant="ghost" @click="emit('close')">{{ t('Отмена') }}</Button>
      <Button variant="danger-ghost" type="submit" :form="formId" :disabled="!understood || !password">
        {{ t('Удалить аккаунт') }}
      </Button>
    </template>

    <AlertDialog
      :open="confirming"
      :title="t('Удалить аккаунт?')"
      :description="
        t('Аккаунт скроется, и все сеансы завершатся. Восстановить аккаунт можно до {p0}.', {
          p0: dayMonth(Date.now() + graceDays * DAY_MS)
        })
      "
      :confirm-label="deleting ? t('Удаляем…') : t('Удалить')"
      tone="danger"
      :busy="deleting"
      @cancel="cancelConfirmation"
      @confirm="confirmDeletion"
    >
      <p v-if="error" class="delete-account__error" role="alert">{{ error }}</p>
    </AlertDialog>
  </Dialog>
</template>
