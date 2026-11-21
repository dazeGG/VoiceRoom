<script setup lang="ts">
import { computed } from 'vue';
import { AppWindow, ArrowLeft, BadgeCheck, Ban, Globe, Lock, LogOut, Smartphone, Trash2 } from '@lucide/vue';
import type { AdminActionEntry, BlockDuration } from '@voice-room/shared/contracts/admin';
import { SettingRow } from '@voice-room/ui/components';
import { blockTerm, describeAction } from '../accounts.ts';
import {
  blockAccount,
  cancelAccountDeletion,
  deleteAccount,
  fetchAccount,
  setAccountBadge,
  signOutAccount,
  unblockAccount
} from '../api/admin.ts';
import { forgetBadges } from '../badges.ts';
import { formatAgo, formatCount, formatDateTime, formatMinutes, formatNumericDate, plural } from '../format.ts';
import { usePageTitle } from '../frame.ts';
import Notice from '../Notice.vue';
import { useCan } from '../staff.store.ts';
import {
  AccountBadge,
  Avatar,
  Button,
  Callout,
  Card,
  EmptyState,
  ListItem,
  Panel,
  Pill,
  RoomAvatar,
  Skeleton,
  Stat,
  Stats,
  Switch,
  type Tone
} from '../ui';
import { useAdminResource } from '../use-admin-resource.ts';
import AccountBlockDialog from './AccountBlockDialog.vue';
import AccountDeleteDialog from './AccountDeleteDialog.vue';
import AccountSignOutDialog from './AccountSignOutDialog.vue';
import AccountTimeCharts from './AccountTimeCharts.vue';
import { useAccountActions } from './use-account-actions.ts';

const props = defineProps<{ userId: string }>();
const emit = defineEmits<{ back: [] }>();
const LOG_TONES: Record<AdminActionEntry['action'], Tone> = {
  block: 'danger',
  delete: 'warning',
  unblock: 'success',
  cancel_deletion: 'success',
  logout: 'neutral',
  badge: 'accent',
  staff_role: 'info'
};
const canModerate = useCan('accounts.moderate');
const canManage = useCan('accounts.manage');
const {
  data: detail,
  failure,
  busy: loading,
  heardAt,
  reload,
  update
} = useAdminResource(() => fetchAccount(props.userId), [() => props.userId], {
  failureText: 'Не удалось загрузить аккаунт'
});
const { dialog, busy, actionError, closeDialog, run, runInline } = useAccountActions<'block' | 'delete' | 'sign-out'>(
  (changed) => update(() => changed)
);
const now = computed(() => heardAt.value ?? 0);
const account = computed(() => detail.value?.account);
const name = computed(() => (account.value ? account.value.displayName || account.value.login : ''));
usePageTitle(() => name.value || null);

// A block with an end is lifted by a moderator; one without an end needs an admin.
const canUnblock = computed(() => (detail.value?.block?.until === null ? canManage.value : canModerate.value));
const clients = computed(() =>
  [
    account.value?.clients.desktopApp ? 'приложение' : '',
    account.value?.clients.browser ? 'браузер' : '',
    account.value?.clients.mobile ? 'телефон' : ''
  ].filter(Boolean)
);

const confirmBlock = (input: { duration: BlockDuration; reason: string }) =>
  run(() => blockAccount(props.userId, input), 'Не удалось заблокировать');
const confirmDelete = (input: { login: string; reason: string }) =>
  run(() => deleteAccount(props.userId, input), 'Не удалось удалить аккаунт');

function toggleOfficial(checked: boolean): void {
  void runInline(async () => {
    const changed = await setAccountBadge(props.userId, checked ? 'official' : null);
    forgetBadges();
    return changed;
  }, 'Не удалось изменить отметку');
}
function deviceIcon(client: string) {
  if (/voiceroom|desktop|electron/i.test(client)) return AppWindow;
  if (/iphone|android|mobile|ios/i.test(client)) return Smartphone;
  return Globe;
}
</script>

