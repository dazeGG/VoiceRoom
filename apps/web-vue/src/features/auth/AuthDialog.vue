<script setup lang="ts">
import { CircleAlert, X } from '@lucide/vue';
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import { normalizeRecoveryCode } from '@voice-room/shared/account-security';
import { AccountFailure } from '@voice-room/shared/contracts/account';
import { login, recoverAccount, register, restoreAccount, type AuthUser } from '@/api/auth';
import { ApiError, failureBody } from '@/api/client';
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
    login: {
      title: 'Вход',
      subtitle: 'Продолжите с сохранёнными комнатами и именем.',
      submit: 'Войти',
      submitting: 'Входим…',
      failure: 'Не удалось войти'
    },
    register: {
      title: 'Создать аккаунт',
      subtitle: 'Сохраняйте комнаты, историю и своё имя.',
      submit: 'Создать аккаунт',
      submitting: 'Создаём…',
      failure: 'Не удалось создать аккаунт'
    },
    recover: {
      title: 'Восстановить доступ',
      subtitle: 'Введите логин, один из кодов восстановления и новый пароль. Код сработает только один раз.',
      submit: 'Сменить пароль и войти',
      submitting: 'Восстанавливаем…',
      failure: 'Не удалось восстановить доступ'
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
const error = ref('');
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
  if (isRegister.value && !normalizeLogin(loginValue.value)) return `Логин: ${LOGIN_HINT}`;
  if (isRecover.value && !normalizeLogin(loginValue.value)) return 'Введите логин аккаунта';
  if (isRecover.value && !normalizeRecoveryCode(recoveryCode.value))
    return 'Код восстановления — 16 символов, например ABCD-EFGH-JKMN-PQRS';
  if (!isLogin.value && !isValidPassword(password.value))
    return `Пароль должен быть не короче ${PASSWORD_MIN_LENGTH} символов`;
  if (!isLogin.value && password.value !== passwordConfirm.value) return 'Пароли не совпадают';
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
  await router.push('/');
  return false;
}

async function handleSubmit(): Promise<void> {
  if (submitting.value) return;

  error.value = validate();
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
      error.value = blockedMessage(failureBody(cause, AccountFailure) ?? {});
      return;
    }
    if (isLogin.value && cause instanceof ApiError && cause.code === 'account_deletion_pending') {
      pendingDeletionAt.value = failureBody(cause, AccountFailure)?.deletionScheduledFor || null;
      return;
    }
    error.value = cause instanceof Error && cause.message ? cause.message : copy.value.failure;
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
    error.value =
      cause instanceof ApiError && cause.code === 'account_blocked'
        ? blockedMessage(failureBody(cause, AccountFailure) ?? {})
        : cause instanceof Error && cause.message
          ? cause.message
          : 'Не удалось восстановить аккаунт';
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
      <button class="auth-dialog__close" type="button" aria-label="Закрыть" @click="emit('close')">
        <X v-bind="iconMd" aria-hidden="true" />
      </button>

      <div class="auth-dialog__heading">
        <span class="auth-dialog__mark" aria-hidden="true"></span>
        <p class="auth-dialog__kicker">Ваши комнаты всегда рядом</p>
        <h1 id="authDialogTitle" class="auth-dialog__title">{{ copy.title }}</h1>
        <p class="auth-dialog__subtitle">{{ copy.subtitle }}</p>
      </div>

      <form class="auth-dialog__form" @submit.prevent="handleSubmit">
        <p v-if="error" class="auth-dialog__error" role="alert">
          <CircleAlert v-bind="iconMd" aria-hidden="true" />{{ error }}
        </p>

        <div v-if="isLogin && pendingDeletionAt !== null" class="auth-dialog__restore" role="status">
          <p>Этот аккаунт ожидает удаления — оно произойдёт {{ dayMonth(pendingDeletionAt) }}. Восстановить его?</p>
          <button class="auth-dialog__submit" type="button" :disabled="submitting" @click="restorePendingAccount()">
            Восстановить аккаунт
          </button>
        </div>

        <div class="auth-dialog__field">
          <label class="auth-dialog__label" for="authLoginInput">Логин</label>
          <input
            id="authLoginInput"
            ref="loginInput"
            v-model="loginValue"
            class="auth-dialog__input"
            maxlength="32"
            autocapitalize="off"
            autocomplete="username"
            spellcheck="false"
            placeholder="Ваш логин"
            required
          />
        </div>

        <div v-if="isRegister" class="auth-dialog__field">
          <label class="auth-dialog__label" for="authDisplayNameInput">
            Отображаемое имя <span class="auth-dialog__label-soft">· необязательно</span>
          </label>
          <input
            id="authDisplayNameInput"
            v-model="displayName"
            class="auth-dialog__input"
            maxlength="40"
            autocomplete="nickname"
            placeholder="Как вас будут видеть в комнате"
          />
        </div>

        <div v-if="isRecover" class="auth-dialog__field">
          <label class="auth-dialog__label" for="authRecoveryCodeInput">Код восстановления</label>
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
          <label class="auth-dialog__label" for="authPasswordInput">{{ isRecover ? 'Новый пароль' : 'Пароль' }}</label>
          <PasswordField
            id="authPasswordInput"
            v-model="password"
            :autocomplete="isLogin ? 'current-password' : 'new-password'"
            :placeholder="isLogin ? 'Ваш пароль' : 'Минимум 8 символов'"
          />
          <button v-if="isLogin" type="button" class="auth-dialog__forgot" @click="switchMode('recover')">
            Забыли пароль?
          </button>
        </div>

        <div v-if="!isLogin" class="auth-dialog__field">
          <label class="auth-dialog__label" for="authPasswordConfirmInput">Повторите пароль</label>
          <PasswordField
            id="authPasswordConfirmInput"
            v-model="passwordConfirm"
            autocomplete="new-password"
            placeholder="Ещё раз"
          />
        </div>

        <p v-if="isRegister" class="auth-dialog__consent">
          Нажимая «{{ copy.submit }}», вы подтверждаете, что вам исполнилось 14 лет, принимаете
          <a href="/terms" target="_blank" rel="noopener">Пользовательское соглашение</a> и ознакомились с
          <a href="/privacy" target="_blank" rel="noopener">Политикой обработки персональных данных</a>.
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
        Нет аккаунта?
        <button type="button" class="auth-dialog__link" @click="switchMode('register')">Зарегистрироваться</button>
      </p>
      <p v-else class="auth-dialog__foot">
        {{ isRecover ? 'Вспомнили пароль?' : 'Уже есть аккаунт?' }}
        <button type="button" class="auth-dialog__link" @click="switchMode('login')">Войти</button>
      </p>
    </div>
  </dialog>
</template>
