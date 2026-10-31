<script setup lang="ts">
import { MonitorSmartphone } from '@lucide/vue';
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import {
  confirmLoginAlert,
  denyLoginAlert,
  fetchLoginAlerts,
  isShowableLoginAlert,
  type LoginAlert,
  type RecoveryCodesStatus
} from '@/api/auth';
import { getAppRealtime } from '@/api/realtime';
import { Dialog } from '@/shared/ui';
import { iconMd } from '@/shared/ui/icons';
import {
  loginAlertDevice,
  loginAlertHeadline,
  loginAlertWhen,
  queueLoginAlert,
  type SecureAccountTarget
} from '../model/login-alerts';
import type { ToastOptions } from '../model/toasts.store';

const emit = defineEmits<{
  secureAccount: [target: SecureAccountTarget];
  openChange: [open: boolean];
  toast: [message: string, options?: ToastOptions];
}>();

const alerts = ref<LoginAlert[]>([]);
// Closed without an answer: hidden for this visit, asked again next time.
const postponedIds = ref<string[]>([]);
const secured = ref<{ sessionEnded: boolean; recoveryCodes: RecoveryCodesStatus } | null>(null);
const answering = ref(false);

const current = computed(() => alerts.value.find((alert) => !postponedIds.value.includes(alert.id)) ?? null);
const open = computed(() => Boolean(secured.value) || Boolean(current.value));

watch(open, (isOpen) => emit('openChange', isOpen), { immediate: true });

function addAlert(alert: LoginAlert): void {
  alerts.value = queueLoginAlert(alerts.value, alert);
}

function removeAlert(alertId: string): void {
  alerts.value = alerts.value.filter((alert) => alert.id !== alertId);
}

async function load(): Promise<void> {
  try {
    for (const alert of await fetchLoginAlerts()) addAlert(alert);
  } catch {
    // Asked again on the next visit or reconnect.
  }
}

let stopListening: (() => void) | null = null;

onMounted(() => {
  void load();
  const realtime = getAppRealtime();
  const stopEvents = realtime.subscribe((event) => {
    if (event.type === 'account.login.new') {
      if (isShowableLoginAlert(event.payload.alert)) addAlert(event.payload.alert);
    } else if (event.type === 'account.login.resolved') {
      removeAlert(event.payload.alertId);
    }
  });
  // Sign-ins that happened while the socket was down come with a reload.
  const stopRestore = realtime.onRestore(() => void load());
  stopListening = () => {
    stopEvents();
    stopRestore();
  };
});

onBeforeUnmount(() => {
  stopListening?.();
  emit('openChange', false);
});

async function answer(resolution: 'confirmed' | 'denied'): Promise<void> {
  const alert = current.value;
  if (!alert || answering.value) return;
  answering.value = true;
  try {
    if (resolution === 'confirmed') {
      await confirmLoginAlert(alert.id);
      removeAlert(alert.id);
    } else {
      const result = await denyLoginAlert(alert.id);
      removeAlert(alert.id);
      secured.value = result;
    }
  } catch (error) {
    emit('toast', error instanceof Error && error.message ? error.message : 'Не удалось ответить', {
      variant: 'error'
    });
  } finally {
    answering.value = false;
  }
}

function secure(target: SecureAccountTarget): void {
  secured.value = null;
  emit('secureAccount', target);
}

function close(): void {
  if (secured.value) {
    secured.value = null;
    return;
  }
  if (current.value) postponedIds.value = [...postponedIds.value, current.value.id];
}
</script>

<template>
  <!-- A security question outranks every other dialog in the lobby (_login-alert.scss lifts it). -->
  <Dialog :open="open" :title="secured ? 'Защитите аккаунт' : 'Новый вход в аккаунт'" :on-close="close" :width="440">
    <div class="login-alert">
      <template v-if="secured">
        <p class="login-alert__text">
          {{
            secured.sessionEnded
              ? 'Сеанс на том устройстве завершён — там аккаунт больше не открыт.'
              : 'Сеанс на том устройстве уже был завершён.'
          }}
          Если это были не вы, кто-то мог узнать ваш пароль.
        </p>
        <div class="login-alert__actions login-alert__actions--stack">
          <button class="login-alert__button login-alert__button--danger" type="button" @click="secure('password')">
            Сменить пароль
          </button>
          <button
            class="login-alert__button login-alert__button--ghost"
            type="button"
            @click="secure('recovery-codes')"
          >
            {{ secured.recoveryCodes.remaining > 0 ? 'Обновить коды восстановления' : 'Создать коды восстановления' }}
          </button>
          <button class="login-alert__later" type="button" @click="secured = null">Позже</button>
        </div>
      </template>
      <template v-else-if="current">
        <p class="login-alert__text">{{ loginAlertHeadline(current) }}. Это были вы?</p>
        <div class="login-alert__device">
          <span class="login-alert__icon" aria-hidden="true"><MonitorSmartphone v-bind="iconMd" /></span>
          <div>
            <strong class="login-alert__device-name">{{ loginAlertDevice(current) }}</strong>
            <small class="login-alert__device-when">{{ loginAlertWhen(current) }}</small>
          </div>
        </div>
        <div class="login-alert__actions">
          <button
            class="login-alert__button login-alert__button--danger"
            type="button"
            :disabled="answering"
            @click="void answer('denied')"
          >
            Это не я
          </button>
          <button
            class="login-alert__button login-alert__button--safe"
            type="button"
            :disabled="answering"
            @click="void answer('confirmed')"
          >
            Это я
          </button>
        </div>
      </template>
    </div>
  </Dialog>
</template>
