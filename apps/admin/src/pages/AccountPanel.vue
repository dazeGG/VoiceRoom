<script setup lang="ts">
import { computed } from 'vue';
import { ArrowUpRight, PhoneCall } from '@lucide/vue';
import type { AccountDetail, BlockDuration, LiveRoom, RoomCall } from '@voice-room/shared/contracts/admin';
import { blockAccount, fetchAccount, fetchRoomCalls, signOutAccount, unblockAccount } from '../api/admin.ts';
import {
  formatAgo,
  formatClock,
  formatCount,
  formatDayHeading,
  formatDuration,
  formatMinutes,
  formatMs,
  formatNumericDate,
  formatPercent,
  plural
} from '../format.ts';
import Notice from '../Notice.vue';
import { useCan } from '../staff.store.ts';
import type { CallRef } from '../tabs.ts';
import { Avatar, Button, Callout, Card, EmptyState, ListItem, Pill, Progress, type Tone } from '../ui';
import { useAdminResource } from '../use-admin-resource.ts';
import AccountBlockDialog from './AccountBlockDialog.vue';
import QualityBar from './rooms/QualityBar.vue';
import AccountSignOutDialog from './AccountSignOutDialog.vue';
import { cpuConclusion } from './account-cpu.ts';
import { qualityOfMinutes, qualityShares } from './rooms/quality.ts';
import { useAccountActions } from './use-account-actions.ts';

const props = defineProps<{ userId: string; liveRooms: readonly LiveRoom[] }>();
const emit = defineEmits<{ openCard: [accountId: string]; openCall: [call: CallRef]; showCalls: []; changed: [] }>();
const REFRESH_MS = 30_000;
const RECENT_CALLS = 3;
const BUSY_SYSTEM_PCT = 90;
const canModerate = useCan('accounts.moderate');
const canManage = useCan('accounts.manage');
const canRooms = useCan('rooms.view');
const {
  data: detail,
  failure,
  heardAt,
  reload,
  update
} = useAdminResource(() => fetchAccount(props.userId), [() => props.userId], {
  failureText: 'Не удалось загрузить аккаунт',
  refreshMs: REFRESH_MS
});
const { data: calls, failure: callsFailure } = useAdminResource(
  () => (canRooms.value ? fetchRoomCalls({ accountId: props.userId }) : Promise.resolve(null)),
  [() => props.userId, canRooms],
  { failureText: 'Не удалось загрузить звонки', refreshMs: REFRESH_MS }
);
const { dialog, busy, actionError, closeDialog, run, runInline } = useAccountActions<'block' | 'sign-out'>(
  (changed) => {
    update(() => changed);
    emit('changed');
  }
);
const confirmBlock = (input: { duration: BlockDuration; reason: string }) =>
  run(() => blockAccount(props.userId, input), 'Не удалось заблокировать');

const account = computed(() => detail.value?.account);
const name = computed(() => (account.value ? account.value.displayName || account.value.login : ''));
const now = computed(() => heardAt.value ?? 0);
const voice = computed(() => detail.value?.voice30d ?? null);
const cpu = computed(() => detail.value?.cpu30d ?? null);
const shares = computed(() => (voice.value ? qualityShares(voice.value.quality) : null));
const inCall = computed(() =>
  props.liveRooms.find((room) => room.peers.some((peer) => peer.account?.id === props.userId))
);
const canUnblock = computed(
  () => detail.value?.block && (detail.value.block.until === null ? canManage.value : canModerate.value)
);
const status = computed<{ label: string; tone: Tone }>(() => {
  if (account.value?.status === 'deleting') return { label: 'удаляется', tone: 'danger' };
  if (account.value?.status === 'blocked') return { label: 'заблокирован', tone: 'danger' };
  return account.value?.online ? { label: 'в сети', tone: 'success' } : { label: 'не в сети', tone: 'neutral' };
});

const toneOf = (value: number | null, warning: number, danger: number) =>
  value === null || value < warning ? '' : value < danger ? 'admin-tone--warning' : 'admin-tone--danger';

function transportOf(transport: NonNullable<AccountDetail['voice30d']>['transport']): string {
  const { udp, tcp, relay } = transport;
  if (udp + tcp + relay === 0) return '—';
  if (relay >= udp && relay >= tcp) return `TURN ${relay}%`;
  return tcp > udp ? `TCP ${tcp}%` : `UDP ${udp}%`;
}

