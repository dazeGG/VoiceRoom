<script setup lang="ts">
import { computed, ref } from 'vue';
import { Lock } from '@lucide/vue';
import { IconButton, Popover, SafetyCode } from '@voiceroom/ui-kit/components';
import { state } from '@voiceroom/call/engine/core/room-runtime.store';
import { t } from '@/shared/i18n';
import { safetyEmojiName } from './safety-emoji-names';

// The call's end-to-end encryption, shown in place: a lock that opens this call's 4-emoji code once the key is
// agreed, and a quiet note while it is still being agreed with a peer who is here. A new code after a restart
// simply replaces the old one; nothing announces it.
const { peerPresent } = defineProps<{ peerPresent: boolean }>();
const open = ref(false);
const code = computed(() =>
  state.callE2ee?.phase === 'secured' && state.callE2ee.code
    ? state.callE2ee.code.map((emoji) => ({ emoji, name: safetyEmojiName(emoji) }))
    : null
);
const agreeing = computed(() => peerPresent && state.callE2ee?.phase === 'agreeing');
</script>

<template>
  <div v-if="code || agreeing" class="friend-call__security">
    <Popover
      v-if="code"
      v-model:open="open"
      role="dialog"
      placement="bottom-start"
      width="wide"
      :aria-label="t('Звонок защищён сквозным шифрованием')"
    >
      <template #trigger="{ open: shown, toggle, panelId }">
        <IconButton
          :aria-expanded="shown"
          :aria-controls="panelId"
          :label="t('Звонок защищён сквозным шифрованием')"
          :size="40"
          @click="toggle"
        >
          <Lock aria-hidden="true" />
        </IconButton>
      </template>
      <template #content>
        <div class="friend-call-security">
          <p class="friend-call-security__title">{{ t('Звонок защищён сквозным шифрованием') }}</p>
          <SafetyCode :items="code" :label="t('Код проверки звонка')" />
          <p class="friend-call-security__hint">
            {{ t('Сравните эмодзи с собеседником. Если они совпадают, звонок никто не перехватывает.') }}
          </p>
        </div>
      </template>
    </Popover>
    <p v-else class="friend-call__security-pending" role="status">{{ t('Устанавливаем защищённое соединение…') }}</p>
  </div>
</template>
