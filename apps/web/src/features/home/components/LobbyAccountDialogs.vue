<script setup lang="ts">
// The account's dialogs over the lobby: settings, the sign-in alert, "what's
// new" and the desktop app prompt, all driven by AccountPrompts.
import type { AuthUser, OwnedRoom } from '@/api/auth';
import type { PublicUser } from '@/api/friends';
import AppBenefitsModal from '@/shared/components/AppBenefitsModal.vue';
import type { AccountPrompts, SecurityHighlight } from '../model/use-account-prompts';
import type { ToastOptions } from '../model/toasts.store';
import LoginAlertDialog from './LoginAlertDialog.vue';
import SettingsModal from './SettingsModal.vue';
import WhatsNewDialog from './WhatsNewDialog.vue';

const props = defineProps<{
  prompts: AccountPrompts;
  user: AuthUser;
  notificationUsers: PublicUser[];
  notificationRooms: OwnedRoom[];
  loggingOut: boolean;
}>();

// The refs the dialogs write back through v-model and their open-change events.
const { settingsTab, loginAlertOpen, whatsNewOpen } = props.prompts;

const emit = defineEmits<{ toast: [message: string, options?: ToastOptions]; logout: [] }>();
</script>

<template>
  <SettingsModal
    v-model:tab="settingsTab"
    :open="prompts.settingsOpen.value"
    :user="user"
    :notification-users="notificationUsers"
    :notification-rooms="notificationRooms"
    :logging-out="loggingOut"
    :security-highlight="prompts.securityHighlight.value"
    @close="prompts.closeSettings"
    @toast="(message, options) => emit('toast', message, options)"
    @logout="emit('logout')"
  />
  <LoginAlertDialog
    @secure-account="(target: SecurityHighlight) => prompts.openSecuritySettings(target)"
    @open-change="(open: boolean) => (loginAlertOpen = open)"
    @toast="(message, options) => emit('toast', message, options)"
  />
  <WhatsNewDialog
    :paused="prompts.loginAlertOpen.value"
    @open-appearance="prompts.openAppearanceSettings()"
    @open-change="(open: boolean) => (whatsNewOpen = open)"
  />
  <AppBenefitsModal :open="prompts.appPromptOpen.value" @close="prompts.closeAppPrompt" />
</template>