const netCells = computed(() => {
  if (!voice.value) return [];
  const { rttAvgMs, uplinkLossPct, jitterBufferAvgMs, transport } = voice.value;
  return [
    { label: 'RTT', value: rttAvgMs === null ? '—' : formatMs(rttAvgMs), tone: toneOf(rttAvgMs, 100, 150) },
    {
      label: 'Потери от него',
      value: uplinkLossPct === null ? '—' : formatPercent(uplinkLossPct),
      tone: toneOf(uplinkLossPct, 2, 5)
    },
    {
      label: 'Буфер джиттера',
      value: jitterBufferAvgMs === null ? '—' : formatMs(jitterBufferAvgMs),
      tone: toneOf(jitterBufferAvgMs, 60, 100)
    },
    { label: 'Транспорт', value: transportOf(transport), tone: '' }
  ];
});

// An older API can ignore the account filter. Retain only calls this account joined.
const latest = computed(
  () =>
    calls.value?.calls
      .filter((call) => call.stays.some((stay) => stay.account?.id === props.userId))
      .slice(0, RECENT_CALLS)
      .map(describeCall) ?? []
);

function describeCall(call: RoomCall) {
  const own = call.stays.filter((stay) => stay.account?.id === props.userId).flatMap((stay) => stay.minutes ?? []);
  const quality = qualityOfMinutes(own);
  const percentages = quality && qualityShares(quality);
  const level = !percentages ? 'unknown' : percentages.bad ? 'bad' : percentages.unstable ? 'unstable' : 'good';
  const label = !percentages
    ? 'нет данных о связи'
    : percentages.bad
      ? `плохая связь ${percentages.bad}%`
      : percentages.unstable
        ? `нестабильно ${percentages.unstable}%`
        : 'связь в порядке';
  return {
    id: call.id,
    name: call.roomName || call.roomId,
    level,
    caption: `${formatDayHeading(call.startedAt, now.value)}, ${formatClock(call.startedAt)} · ${label}`,
    duration: formatDuration(call.endedAt - call.startedAt)
  };
}
</script>

