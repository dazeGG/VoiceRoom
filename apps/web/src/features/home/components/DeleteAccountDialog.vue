<script setup lang="ts">
import { useLocalizedText, currentErrorMessage } from '@/shared/i18n/localized-text';

import { t } from '@/shared/i18n';
import { computed, ref, watchEffect } from 'vue';
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
const password = ref('');
const understood = ref(false);
const deleting = ref(false);
const error = useLocalizedText();

const graceDays = computed(() => preview.value?.graceDays ?? 7);

watchEffect((onCleanup) => {
  if (!props.open) return;
  password.value = '';
  understood.value = false;
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

async function confirmDeletion(): Promise<void> {
  if (deleting.value || !understood.value || !password.value) return;
  deleting.value = true;
  error.value = '';
  // The server ends every session of the account, this one included.
  session.expectSessionEnd();
  try {
    const { deletionScheduledFor } = await requestAccountDeletion(password.value);
    password.value = '';
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
    :width="500"
    initial-focus="#deleteAccountPassword"
  >
    <form class="delete-account" @submit.prevent="confirmDeletion">
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

      <div>
        <label class="settings__field-label" for="deleteAccountPassword">{{ t('Текущий пароль') }}</label>
        <input
          id="deleteAccountPassword"
          v-model="password"
          class="settings__input"
          type="password"
          autocomplete="current-password"
          placeholder="••••••••"
        />
      </div>

      <label class="delete-account__confirm">
        <input v-model="understood" type="checkbox" />
        <span>{{ t('Я понимаю, что через') }} {{ graceDays }} {{ t('дней аккаунт удалится навсегда') }}</span>
      </label>

      <p v-if="error" class="delete-account__error" role="alert">{{ error }}</p>

      <div class="home-dialog__actions">
        <Button variant="ghost" type="button" @click="emit('close')">{{ t('Отмена') }}</Button>
        <button class="delete-account__submit" type="submit" :disabled="deleting || !understood || !password">
          {{ deleting ? t('Удаляем…') : t('Удалить аккаунт') }}
        </button>
      </div>
    </form>
  </Dialog>
</template>
