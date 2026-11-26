<script setup lang="ts">
import { Button, Callout } from '@voiceroom/ui-kit/components';
import { state } from '@voiceroom/call/engine/core/room-runtime.store';
import { reconnectRoomVoice } from '@voiceroom/call/engine/room/room';
import { t } from '@/shared/i18n';
</script>

<template>
  <Callout role="status" tone="danger" layout="pill" :title="t('Голос отключён')">
    <template #actions>
      <Button variant="outline" size="sm" :disabled="state.connecting" @click="reconnectRoomVoice">
        {{ t('Подключиться снова') }}
      </Button>
    </template>
  </Callout>
</template>
