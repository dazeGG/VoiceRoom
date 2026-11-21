<script setup lang="ts">
import { computed, onBeforeUnmount, ref } from 'vue';
import { ArrowDown, ArrowUp, Globe, Monitor, Search, Smartphone } from '@lucide/vue';
import type { AccountRow, AccountsFilter, AccountsSort, VoiceQuality } from '@voice-room/shared/contracts/admin';
import { ACCOUNT_FILTERS, SORT_COLUMNS } from '../accounts.ts';
import { fetchAccounts, fetchLiveRooms } from '../api/admin.ts';
import { formatAgo, formatCount, formatMinutes, formatNumericDate } from '../format.ts';
import { useRefreshStatus } from '../frame.ts';
import Notice from '../Notice.vue';
import { useCan } from '../staff.store.ts';
import type { CallRef } from '../tabs.ts';
import { useAdminResource } from '../use-admin-resource.ts';
import { AccountBadge, Avatar, Button, Callout, Card, EmptyState, Pill, Select, Stat, Stats, TextField } from '../ui';
import AccountCard from './AccountCard.vue';
import AccountPanel from './AccountPanel.vue';
import AccountQualityBar from './AccountQualityBar.vue';
import { qualityShares } from './rooms/quality.ts';

const props = defineProps<{ accountId: string | null }>();
const emit = defineEmits<{ openAccount: [accountId: string | null]; openCall: [call: CallRef]; showCalls: [] }>();
const canRooms = useCan('rooms.view');
const SEARCH_DELAY_MS = 250;
const REFRESH_MS = 30_000;
const numeric = new Set<AccountsSort>(['activeDays', 'voice', 'reports']);

const picked = ref<string | null>(null);
const typed = ref('');
const search = ref('');
const filter = ref<AccountsFilter>('all');
const sort = ref<AccountsSort>('created');
const order = ref<'asc' | 'desc'>('desc');
const pageNumber = ref(1);
let searchTimer: number | undefined;
onBeforeUnmount(() => window.clearTimeout(searchTimer));

const {
  data: page,
  failure,
  busy: loading,
  loadedAt,
  reload
} = useAdminResource(
  () =>
    fetchAccounts({
      filter: filter.value,
      sort: sort.value,
      order: order.value,
      page: String(pageNumber.value),
      ...(search.value ? { q: search.value } : {})
    }),
  [search, filter, sort, order, pageNumber],
  { failureText: 'Не удалось загрузить аккаунты', refreshMs: () => (props.accountId ? undefined : REFRESH_MS) }
);
const live = useAdminResource(
  () => (canRooms.value && !props.accountId ? fetchLiveRooms() : Promise.resolve(null)),
  [canRooms, () => props.accountId],
  { failureText: 'Не удалось загрузить комнаты', refreshMs: REFRESH_MS }
);
useRefreshStatus(() =>
  props.accountId ? null : { at: loadedAt.value, everyMs: REFRESH_MS, busy: loading.value, reload }
);

const liveRooms = computed(() => live.data.value?.rooms ?? []);
const inCalls = computed(() => liveRooms.value.flatMap((room) => room.peers).filter((peer) => peer.account).length);
const now = computed(() => loadedAt.value ?? 0);
const counts = computed(() => page.value?.counts);
const trouble = computed(() => counts.value?.trouble ?? 0);
const overloaded = computed(() => page.value?.cpuOverloaded ?? 0);
const filters = computed(() =>
  ACCOUNT_FILTERS.map(({ value, label }) => ({
    value,
    label: counts.value ? `${label} ${formatCount(counts.value[value] ?? 0)}` : label
  }))
);
const lastPage = computed(() => (page.value ? Math.max(1, Math.ceil(page.value.total / page.value.pageSize)) : 1));
const shownFrom = computed(() => (page.value?.total ? (page.value.page - 1) * page.value.pageSize + 1 : 0));
const shownTo = computed(() => (page.value ? Math.min(page.value.total, page.value.page * page.value.pageSize) : 0));
const nameOf = (account: AccountRow) => account.displayName || account.login;