<template>
  <div>
    <Button variant="ghost" @click="emit('back')"><ArrowLeft aria-hidden="true" />Все аккаунты</Button>
  </div>
  <Notice v-if="failure && !detail && !loading" :failure="failure" @retry="reload" />
  <div v-else-if="!detail || !account" class="admin-account-card__main" aria-busy="true" aria-label="Загружаем аккаунт">
    <Skeleton height="calc(var(--space-64) + var(--size-40))" />
    <Skeleton height="calc(var(--size-48) + var(--size-40))" />
    <Skeleton height="calc(var(--size-56) * 4)" />
  </div>
  <template v-else>
    <div class="admin-account-card__layout">
      <div class="admin-account-card__main">
        <Card as="section" aria-label="Аккаунт">
          <div class="admin-account-card__identity">
            <Avatar
              :name="name"
              :src="account.avatarUrl"
              :color-key="account.avatarColorKey"
              :background="account.avatarAccent"
              :size="56"
              :show-dot="account.online"
              :online="account.online"
            />
            <div class="admin-account-card__names">
              <div class="admin-account-card__name">
                <h2>{{ name }} <AccountBadge :key="account.badge ?? 'none'" :user-id="account.id" /></h2>
                <Pill v-if="account.online" tone="success">в сети</Pill>
                <Pill v-if="account.admin" tone="accent">сотрудник</Pill>
                <Pill v-if="account.badge === 'official'" tone="accent">официальный аккаунт</Pill>
                <Pill v-if="account.status === 'blocked'" tone="danger">заблокирован</Pill>
                <Pill v-if="account.status === 'deleting'" tone="danger">удаляется</Pill>
              </div>
              <div class="admin-account-card__meta">
                <span>@{{ account.login }}</span>
                <span title="id аккаунта">id {{ account.id }}</span>
                <span>{{ account.online ? 'в сети сейчас' : `был(а) ${formatAgo(account.lastSeenAt, now)}` }}</span>
              </div>
            </div>
          </div>
          <Callout
            v-if="detail.deletion"
            class="admin-account-card__notice"
            tone="warning"
            role="status"
            :title="`Удалится ${formatDateTime(detail.deletion.scheduledFor)} — ${detail.deletion.byAdmin ? 'по решению администратора' : 'по просьбе владельца'}.`"
          >
            <template v-if="detail.deletion.byAdmin && canManage" #actions>
              <Button
                size="sm"
                :disabled="busy"
                @click="runInline(() => cancelAccountDeletion(userId), 'Не удалось отменить удаление')"
                >Отменить удаление</Button
              >
            </template>
          </Callout>
          <Callout
            v-if="detail.block && !detail.deletion?.byAdmin"
            tone="danger"
            role="status"
            :title="`Заблокирован ${blockTerm(detail.block.until)}. Причина: ${detail.block.reason}`"
          >
            <template v-if="canUnblock" #actions>
              <Button
                size="sm"
                :disabled="busy"
                @click="runInline(() => unblockAccount(userId), 'Не удалось разблокировать')"
                >Разблокировать</Button
              >
            </template>
          </Callout>
        </Card>
        <Callout v-if="actionError && dialog !== 'sign-out'" :title="actionError" tone="danger" role="alert" />
        <Stats label="Цифры">
          <Stat label="Регистрация">{{ formatNumericDate(account.createdAt) }}</Stat>
          <Stat label="Последний визит">{{ account.online ? 'сейчас' : formatAgo(account.lastSeenAt, now) }}</Stat>
          <Stat
            label="Активных дней за 90 дней"
            :note="clients.length ? clients.join(', ') : 'нет данных о клиентах'"
            >{{ formatCount(account.activeDays) }}</Stat
          >
          <Stat label="В войсе за 90 дней">{{ formatMinutes(account.voiceMinutes) }}</Stat>
          <Stat label="Сообщений">{{ formatCount(account.messages) }}</Stat>
          <Stat label="Комнаты" :note="`своих · участник в ${formatCount(detail.memberOf)}`">{{
            formatCount(account.ownedRooms)
          }}</Stat>
          <Stat
            label="Жалобы на аккаунт"
            :tone="detail.reports.against > 0 ? 'danger' : 'neutral'"
            :note="`${detail.reports.againstOpen ? `открытых: ${detail.reports.againstOpen}` : 'открытых нет'} · от аккаунта: ${formatCount(detail.reports.filed)}`"
          >
            {{ formatCount(detail.reports.against) }}
          </Stat>
        </Stats>

        <AccountTimeCharts :days="detail.days" />

        <Panel title="История действий администраторов">
          <EmptyState v-if="!detail.actions.length" title="Пока ничего" compact />
          <ol v-else class="admin-account-card__log">
            <li v-for="entry in detail.actions" :key="entry.id">
              <span
                class="admin-account-card__log-dot"
                :class="`admin-tone--${LOG_TONES[entry.action]}`"
                aria-hidden="true"
              />
              <div class="admin-account-card__log-body">
                <strong>{{ describeAction(entry) }}</strong>
                <span v-if="entry.reason">«{{ entry.reason }}»</span>
                <small>{{ formatDateTime(entry.at) }} · {{ entry.adminName }}</small>
              </div>
            </li>
          </ol>
        </Panel>
      </div>

      <div class="admin-account-card__side">
        <Panel title="Действия">
          <SettingRow
            v-if="canManage"
            label="Официальный аккаунт"
            description="Галочка у имени везде; только ему можно называться VoiceRoom."
          >
            <template #leading><BadgeCheck class="admin-account-card__icon" aria-hidden="true" /></template>
            <template #control>
              <Switch
                :model-value="account.badge === 'official'"
                :disabled="busy"
                v-bind="{ ariaLabel: 'Официальный аккаунт' }"
                @update:model-value="toggleOfficial"
              />
            </template>
          </SettingRow>
          <p v-if="account.admin" class="admin-account-card__quiet">
            <Lock aria-hidden="true" /> Это аккаунт сотрудника: заблокировать, разлогинить или удалить его нельзя.
          </p>
          <div v-else class="admin-account-card__actions">
            <Button v-if="canModerate && account.status === 'active'" :disabled="busy" @click="dialog = 'block'">
              <Ban aria-hidden="true" />Заблокировать…
            </Button>
            <Button v-if="canModerate" :disabled="busy || !detail.devices.length" @click="dialog = 'sign-out'">
              <LogOut aria-hidden="true" />Разлогинить везде
            </Button>
            <Button
              v-if="canManage && !detail.deletion"
              variant="danger-ghost"
              :disabled="busy"
              @click="dialog = 'delete'"
            >
              <Trash2 aria-hidden="true" />Удалить аккаунт…
            </Button>
          </div>
        </Panel>

        <Panel title="Устройства со входом">
          <EmptyState v-if="!detail.devices.length" title="Ни одного открытого сеанса" compact />
          <ul v-else class="admin-account-card__list">
            <li v-for="(device, index) in detail.devices" :key="index">
              <ListItem
                :text="[device.client || 'Неизвестный клиент', device.os].filter(Boolean).join(' · ')"
                :time="formatAgo(device.lastSeenAt, now)"
                dense
              >
                <template #leading
                  ><component :is="deviceIcon(device.client)" class="admin-account-card__icon" aria-hidden="true"
                /></template>
              </ListItem>
            </li>
          </ul>
        </Panel>

        <Panel title="Свои постоянные комнаты">
          <EmptyState v-if="!detail.ownedRooms.length" title="Нет" compact />
          <ul v-else class="admin-account-card__list">
            <li v-for="room in detail.ownedRooms" :key="room.id">
              <ListItem
                :text="room.name || 'Без названия'"
                :time="`${formatCount(room.members)} ${plural(room.members, ['участник', 'участника', 'участников'])}`"
                dense
              >
                <template #leading><RoomAvatar :room-id="room.id" :name="room.name || null" :size="32" /></template>
              </ListItem>
            </li>
          </ul>
        </Panel>
      </div>
    </div>

    <AccountBlockDialog v-if="dialog === 'block'" :name="name" :on-confirm="confirmBlock" @close="closeDialog" />
    <AccountDeleteDialog
      v-if="dialog === 'delete'"
      :login="account.login"
      :on-confirm="confirmDelete"
      @close="closeDialog"
    />
    <AccountSignOutDialog
      v-if="dialog === 'sign-out'"
      :name="name"
      :busy="busy"
      :error="actionError"
      @close="closeDialog"
      @confirm="runInline(() => signOutAccount(userId), 'Не удалось завершить сеансы')"
    />
  </template>
</template>
