<script setup lang="ts">
import { t } from '@/shared/i18n';
import type { ToastOptions } from '../../model/toasts.store';
import HotkeyRow from './HotkeyRow.vue';

defineProps<{
  /** This desktop build can register shortcuts outside its own window. */
  globalHotkeys: boolean;
}>();

const emit = defineEmits<{ toast: [message: string, options?: ToastOptions] }>();

function onPushToTalkOff(): void {
  emit('toast', t('Push-to-talk выключен: клавиша не назначена'));
}
</script>

<template>
  <div class="settings__hotkeys">
    <div>
      <span class="settings__section-title">{{ t('Горячие клавиши') }}</span>
      <div class="settings__gate-hint">
        {{ t('Назначенные сочетания работают глобально в desktop-приложении, пока вы подключены к голосу.') }}
      </div>
    </div>

    <div class="settings__hotkey-list">
      <HotkeyRow
        action="mic-mute"
        :label="t('Мьют микрофона')"
        :description="t('Включить или выключить микрофон')"
        v-bind="{ ariaLabel: t('Хоткей мьюта микрофона') }"
        @push-to-talk-off="onPushToTalkOff"
      />
      <HotkeyRow
        action="output-mute"
        :label="t('Мьют звука')"
        :description="t('Заглушить весь вывод и микрофон')"
        v-bind="{ ariaLabel: t('Хоткей мьюта звука') }"
        @push-to-talk-off="onPushToTalkOff"
      />
      <HotkeyRow
        action="push-to-talk"
        label="Push-to-talk"
        :description="t('Удерживайте, чтобы открыть микрофон')"
        v-bind="{ ariaLabel: t('Клавиша Push-to-talk') }"
        @push-to-talk-off="onPushToTalkOff"
      />
    </div>
    <div class="settings__hotkey-window-note">
      <template v-if="globalHotkeys">
        {{
          t(
            'В приложении VoiceRoom успешно зарегистрированные сочетания работают поверх других окон, пока вы подключены к голосу. На macOS может потребоваться разрешение «Мониторинг ввода».'
          )
        }}
      </template>
      <template v-else>{{ t('Системные сочетания недоступны в этой сборке приложения.') }}</template>
    </div>
  </div>
</template>
