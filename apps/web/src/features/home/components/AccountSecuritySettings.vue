<script setup lang="ts">
import { Field, Spinner, SettingRow, SettingsGroup, TextField } from '@voice-room/ui/components';
import { t } from '@/shared/i18n';
import { KeyRound, Laptop, MonitorSmartphone } from '@lucide/vue';
import { computed, onMounted, ref, watch } from 'vue';
import {
  changePassword,
  fetchAccountSecurity,
  fetchAccountSessions,
  revokeAccountSession,
  revokeOtherAccountSessions,
  type AccountSession,
  type RecoveryCodesStatus
} from '@/api/auth';
import { isValidPassword, PASSWORD_MIN_LENGTH } from '@/features/auth/account';
import { useSessionStore } from '@/features/auth/session.store';
import { iconMd } from '@/shared/ui/icons';
import { formatLastSeen, recoveryCodesSummary, sessionDeviceLabel } from '../model/account-security';
import type { ToastOptions } from '../model/toasts.store';
import RecoveryCodesDialog from './RecoveryCodesDialog.vue';
import DeleteAccountDialog from './DeleteAccountDialog.vue';

const props = withDefaults(
  defineProps<{
    login: string;
    // Set when the lobby reminder brought the user here.
    highlightRecoveryCodes?: boolean;
    // Set after "Это не я" on a new sign-in.
    highlightPassword?: boolean;
  }>(),
  { highlightRecoveryCodes: false, highlightPassword: false }
);

const emit = defineEmits<{ toast: [message: string, options?: ToastOptions] }>();

const { expectSessionEnd, clearSession } = useSessionStore();

const recoveryCodesButton = ref<HTMLButtonElement>();
const currentPasswordInput = ref<{ input: HTMLInputElement | null }>();

const recoveryCodes = ref<RecoveryCodesStatus | null>(null);
const sessions = ref<AccountSession[]>([]);
const loading = ref(true);
const endingSessionId = ref('');
const endingOthers = ref(false);
const codesDialogOpen = ref(false);
const deleteDialogOpen = ref(false);
const currentPassword = ref('');
const newPassword = ref('');
const changingPassword = ref(false);

const hasOtherSessions = computed(() => sessions.value.some((session) => !session.current));
const lowOnCodes = computed(() =>
  Boolean(recoveryCodes.value && recoveryCodes.value.remaining > 0 && recoveryCodes.value.remaining <= 2)
);

const recoveryCodesHighlighted = computed(() => props.highlightRecoveryCodes && recoveryCodes.value?.remaining === 0);

watch(
  recoveryCodesHighlighted,
  (highlighted) => {
    if (highlighted) recoveryCodesButton.value?.scrollIntoView({ block: 'center', behavior: 'smooth' });
  },
  { flush: 'post' }
);

watch(
  [() => props.highlightPassword, currentPasswordInput],
  ([highlight, field], _before, onCleanup) => {
    const input = field?.input;
    if (!highlight || !input) return;
    // After the settings dialog has placed its own initial focus.
    const timer = window.setTimeout(() => {
      input.scrollIntoView({ block: 'center', behavior: 'smooth' });
      input.focus();
    }, 80);
    onCleanup(() => window.clearTimeout(timer));
  },
  { immediate: true, flush: 'post' }
);

onMounted(() => {
  void load();
});

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}

async function load(): Promise<void> {
  loading.value = true;
  try {
    const [security, list] = await Promise.all([fetchAccountSecurity(), fetchAccountSessions()]);
    recoveryCodes.value = security.recoveryCodes;
    sessions.value = list;
  } catch (error) {
    emit('toast', errorMessage(error, t('Не удалось загрузить настройки безопасности')), { variant: 'error' });
  } finally {
    loading.value = false;
  }
}

async function submitPasswordChange(): Promise<void> {
  if (changingPassword.value) return;
  if (!currentPassword.value) {
    emit('toast', t('Введите текущий пароль'));
    return;
  }
  if (!isValidPassword(newPassword.value)) {
    emit('toast', t('Новый пароль: минимум {p0} символов', { p0: PASSWORD_MIN_LENGTH }));
    return;
  }
  changingPassword.value = true;
  // The server ends every session of the account, this one included.
  expectSessionEnd();
  try {
    await changePassword(currentPassword.value, newPassword.value);
    currentPassword.value = '';
    newPassword.value = '';
    clearSession();
    emit('toast', t('Пароль изменён, войдите снова'));
  } catch (error) {
    expectSessionEnd(false);
    emit('toast', errorMessage(error, t('Не удалось сменить пароль')), { variant: 'error' });
  } finally {
    changingPassword.value = false;
  }
}

async function endSession(session: AccountSession): Promise<void> {
  if (endingSessionId.value || endingOthers.value) return;
  endingSessionId.value = session.id;
  try {
    await revokeAccountSession(session.id);
    sessions.value = sessions.value.filter((entry) => entry.id !== session.id);
    emit('toast', t('Сеанс завершён'));
  } catch (error) {
    emit('toast', errorMessage(error, t('Не удалось завершить сеанс')), { variant: 'error' });
  } finally {
    endingSessionId.value = '';
  }
}

async function endOtherSessions(): Promise<void> {
  if (endingSessionId.value || endingOthers.value) return;
  endingOthers.value = true;
  try {
    const ended = await revokeOtherAccountSessions();
    sessions.value = sessions.value.filter((session) => session.current);
    emit('toast', ended > 0 ? t('Завершено сеансов: {p0}', { p0: ended }) : t('Других сеансов нет'));
  } catch (error) {
    emit('toast', errorMessage(error, t('Не удалось завершить сеансы')), { variant: 'error' });
  } finally {
    endingOthers.value = false;
  }
}
</script>

