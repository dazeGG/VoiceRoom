<script setup lang="ts">
import { Button, Dialog, Field, TextField } from '@voice-room/ui/components';
import { useLocalizedText, currentErrorMessage } from '@/shared/i18n/localized-text';

import { t } from '@/shared/i18n';
import LanguageControl from '@/shared/i18n/LanguageControl.vue';
import { CircleAlert } from '@lucide/vue';
import { computed, ref } from 'vue';
import { useRouter } from 'vue-router';
import { normalizeRecoveryCode } from '@voice-room/shared/account-security';
import { AccountFailure } from '@voice-room/shared/contracts/account';
import { login, recoverAccount, register, restoreAccount, type AuthUser } from '@/api/auth';
import { ApiError, failureBody } from '@/api/client';
import { APP_HOME } from '@/shared/app-home';
import { dayMonth } from '@/shared/utils/date-format';
import { iconMd } from '@voice-room/ui/icon-defaults';
import { LOGIN_HINT, PASSWORD_MIN_LENGTH, blockedMessage, isValidPassword, normalizeLogin } from './account';
import type { AuthMode } from './auth-mode';
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
  <Dialog
    layer="auth"
    open
    size="sm"
    :title="copy.title"
    :description="copy.subtitle"
    initial-focus="#authLoginInput"
    :on-close="() => emit('close')"
  >
    <p class="auth-dialog__kicker">{{ t('Ваши комнаты всегда рядом') }}</p>

    <form class="auth-dialog__form" @submit.prevent="handleSubmit">
      <p v-if="error" class="auth-dialog__error" role="alert">
        <CircleAlert v-bind="iconMd" aria-hidden="true" />{{ error }}
      </p>

      <div v-if="isLogin && pendingDeletionAt !== null" class="auth-dialog__restore" role="status">
        <p>
          {{ t('Этот аккаунт ожидает удаления — оно произойдёт') }} {{ dayMonth(pendingDeletionAt)
          }}{{ t('. Восстановить его?') }}
        </p>
        <Button variant="primary" size="lg" :disabled="submitting" @click="restorePendingAccount">
          {{ t('Восстановить аккаунт') }}
        </Button>
      </div>

      <Field id="authLoginInput" :label="t('Логин')">
        <TextField
          v-model="loginValue"
          size="lg"
          name="username"
          maxlength="32"
          autocapitalize="off"
          autocomplete="username"
          spellcheck="false"
          :placeholder="t('Ваш логин')"
          required
        />
      </Field>

      <Field v-if="isRegister" id="authDisplayNameInput" :label="t('Отображаемое имя')" optional>
        <TextField
          v-model="displayName"
          size="lg"
          maxlength="40"
          autocomplete="nickname"
          :placeholder="t('Как вас будут видеть в комнате')"
        />
      </Field>

      <Field v-if="isRecover" id="authRecoveryCodeInput" :label="t('Код восстановления')">
        <TextField
          v-model="recoveryCode"
          class="auth-dialog__code"
          size="lg"
          variant="code"
          maxlength="32"
          autocapitalize="characters"
          autocomplete="one-time-code"
          spellcheck="false"
          placeholder="XXXX-XXXX-XXXX-XXXX"
          required
        />
      </Field>

      <div class="auth-dialog__password">
        <Field id="authPasswordInput" :label="isRecover ? t('Новый пароль') : t('Пароль')">
          <TextField
            :key="isLogin ? 'current' : 'new'"
            v-model="password"
            name="password"
            type="password"
            size="lg"
            :autocomplete="isLogin ? 'current-password' : 'new-password'"
            :placeholder="isLogin ? t('Ваш пароль') : t('Минимум 8 символов')"
          />
        </Field>
        <Button v-if="isLogin" variant="plain" size="inline" class="auth-dialog__forgot" @click="switchMode('recover')">
          {{ t('Забыли пароль?') }}
        </Button>
      </div>

      <Field v-if="!isLogin" id="authPasswordConfirmInput" :label="t('Повторите пароль')">
        <TextField
          v-model="passwordConfirm"
          name="password-confirm"
          type="password"
          size="lg"
          autocomplete="new-password"
          :placeholder="t('Ещё раз')"
        />
      </Field>

      <p v-if="isRegister" class="auth-dialog__consent">
        {{ t('Нажимая «') }}{{ copy.submit }}{{ t('», вы подтверждаете, что вам исполнилось 14 лет, принимаете') }}
        <a href="/terms" target="_blank" rel="noopener">{{ t('Пользовательское соглашение') }}</a>
        {{ t('и ознакомились с') }}
        <a href="/privacy" target="_blank" rel="noopener">{{ t('Политикой обработки персональных данных') }}</a
        >.
      </p>

      <Button type="submit" variant="primary" size="lg" :busy="submitting" :disabled="!session.loaded">
        {{ submitting ? copy.submitting : copy.submit }}
      </Button>
    </form>

    <p v-if="isLogin" class="auth-dialog__foot">
      {{ t('Нет аккаунта?') }}
      <Button variant="plain" size="inline" class="auth-dialog__link" @click="switchMode('register')">
        {{ t('Зарегистрироваться') }}
      </Button>
    </p>
    <p v-else class="auth-dialog__foot">
      {{ isRecover ? t('Вспомнили пароль?') : t('Уже есть аккаунт?') }}
      <Button variant="plain" size="inline" class="auth-dialog__link" @click="switchMode('login')">{{
        t('Войти')
      }}</Button>
    </p>
    <div class="auth-dialog__language">
      <LanguageControl />
    </div>
  </Dialog>
</template>
