<script setup lang="ts">
import type { AuthUser, OwnedRoom } from '@/api/auth';
import type { PublicUser } from '@/api/friends';
import type { ToastOptions } from '../model/toasts.store';
import SettingsDialog from './settings/SettingsDialog.vue';
import type { SettingsTab } from './settings/types';

withDefaults(
  defineProps<{
    open: boolean;
    user: AuthUser | null;
    notificationUsers?: PublicUser[];
    notificationRooms?: OwnedRoom[];
    loggingOut?: boolean;
    securityHighlight?: 'recovery-codes' | 'password' | null;
  }>(),
  { notificationUsers: () => [], notificationRooms: () => [], loggingOut: false, securityHighlight: null }
);

const tab = defineModel<SettingsTab>('tab', { default: 'profile' });

const emit = defineEmits<{
  close: [];
  toast: [message: string, options?: ToastOptions];
  logout: [];
}>();
</script>

<template>
  <!-- Every opening, and a switch of account, starts from what is saved. -->
  <SettingsDialog
    v-if="open"
    :key="user?.id ?? ''"
    v-model:tab="tab"
    :user="user"
    :notification-users="notificationUsers"
    :notification-rooms="notificationRooms"
    :logging-out="loggingOut"
    :security-highlight="securityHighlight"
    @close="emit('close')"
    @toast="(...args) => emit('toast', ...args)"
    @logout="emit('logout')"
  />
</template>
