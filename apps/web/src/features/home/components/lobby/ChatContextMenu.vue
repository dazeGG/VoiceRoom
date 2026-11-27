<script setup lang="ts">
import type { FriendMenuTarget } from '../../model/friend-menu';
import { useLobby } from '../../model/lobby-context';
import FriendContextMenu from './FriendContextMenu.vue';

const target = defineModel<FriendMenuTarget | null>({ required: true });
const emit = defineEmits<{ toast: [message: string] }>();
const lobby = useLobby();
</script>

<template>
  <FriendContextMenu v-model="target" :on-mark-read="lobby.markConversationRead" @toast="emit('toast', $event)" />
</template>
