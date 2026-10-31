<script setup lang="ts">
// The open settings. Mounted fresh on every opening, so each tab starts from
// what is saved; only the profile edits live here, so they survive a look at
// another tab before saving.
import { Bell, Keyboard, LogOut, Mic, Monitor, Palette, ShieldCheck, User } from '@lucide/vue';
import { onBeforeUnmount, onMounted, reactive, type Component } from 'vue';
import type { AuthUser, OwnedRoom } from '@/api/auth';
import type { PublicUser } from '@/api/friends';
import LegalLinks from '@/shared/components/LegalLinks.vue';
import { useNotificationPreferencesStore } from '@/shared/notifications/preferences.store';
import { Dialog } from '@/shared/ui';
import { iconMd } from '@/shared/ui/icons';
import { usePushNotificationsStore } from '../../model/push-notifications.store';
import { readSettingsSupport } from '../../model/settings-support';
import type { ToastOptions } from '../../model/toasts.store';
import { useProfileDraft } from '../../model/use-profile-draft';
import AccountSecuritySettings from '../AccountSecuritySettings.vue';
import DesktopAppCard from '../DesktopAppCard.vue';
import AppearanceSettings from './AppearanceSettings.vue';
import AppSettings from './AppSettings.vue';
import HotkeySettings from './HotkeySettings.vue';
import NotificationSettings from './NotificationSettings.vue';
import ProfileSettings from './ProfileSettings.vue';
import SoundSettings from './SoundSettings.vue';
import type { SettingsTab } from './types';

const props = defineProps<{
  user: AuthUser | null;
  notificationUsers: PublicUser[];
  notificationRooms: OwnedRoom[];
  loggingOut: boolean;
  securityHighlight: 'recovery-codes' | 'password' | null;
}>();

const tab = defineModel<SettingsTab>('tab', { default: 'profile' });

const emit = defineEmits<{
  close: [];
  toast: [message: string, options?: ToastOptions];
  logout: [];
}>();

const support = readSettingsSupport();
// On the web the tab offers the desktop builds; in the app, its own settings.
const appTab = support.desktopApp ? support.autostart || support.overlay : true;
// The dialog remounts for another account, so the first user is the one.
const profile = reactive(useProfileDraft(props.user));

const navItems: { id: SettingsTab; label: string; icon: Component }[] = [
  { id: 'profile', label: 'Профиль', icon: User },
  { id: 'security', label: 'Безопасность', icon: ShieldCheck },
  { id: 'sound', label: 'Звук', icon: Mic },
  { id: 'notifications', label: 'Уведомления', icon: Bell },
  { id: 'appearance', label: 'Внешний вид', icon: Palette },
  ...(support.desktopApp ? [{ id: 'hotkeys' as const, label: 'Горячие клавиши', icon: Keyboard }] : []),
  ...(appTab ? [{ id: 'app' as const, label: 'Приложение', icon: Monitor }] : [])
];

const preferences = useNotificationPreferencesStore();
const push = usePushNotificationsStore();

const toast = (...args: [message: string, options?: ToastOptions]): void => emit('toast', ...args);

onMounted(() => {
  preferences.syncNotificationPermission();
  void push.syncPushNotificationState(props.user?.id ?? null);
});
onBeforeUnmount(profile.dispose);
</script>

<template>
  <!-- Escape, the click beside the card, focus and the stack of dialogs opened from here belong to Dialog. -->
  <Dialog :open="true" title="Настройки" :width="940" :on-close="() => emit('close')">
    <div class="settings__frame">
      <div class="settings__body">
        <nav class="settings__nav" aria-label="Разделы настроек">
          <div class="settings__nav-main">
            <button
              v-for="item in navItems"
              :key="item.id"
              class="settings__nav-item"
              type="button"
              :aria-current="tab === item.id ? 'page' : undefined"
              @click="tab = item.id"
            >
              <component :is="item.icon" v-bind="iconMd" aria-hidden="true" />
              {{ item.label }}
            </button>
          </div>
          <LegalLinks compact new-tab />
          <button
            class="settings__nav-item settings__nav-item--danger"
            type="button"
            :disabled="loggingOut"
            @click="emit('logout')"
          >
            <LogOut v-bind="iconMd" aria-hidden="true" />
            {{ loggingOut ? 'Выходим…' : 'Выйти' }}
          </button>
        </nav>

        <div class="settings__content">
          <ProfileSettings
            v-if="tab === 'profile'"
            v-model:name="profile.name"
            :user="user"
            :draft="profile"
            @close="emit('close')"
            @toast="toast"
          />
          <AccountSecuritySettings
            v-else-if="tab === 'security'"
            :login="user?.login ?? ''"
            :highlight-recovery-codes="securityHighlight === 'recovery-codes'"
            :highlight-password="securityHighlight === 'password'"
            @toast="toast"
          />
          <SoundSettings v-else-if="tab === 'sound'" :desktop-app="support.desktopApp" @toast="toast" />
          <AppearanceSettings v-else-if="tab === 'appearance'" />
          <HotkeySettings
            v-else-if="tab === 'hotkeys' && support.desktopApp"
            :global-hotkeys="support.globalHotkeys"
            @toast="toast"
          />
          <template v-else-if="tab === 'app' && appTab">
            <AppSettings v-if="support.desktopApp" :support="support" @toast="toast" />
            <DesktopAppCard v-else title="VoiceRoom для компьютера" embedded />
          </template>
          <NotificationSettings
            v-else
            :support="support"
            :users="notificationUsers"
            :rooms="notificationRooms"
            @toast="toast"
          />
        </div>
      </div>
    </div>
  </Dialog>
</template>