<template>
  <div class="account-security">
    <SettingsGroup :heading="t('Пароль')">
      <form class="account-security__password" @submit.prevent="submitPasswordChange">
        <div class="settings__password-fields">
          <Field :label="t('Текущий пароль')">
            <TextField
              ref="currentPasswordInput"
              v-model="currentPassword"
              name="current-password"
              type="password"
              placeholder="••••••••"
              autocomplete="current-password"
            />
          </Field>
          <Field :label="t('Новый пароль')">
            <TextField
              v-model="newPassword"
              name="new-password"
              type="password"
              :placeholder="t('Минимум {p0} символов', { p0: PASSWORD_MIN_LENGTH })"
              autocomplete="new-password"
            />
          </Field>
        </div>
        <div class="account-security__password-foot">
          <div class="settings__gate-hint">{{ t('После смены пароля завершатся все сеансы, включая этот.') }}</div>
          <button
            class="settings__save account-security__action"
            :class="{ 'account-security__action--highlight': highlightPassword }"
            type="submit"
            :disabled="changingPassword || !currentPassword || !newPassword"
          >
            <Spinner v-if="changingPassword" aria-hidden="true" /> {{ t('Сменить пароль') }}
          </button>
        </div>
      </form>
    </SettingsGroup>

    <SettingsGroup :heading="t('Коды восстановления')">
      <div v-if="loading && !recoveryCodes" class="settings__notification-empty" role="status">
        {{ t('Загружаем…') }}
      </div>
      <template v-else-if="recoveryCodes">
        <SettingRow
          :class="{ 'account-security__row--warning': recoveryCodes.remaining === 0 || lowOnCodes }"
          :label="recoveryCodes.remaining > 0 ? t('Коды созданы') : t('Коды не созданы')"
          :description="recoveryCodesSummary(recoveryCodes)"
        >
          <template #leading>
            <span class="account-security__icon" aria-hidden="true"><KeyRound v-bind="iconMd" /></span>
          </template>
          <template #control>
            <button
              ref="recoveryCodesButton"
              class="settings__save account-security__action"
              :class="{ 'account-security__action--highlight': recoveryCodesHighlighted }"
              type="button"
              @click="codesDialogOpen = true"
            >
              {{ recoveryCodes.generatedAt ? t('Создать новые') : t('Создать коды') }}
            </button>
          </template>
        </SettingRow>
        <div v-if="lowOnCodes" class="settings__gate-hint">
          {{ t('Кодов почти не осталось — создайте новый набор.') }}
        </div>
      </template>
    </SettingsGroup>

    <SettingsGroup
      :heading="t('Устройства')"
      :description="t('Где открыт ваш аккаунт. Незнакомый сеанс завершите — пароль после этого лучше сменить.')"
    >
      <template v-if="hasOtherSessions" #actions>
        <button
          class="settings__unblock-button"
          type="button"
          :disabled="endingOthers || Boolean(endingSessionId)"
          @click="void endOtherSessions()"
        >
          {{ endingOthers ? t('Завершаем…') : t('Выйти на других устройствах') }}
        </button>
      </template>
      <div v-if="loading && sessions.length === 0" class="settings__notification-empty" role="status">
        {{ t('Загружаем…') }}
      </div>
      <template v-else-if="sessions.length > 0">
        <SettingRow
          v-for="session in sessions"
          :key="session.id"
          role="group"
          :aria-label="sessionDeviceLabel(session)"
          :label="sessionDeviceLabel(session)"
        >
          <template #leading>
            <span class="account-security__icon" aria-hidden="true">
              <MonitorSmartphone v-if="session.client === 'VoiceRoom Desktop'" v-bind="iconMd" />
              <Laptop v-else v-bind="iconMd" />
            </span>
          </template>
          <template #description>
            {{ session.current ? t('Это устройство') : formatLastSeen(session.lastSeenAt)
            }}{{ session.location ? ` · ${session.location}` : '' }}
          </template>
          <template v-if="!session.current" #control>
            <button
              class="settings__unblock-button"
              type="button"
              :disabled="endingOthers || Boolean(endingSessionId)"
              @click="void endSession(session)"
            >
              {{ endingSessionId === session.id ? t('Завершаем…') : t('Завершить') }}
            </button>
          </template>
        </SettingRow>
      </template>
      <div v-else class="settings__notification-empty">{{ t('Активных сеансов нет.') }}</div>
      <div v-if="sessions.some((session) => session.location)" class="settings__gate-hint">
        {{ t('Город определяется по IP-адресу с помощью') }}
        <a href="https://db-ip.com" target="_blank" rel="noreferrer">DB-IP</a>{{ t('; сам адрес не сохраняется.') }}
      </div>
    </SettingsGroup>

    <SettingsGroup :heading="t('Удаление аккаунта')">
      <SettingRow
        :description="
          t('Аккаунт скроется сразу и удалится через 7 дней. До этого его можно восстановить, войдя с паролем.')
        "
      >
        <template #control>
          <button class="settings__unblock-button" type="button" @click="deleteDialogOpen = true">
            {{ t('Удалить аккаунт') }}
          </button>
        </template>
      </SettingRow>
    </SettingsGroup>
  </div>

  <DeleteAccountDialog
    :open="deleteDialogOpen"
    @close="deleteDialogOpen = false"
    @toast="(...args) => emit('toast', ...args)"
  />

  <RecoveryCodesDialog
    :open="codesDialogOpen"
    :login="login"
    :replacing="Boolean(recoveryCodes?.generatedAt && recoveryCodes.remaining > 0)"
    @close="codesDialogOpen = false"
    @generated="(status: RecoveryCodesStatus) => (recoveryCodes = status)"
    @toast="(...args) => emit('toast', ...args)"
  />
</template>