<template>
  <aside class="admin-account-panel" :aria-label="name ? `Аккаунт: ${name}` : 'Аккаунт'">
    <Notice v-if="failure && !detail" :failure="failure" @retry="reload" />
    <Card v-else-if="!detail || !account"><p aria-busy="true">Загружаем…</p></Card>
    <template v-else>
      <Card as="section">
        <div class="admin-account-panel__identity">
          <Avatar
            :name="name"
            :src="account.avatarUrl"
            :color-key="account.avatarColorKey"
            :background="account.avatarAccent"
            :size="48"
          />
          <div>
            <h2>{{ name }}</h2>
            <span class="admin-account-panel__login">@{{ account.login }} · id {{ account.id }}</span>
          </div>
          <Pill :tone="status.tone" dot compact>{{ status.label }}</Pill>
        </div>
        <Button
          v-if="inCall"
          variant="soft"
          class="admin-account-panel__live"
          @click="emit('openCall', { kind: 'live', roomId: inCall.roomId })"
        >
          <PhoneCall aria-hidden="true" />
          <span
            >Сейчас в звонке: <b>{{ inCall.name }}</b></span
          >
          <ArrowUpRight aria-hidden="true" />
        </Button>
        <dl class="admin-account-panel__facts">
          <div>
            <dt>Регистрация</dt>
            <dd>{{ formatNumericDate(account.createdAt) }}</dd>
          </div>
          <div>
            <dt>Последний визит</dt>
            <dd>{{ account.online ? 'в сети' : formatAgo(account.lastSeenAt, now) }}</dd>
          </div>
          <div>
            <dt>Активных дней за 90</dt>
            <dd>{{ formatCount(account.activeDays) }}</dd>
          </div>
          <div>
            <dt>В войсе за 90 дней</dt>
            <dd>{{ formatMinutes(account.voiceMinutes) }}</dd>
          </div>
          <div>
            <dt>Сообщений</dt>
            <dd>{{ formatCount(account.messages) }}</dd>
          </div>
          <div>
            <dt>Комнаты</dt>
            <dd>
              {{ formatCount(detail.ownedRooms.length) }}
              {{ plural(detail.ownedRooms.length, ['своя', 'своих', 'своих']) }} · участник
              {{ formatCount(detail.memberOf) }}
            </dd>
          </div>
        </dl>
      </Card>

      <Card v-if="detail.voice30d !== undefined" as="section" aria-label="Связь за 30 дней">
        <header class="admin-account-panel__head">
          <h3>Связь за 30 дней</h3>
          <span v-if="voice">{{ formatMinutes(voice.minutes) }}</span>
        </header>
        <template v-if="voice && shares">
          <QualityBar :quality="voice.quality" large />
          <div class="admin-account-panel__legend">
            <span><i class="admin-account-panel__dot--good" aria-hidden="true" />в порядке {{ shares.good }}%</span>
            <span
              ><i class="admin-account-panel__dot--unstable" aria-hidden="true" />нестабильно
              {{ shares.unstable }}%</span
            >
            <span><i class="admin-account-panel__dot--bad" aria-hidden="true" />плохо {{ shares.bad }}%</span>
          </div>
          <dl class="admin-account-panel__network">
            <div v-for="cell in netCells" :key="cell.label">
              <dt>{{ cell.label }}</dt>
              <dd :class="cell.tone">{{ cell.value }}</dd>
            </div>
          </dl>
        </template>
        <p v-else class="admin-account-panel__quiet">За 30 дней не был в войсе.</p>
      </Card>

      <Card v-if="cpu" as="section" aria-label="Процессор в звонках">
        <header class="admin-account-panel__head">
          <h3>Процессор в звонках</h3>
          <span>по отчётам клиента</span>
        </header>
        <Progress v-if="cpu.appAvgPct !== null" label="VoiceRoom" :value="cpu.appAvgPct" />
        <p v-else>VoiceRoom —</p>
        <Progress
          v-if="cpu.systemAvgPct !== null"
          label="Вся система"
          :value="cpu.systemAvgPct"
          :error="cpu.systemAvgPct >= BUSY_SYSTEM_PCT"
        />
        <p v-else>Вся система —</p>
        <p class="admin-account-panel__quiet">{{ cpuConclusion(cpu, voice?.quality.bad ?? 0) }}</p>
      </Card>

      <Card v-if="canRooms" as="section" aria-label="Последние звонки">
        <header class="admin-account-panel__head">
          <h3>Последние звонки</h3>
          <Button variant="plain" size="sm" @click="emit('showCalls')">Все</Button>
        </header>
        <p v-if="callsFailure && !calls" class="admin-account-panel__quiet">{{ callsFailure.message }}</p>
        <ul v-else-if="latest.length" class="admin-account-panel__calls">
          <li v-for="call in latest" :key="call.id">
            <ListItem
              interactive
              :text="call.name"
              :caption="call.caption"
              :time="call.duration"
              @activate="emit('openCall', { kind: 'finished', callId: call.id })"
            >
              <template #leading
                ><span :class="`admin-account-panel__dot--${call.level}`" aria-hidden="true"
              /></template>
            </ListItem>
          </li>
        </ul>
        <EmptyState v-else-if="calls" title="Звонков не было" compact />
        <p v-else class="admin-account-panel__quiet" aria-busy="true">Загружаем…</p>
      </Card>

      <Callout v-if="actionError && dialog !== 'sign-out'" :title="actionError" tone="danger" role="alert" />
      <div class="admin-account-panel__actions">
        <Button variant="primary" @click="emit('openCard', userId)">Открыть карточку аккаунта</Button>
        <template v-if="!account.admin && canModerate">
          <Button :disabled="busy || !detail.devices.length" @click="dialog = 'sign-out'">Разлогинить везде</Button>
          <Button v-if="account.status === 'active'" variant="danger-ghost" :disabled="busy" @click="dialog = 'block'"
            >Заблокировать</Button
          >
          <Button
            v-else-if="canUnblock && !detail.deletion?.byAdmin"
            variant="danger-ghost"
            :disabled="busy"
            @click="runInline(() => unblockAccount(userId), 'Не удалось разблокировать')"
            >Разблокировать</Button
          >
        </template>
      </div>

      <AccountBlockDialog v-if="dialog === 'block'" :name="name" :on-confirm="confirmBlock" @close="closeDialog" />
      <AccountSignOutDialog
        v-if="dialog === 'sign-out'"
        :name="name"
        :busy="busy"
        :error="actionError"
        @close="closeDialog"
        @confirm="runInline(() => signOutAccount(userId), 'Не удалось завершить сеансы')"
      />
    </template>
  </aside>
</template>
