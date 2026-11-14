<script setup lang="ts">
import { useLocalizedText, currentErrorMessage } from '@/shared/i18n/localized-text';

import { t } from '@/shared/i18n';
import LanguageControl from '@/shared/i18n/LanguageControl.vue';
import { CircleAlert, X } from '@lucide/vue';
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import { normalizeRecoveryCode } from '@voice-room/shared/account-security';
import { AccountFailure } from '@voice-room/shared/contracts/account';
import { login, recoverAccount, register, restoreAccount, type AuthUser } from '@/api/auth';
import { ApiError, failureBody } from '@/api/client';
import { APP_HOME } from '@/shared/app-home';
import { dayMonth } from '@/shared/utils/date-format';
import { iconMd } from '@/shared/ui/icons';
import { LOGIN_HINT, PASSWORD_MIN_LENGTH, blockedMessage, isValidPassword, normalizeLogin } from './account';
import type { AuthMode } from './auth-mode';
import PasswordField from './PasswordField.vue';
import { useSessionStore } from './session.store';

const props = defineProps<{
  /**
   * Takes over what happens after signing in. When set, the dialog neither
   * stores the user nor navigates: a room hands the account to a clean reload,
   * because swapping the session in place would unmount the live call.
   */
  onAuthenticated?: (user: AuthUser) => Promise<void> | void;
}>();

const mode = defineModel<AuthMode>('mode', { required: true });

const emit = defineEmits<{ close: [] }>();

const COPY: Record<AuthMode, { title: string; subtitle: string; submit: string; submitting: string; failure: string }> =
  {
    get login() {
      return {
        title: t('Вход'),
        subtitle: t('Продолжите с сохранёнными комнатами и именем.'),
        submit: t('Войти'),
        submitting: t('Входим…'),
        failure: t('Не удалось войти')
      };
    },
    get register() {
      return {
        title: t('Создать аккаунт'),
        subtitle: t('Сохраняйте комнаты, историю и своё имя.'),
        submit: t('Создать аккаунт'),
        submitting: t('Создаём…'),
        failure: t('Не удалось создать аккаунт')
      };
    },
    get recover() {
      return {
        title: t('Восстановить доступ'),
        subtitle: t('Введите логин, один из кодов восстановления и новый пароль. Код сработает только один раз.'),
        submit: t('Сменить пароль и войти'),
        submitting: t('Восстанавливаем…'),
        failure: t('Не удалось восстановить доступ')
      };
    }
  };

const router = useRouter();
const session = useSessionStore();

const dialog = ref<HTMLDialogElement | null>(null);
const loginInput = ref<HTMLInputElement | null>(null);
const loginValue = ref('');
const displayName = ref('');
const recoveryCode = ref('');
const password = ref('');
const passwordConfirm = ref('');
const error = useLocalizedText();
const submitting = ref(false);
// Set when the account signing in is waiting to be deleted: the dialog offers
// to restore it instead of an error.
const pendingDeletionAt = ref<number | null>(null);

const isLogin = computed(() => mode.value === 'login');
const isRegister = computed(() => mode.value === 'register');
const isRecover = computed(() => mode.value === 'recover');
const copy = computed(() => COPY[mode.value]);

onMounted(() => {
  dialog.value?.showModal();
  queueMicrotask(() => loginInput.value?.focus());
});

onBeforeUnmount(() => {
  if (dialog.value?.open) dialog.value.close();
});

function handleBackdropClick(event: MouseEvent): void {
  if (event.target === dialog.value) emit('close');
}

function handleCancel(): void {
  emit('close');
}

function switchMode(nextMode: AuthMode): void {
  if (submitting.value) return;
  mode.value = nextMode;
}

function validate(): string {
  if (isRegister.value && !normalizeLogin(loginValue.value)) return t('Логин: {p0}', { p0: t(LOGIN_HINT) });
  if (isRecover.value && !normalizeLogin(loginValue.value)) return t('Введите логин аккаунта');
  if (isRecover.value && !normalizeRecoveryCode(recoveryCode.value))
    return t('Код восстановления — 16 символов, например ABCD-EFGH-JKMN-PQRS');
  if (!isLogin.value && !isValidPassword(password.value))
    return t('Пароль должен быть не короче {p0} символов', { p0: PASSWORD_MIN_LENGTH });
  if (!isLogin.value && password.value !== passwordConfirm.value) return t('Пароли не совпадают');
  return '';
}