function updateSearch(value: string): void {
  typed.value = value;
  window.clearTimeout(searchTimer);
  searchTimer = window.setTimeout(() => {
    search.value = value.trim();
    pageNumber.value = 1;
  }, SEARCH_DELAY_MS);
}
function changeFilter(value: string | undefined): void {
  const next = ACCOUNT_FILTERS.find((option) => option.value === value);
  if (!next) return;
  filter.value = next.value;
  pageNumber.value = 1;
}
function sortBy(column: (typeof SORT_COLUMNS)[number]): void {
  if (sort.value === column.sort) order.value = order.value === 'asc' ? 'desc' : 'asc';
  else {
    sort.value = column.sort;
    order.value = column.first;
  }
  pageNumber.value = 1;
}
function sortLabel(column: (typeof SORT_COLUMNS)[number]): string {
  if (sort.value !== column.sort) return column.label;
  return `${column.label}, ${order.value === 'asc' ? 'по возрастанию' : 'по убыванию'}`;
}
function qualityTone(quality: VoiceQuality): string {
  const { unstable, bad } = qualityShares(quality);
  if (bad >= 10) return 'admin-tone--danger';
  return bad >= 5 || unstable >= 10 ? 'admin-tone--warning' : '';
}
function qualityText(quality: VoiceQuality): string {
  const { bad } = qualityShares(quality);
  return bad ? `${bad}% плохих минут` : 'плохих минут нет';
}
function closeCard(): void {
  emit('openAccount', null);
  reload();
}
</script>

