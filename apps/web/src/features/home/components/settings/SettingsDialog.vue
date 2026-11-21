<script setup lang="ts">
import { NavList, NavListGroup, NavListItem, Dialog } from '@voice-room/ui/components';
// The open settings. Mounted fresh on every opening, so each tab starts from
// what is saved; only the profile edits live here, so they survive a look at
// another tab before saving.
import { t } from '@/shared/i18n';
import { Bell, Keyboard, LogOut, Mic, Monitor, Palette, ShieldCheck, User } from '@lucide/vue';
import { onBeforeUnmount, onMounted, reactive, type Component } from 'vue';
import type { AuthUser, OwnedRoom } from '@/api/auth';
import type { PublicUser } from '@/api/friends';
import LegalLinks from '@/shared/components/LegalLinks.vue';
import { useNotificationPreferencesStore } from '@/shared/notifications/preferences.store';
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
  {
    id: 'profile',
    get label() {
      return t('Профиль');
    },
    icon: User
  },
  {
    id: 'security',
    get label() {
      return t('Безопасность');
    },
    icon: ShieldCheck
  },
  {
    id: 'sound',
    get label() {
      return t('Звук');
    },
    icon: Mic
  },
  {
    id: 'notifications',
    get label() {
      return t('Уведомления');
    },
    icon: Bell
  },
  {
    id: 'appearance',
    get label() {
      return t('Внешний вид');
    },
    icon: Palette
  },
  ...(support.desktopApp
    ? [
        {
          id: 'hotkeys' as const,
          get label() {
            return t('Горячие клавиши');
          },
          icon: Keyboard
        }
      ]
    : []),
  ...(appTab
    ? [
        {
          id: 'app' as const,
          get label() {
            return t('Приложение');
          },
          icon: Monitor
        }
      ]
    : [])
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
  <Dialog open size="lg" :title="t('Настройки')" :on-close="() => emit('close')">
    <div class="settings__frame">
      <div class="settings__body">
        <NavList responsive class="settings__nav" :label="t('Разделы настроек')">
          <NavListGroup class="settings__nav-main">
            <NavListItem
              v-for="item in navItems"
              :key="item.id"
              :label="item.label"
              :current="tab === item.id"
              @click="tab = item.id"
            >
              <template #icon><component :is="item.icon" /></template>
            </NavListItem>
          </NavListGroup>
          <LegalLinks compact new-tab />
          <NavListItem
            class="settings__nav-logout"
            tone="danger"
            :label="loggingOut ? t('Выходим…') : t('Выйти из аккаунта')"
            :disabled="loggingOut"
            @click="emit('logout')"
          >
            <template #icon><LogOut /></template>
          </NavListItem>
        </NavList>

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
            <DesktopAppCard v-else :title="t('VoiceRoom для компьютера')" embedded />
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