// Returns true when the caller is taking the page elsewhere, so the form stays
// disabled instead of inviting a second submit while the page leaves.
async function finish(user: AuthUser): Promise<boolean> {
  if (props.onAuthenticated) {
    await props.onAuthenticated(user);
    return true;
  }
  session.setUser(user);
  await router.push(APP_HOME);
  return false;
}

async function handleSubmit(): Promise<void> {
  if (submitting.value) return;

  error.value = () => validate();
  if (error.value) return;

  submitting.value = true;
  let leaving = false;
  try {
    if (isRecover.value) {
      const recovered = await recoverAccount({
        login: loginValue.value.trim(),
        code: recoveryCode.value,
        newPassword: password.value
      });
      leaving = await finish(recovered.user);
    } else {
      const user = isLogin.value
        ? await login({ login: loginValue.value.trim(), password: password.value })
        : await register({
            login: loginValue.value.trim(),
            displayName: displayName.value.trim(),
            password: password.value,
            passwordConfirm: passwordConfirm.value
          });
      leaving = await finish(user);
    }
  } catch (cause) {
    if (cause instanceof ApiError && cause.code === 'account_blocked') {
      error.value = () => blockedMessage(failureBody(cause, AccountFailure) ?? {});
      return;
    }
    if (isLogin.value && cause instanceof ApiError && cause.code === 'account_deletion_pending') {
      pendingDeletionAt.value = failureBody(cause, AccountFailure)?.deletionScheduledFor || null;
      return;
    }
    error.value = () =>
      cause instanceof Error && currentErrorMessage(cause) ? currentErrorMessage(cause) : copy.value.failure;
  } finally {
    if (!leaving) submitting.value = false;
  }
}

async function restorePendingAccount(): Promise<void> {
  if (submitting.value) return;
  submitting.value = true;
  error.value = '';
  let leaving = false;
  try {
    const user = await restoreAccount({ login: loginValue.value.trim(), password: password.value });
    pendingDeletionAt.value = null;
    leaving = await finish(user);
  } catch (cause) {
    error.value = () =>
      cause instanceof ApiError && cause.code === 'account_blocked'
        ? blockedMessage(failureBody(cause, AccountFailure) ?? {})
        : cause instanceof Error && currentErrorMessage(cause)
          ? currentErrorMessage(cause)
          : t('Не удалось восстановить аккаунт');
  } finally {
    if (!leaving) submitting.value = false;
  }
}
</script>