<template>
  <AccountCard v-if="accountId" :key="accountId" :user-id="accountId" @back="closeCard" />
  <template v-else>
    <Stats v-if="counts" label="Главное о пользователях">
      <Stat label="Аккаунтов" :note="`+${formatCount(counts.new ?? 0)} за неделю`">{{
        formatCount(counts.all ?? 0)
      }}</Stat>
      <Stat label="В сети" dot="success">
        {{ formatCount(counts.online ?? 0) }}
        <template v-if="canRooms" #note>{{ formatCount(inCalls) }} в звонках</template>
      </Stat>
      <Stat label="Активных за неделю" dot="accent">{{ formatCount(counts.active ?? 0) }}</Stat>
      <Stat v-if="trouble" label="Связь хуже нормы" dot="danger" tone="danger" note="за 30 дней, от 5 % плохих минут">
        {{ formatCount(trouble) }}
      </Stat>
      <Stat v-if="overloaded" label="Процессор перегружен" dot="warning" note="в половине звонков за 30 дней">
        {{ formatCount(overloaded) }}
      </Stat>
    </Stats>

    <div class="admin-accounts__toolbar" role="search" aria-label="Поиск аккаунта">
      <TextField
        :model-value="typed"
        type="search"
        placeholder="Имя, логин или id"
        aria-label="Поиск аккаунта"
        :maxlength="100"
        @update:model-value="updateSearch"
      >
        <template #leading><Search aria-hidden="true" /></template>
      </TextField>
      <Select :model-value="filter" :options="filters" label="Показать" @value-change="changeFilter" />
      <span v-if="page" class="admin-accounts__count">
        {{ page.total ? `${formatCount(shownFrom)}–${formatCount(shownTo)} из ${formatCount(page.total)}` : 'Никого'
        }}{{ loading ? ' · обновляем…' : '' }}
      </span>
    </div>

    <Notice v-if="failure && !page" :failure="failure" @retry="reload" />
    <template v-else>
      <Callout v-if="failure" :title="failure.message" tone="danger" role="alert" />
      <div class="admin-accounts__layout">
        <Card as="section" class="admin-accounts__list" aria-label="Аккаунты">
          <p v-if="!page" class="admin-accounts__message" aria-busy="true">Загружаем…</p>
          <EmptyState v-else-if="!page.accounts.length" title="Под этот поиск никто не подходит" compact />
          <div v-else class="admin-accounts__scroll">
            <table class="admin-accounts__table">
              <thead>
                <tr>
                  <template v-for="column in SORT_COLUMNS" :key="column.sort">
                    <th
                      scope="col"
                      :class="{ 'admin-accounts__number': numeric.has(column.sort) }"
                      :aria-sort="sort === column.sort ? (order === 'asc' ? 'ascending' : 'descending') : 'none'"
                    >
                      <Button size="sm" variant="plain" :aria-label="sortLabel(column)" @click="sortBy(column)">
                        {{ column.label }}
                        <ArrowUp v-if="sort === column.sort && order === 'asc'" aria-hidden="true" />
                        <ArrowDown v-else-if="sort === column.sort" aria-hidden="true" />
                      </Button>
                    </th>
                    <th v-if="column.sort === 'lastSeen'" scope="col">Клиенты</th>
                  </template>
                </tr>
              </thead>
              <tbody>
                <tr v-for="account in page.accounts" :key="account.id" @click="picked = account.id">
                  <td>
                    <Button
                      class="admin-accounts__person"
                      variant="plain"
                      :aria-pressed="picked === account.id"
                      @click.stop="picked = account.id"
                    >
                      <Avatar
                        :name="nameOf(account)"
                        :src="account.avatarUrl"
                        :color-key="account.avatarColorKey"
                        :background="account.avatarAccent"
                        :size="36"
                        :show-dot="account.online"
                        :online="account.online"
                      />
                      <span class="admin-accounts__identity">
                        <span class="admin-accounts__name"
                          >{{ nameOf(account) }} <AccountBadge :user-id="account.id"
                        /></span>
                        <span class="admin-accounts__identity">
                          <span class="admin-accounts__login">@{{ account.login }}</span>
                          <Pill v-if="account.admin" tone="accent" compact>сотрудник</Pill>
                          <Pill v-if="account.status === 'blocked'" tone="danger" compact>заблокирован</Pill>
                          <Pill v-if="account.status === 'deleting'" tone="danger" compact>удаляется</Pill>
                        </span>
                      </span>
                    </Button>
                  </td>
                  <td :class="account.online ? 'admin-accounts__online' : 'admin-accounts__quiet'">
                    {{ account.online ? 'в сети' : formatAgo(account.lastSeenAt, now) }}
                  </td>
                  <td>
                    <span class="admin-accounts__clients">
                      <span v-if="account.clients.desktopApp" role="img" title="Приложение" aria-label="Приложение"
                        ><Monitor aria-hidden="true"
                      /></span>
                      <span v-if="account.clients.browser" role="img" title="Браузер" aria-label="Браузер"
                        ><Globe aria-hidden="true"
                      /></span>
                      <span v-if="account.clients.mobile" role="img" title="Телефон" aria-label="Телефон"
                        ><Smartphone aria-hidden="true"
                      /></span>
                    </span>
                  </td>
                  <td class="admin-accounts__quiet">{{ formatNumericDate(account.createdAt) }}</td>
                  <td class="admin-accounts__number">{{ formatCount(account.activeDays) }}</td>
                  <td class="admin-accounts__number">{{ formatMinutes(account.voiceMinutes) }}</td>
                  <td>
                    <span v-if="account.voiceQuality30d" class="admin-accounts__quality">
                      <AccountQualityBar :quality="account.voiceQuality30d" />
                      <span :class="qualityTone(account.voiceQuality30d)">{{
                        qualityText(account.voiceQuality30d)
                      }}</span>
                    </span>
                    <span v-else class="admin-accounts__quiet">{{
                      account.voiceQuality30d === null ? 'не было в войсе' : '—'
                    }}</span>
                  </td>
                  <td
                    class="admin-accounts__number"
                    :class="account.reportsAgainst ? 'admin-accounts__reports' : 'admin-accounts__quiet'"
                  >
                    {{ account.reportsAgainst ? formatCount(account.reportsAgainst) : '—' }}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
          <footer class="admin-accounts__footer">
            <span class="admin-accounts__quiet">
              Клиенты и связь — за последние 30 дней. Активные дни и время в войсе — за последние 90 дней: дальше
              хранятся только общие счётчики без привязки к людям.
            </span>
            <nav v-if="lastPage > 1" class="admin-accounts__pages" aria-label="Страницы">
              <Button size="sm" :disabled="pageNumber <= 1 || loading" @click="pageNumber--">Назад</Button>
              <span>Страница {{ formatCount(pageNumber) }} из {{ formatCount(lastPage) }}</span>
              <Button size="sm" :disabled="pageNumber >= lastPage || loading" @click="pageNumber++">Дальше</Button>
            </nav>
          </footer>
        </Card>
        <AccountPanel
          v-if="picked"
          :key="picked"
          :user-id="picked"
          :live-rooms="liveRooms"
          @open-card="emit('openAccount', $event)"
          @open-call="emit('openCall', $event)"
          @show-calls="emit('showCalls')"
          @changed="reload"
        />
      </div>
    </template>
  </template>
</template>
