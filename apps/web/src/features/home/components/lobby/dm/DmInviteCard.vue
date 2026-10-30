<script setup lang="ts">
import { DoorOpen } from '@lucide/vue';
import type { DirectMessageInvite } from '@/api/dm';
import EmojiText from '@/shared/chat/EmojiText.vue';
import { iconMd } from '@/shared/ui/icons';
import { inviteAnswerable, inviteTitle } from '../../../model/dm-invite-view';

defineProps<{
  invite: DirectMessageInvite;
  fromMe: boolean;
  /** An answer to this invitation is on its way. */
  busy: boolean;
}>();

const emit = defineEmits<{ respond: [action: 'accept' | 'decline'] }>();
</script>

<template>
  <article class="dm-invite">
    <span class="dm-invite__icon"><DoorOpen v-bind="iconMd" aria-hidden="true" /></span>
    <div class="dm-invite__copy">
      <strong>{{ inviteTitle(invite, fromMe) }}</strong>
      <span><EmojiText :text="invite.roomName || invite.roomId" /></span>
    </div>
    <div v-if="inviteAnswerable(invite, fromMe)" class="dm-invite__actions">
      <button type="button" class="dm-invite__dismiss" :disabled="busy" @click="emit('respond', 'decline')">
        Не сейчас
      </button>
      <button type="button" class="dm-invite__join" :disabled="busy" @click="emit('respond', 'accept')">Войти</button>
    </div>
  </article>
</template>