<template>
  <dialog
    ref="dialog"
    class="auth-dialog"
    aria-labelledby="authDialogTitle"
    @click="handleBackdropClick"
    @cancel.prevent="handleCancel"
  >
    <div class="auth-dialog__panel">
      <button class="auth-dialog__close" type="button" :aria-label="t('Закрыть')" @click="emit('close')">
        <X v-bind="iconMd" aria-hidden="true" />
      </button>

      <div class="auth-dialog__heading">
        <span class="auth-dialog__mark" aria-hidden="true"></span>
        <p class="auth-dialog__kicker">{{ t('Ваши комнаты всегда рядом') }}</p>
        <h1 id="authDialogTitle" class="auth-dialog__title">{{ copy.title }}</h1>
        <p class="auth-dialog__subtitle">{{ copy.subtitle }}</p>
        <LanguageControl />
      </div>

      <form class="auth-dialog__form" @submit.prevent="handleSubmit">
        <p v-if="error" class="auth-dialog__error" role="alert">
          <CircleAlert v-bind="iconMd" aria-hidden="true" />{{ error }}
        </p>

        <div v-if="isLogin && pendingDeletionAt !== null" class="auth-dialog__restore" role="status">
          <p>
            {{ t('Этот аккаунт ожидает удаления — оно произойдёт') }} {{ dayMonth(pendingDeletionAt)
            }}{{ t('. Восстановить его?') }}
          </p>
          <button class="auth-dialog__submit" type="button" :disabled="submitting" @click="restorePendingAccount()">
            {{ t('Восстановить аккаунт') }}
          </button>
        </div>

        <div class="auth-dialog__field">
          <label class="auth-dialog__label" for="authLoginInput">{{ t('Логин') }}</label>
          <input
            id="authLoginInput"
            ref="loginInput"
            v-model="loginValue"
            class="auth-dialog__input"
            maxlength="32"
            autocapitalize="off"
            autocomplete="username"
            spellcheck="false"
            :placeholder="t('Ваш логин')"
            required
          />
        </div>

        <div v-if="isRegister" class="auth-dialog__field">
          <label class="auth-dialog__label" for="authDisplayNameInput">
            {{ t('Отображаемое имя') }} <span class="auth-dialog__label-soft">{{ t('· необязательно') }}</span>
          </label>
          <input
            id="authDisplayNameInput"
            v-model="displayName"
            class="auth-dialog__input"
            maxlength="40"
            autocomplete="nickname"
            :placeholder="t('Как вас будут видеть в комнате')"
          />
        </div>

        <div v-if="isRecover" class="auth-dialog__field">
          <label class="auth-dialog__label" for="authRecoveryCodeInput">{{ t('Код восстановления') }}</label>
          <input
            id="authRecoveryCodeInput"
            v-model="recoveryCode"
            class="auth-dialog__input auth-dialog__input--code"
            maxlength="32"
            autocapitalize="characters"
            autocomplete="one-time-code"
            spellcheck="false"
            placeholder="XXXX-XXXX-XXXX-XXXX"
            required
          />
        </div>

        <div class="auth-dialog__field">
          <label class="auth-dialog__label" for="authPasswordInput">{{
            isRecover ? t('Новый пароль') : t('Пароль')
          }}</label>
          <PasswordField
            id="authPasswordInput"
            v-model="password"
            :autocomplete="isLogin ? 'current-password' : 'new-password'"
            :placeholder="isLogin ? t('Ваш пароль') : t('Минимум 8 символов')"
          />
          <button v-if="isLogin" type="button" class="auth-dialog__forgot" @click="switchMode('recover')">
            {{ t('Забыли пароль?') }}
          </button>
        </div>

        <div v-if="!isLogin" class="auth-dialog__field">
          <label class="auth-dialog__label" for="authPasswordConfirmInput">{{ t('Повторите пароль') }}</label>
          <PasswordField
            id="authPasswordConfirmInput"
            v-model="passwordConfirm"
            autocomplete="new-password"
            :placeholder="t('Ещё раз')"
          />
        </div>

        <p v-if="isRegister" class="auth-dialog__consent">
          {{ t('Нажимая «') }}{{ copy.submit }}{{ t('», вы подтверждаете, что вам исполнилось 14 лет, принимаете') }}
          <a href="/terms" target="_blank" rel="noopener">{{ t('Пользовательское соглашение') }}</a>
          {{ t('и ознакомились с') }}
          <a href="/privacy" target="_blank" rel="noopener">{{ t('Политикой обработки персональных данных') }}</a
          >.
        </p>

        <button class="auth-dialog__submit" type="submit" :disabled="submitting || !session.loaded">
          <template v-if="submitting">
            <span class="auth-dialog__spinner" aria-hidden="true"></span>
            {{ copy.submitting }}
          </template>
          <template v-else>{{ copy.submit }}</template>
        </button>
      </form>

      <p v-if="isLogin" class="auth-dialog__foot">
        {{ t('Нет аккаунта?') }}
        <button type="button" class="auth-dialog__link" @click="switchMode('register')">
          {{ t('Зарегистрироваться') }}
        </button>
      </p>
      <p v-else class="auth-dialog__foot">
        {{ isRecover ? t('Вспомнили пароль?') : t('Уже есть аккаунт?') }}
        <button type="button" class="auth-dialog__link" @click="switchMode('login')">{{ t('Войти') }}</button>
      </p>
    </div>
  </dialog>
</template>
