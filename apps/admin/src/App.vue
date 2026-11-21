<script setup lang="ts">
import { computed, onMounted, onBeforeUnmount, ref, shallowRef, useTemplateRef, watch, watchEffect } from 'vue';
import { Spinner } from '@voice-room/ui/components';
import { fetchOpenReports, fetchOpenUserReports } from './api/admin.ts';
import { provideFrame, type RefreshStatus } from './frame.ts';
import { mountLegacyPages, type HistoryRoom } from './legacy-pages.tsx';
import AccountsPage from './pages/AccountsPage.vue';
import StaffPage from './pages/StaffPage.vue';
import GlobalSearch from './shell/GlobalSearch.vue';
import Sidebar from './shell/Sidebar.vue';
import Topbar from './shell/Topbar.vue';
import { useCan, useStaffStore } from './staff.store.ts';
import { TAB_GROUPS, TAB_LABELS, TAB_TITLES, allowedTabs, type AdminTab, type CallRef } from './tabs.ts';
import { useAdminLocation } from './use-admin-location.ts';
import Notice from './Notice.vue';

const session = useStaffStore();
const { location, go } = useAdminLocation();
const { pageTitle, refresh } = provideFrame();
const legacyRefresh = shallowRef<RefreshStatus | null>(null);
const frame = {
  setTitle: () => {},
  setRefresh: (status: RefreshStatus | null) => {
    legacyRefresh.value = status;
  }
};
const openReports = ref(0);
const canReview = useCan('reports.review');
const roomFocus = shallowRef<HistoryRoom | null>(null);
const liveFocus = shallowRef<{ roomId: string } | null>(null);
const main = useTemplateRef<HTMLElement>('main');
const pageHost = useTemplateRef<HTMLElement>('pageHost');

const tabs = computed(() => (session.staff ? allowedTabs(session.staff.permissions) : []));
const tab = computed(() => (tabs.value.includes(location.value.tab) ? location.value.tab : tabs.value[0]));
const topbarRefresh = computed(() =>
  tab.value === 'accounts' || tab.value === 'staff' ? refresh.value : legacyRefresh.value
);
const onCard = computed(() => tab.value === 'accounts' && location.value.accountId !== null);
const call = computed(() => (tab.value === 'rooms' ? location.value.call : undefined));
const crumb = computed(() => {
  if (onCard.value) return TAB_LABELS.accounts;
  if (call.value) return TAB_LABELS.rooms;
  const current = tab.value;
  return current ? (TAB_GROUPS.find((group) => group.tabs.includes(current))?.label ?? '') : '';
});
const title = computed(() => {
  if (onCard.value) return pageTitle.value ?? 'Аккаунт';
  if (call.value) return 'Звонок';
  return tab.value ? TAB_TITLES[tab.value] : '';
});

function selectTab(next: AdminTab): void {
  go({ tab: next, accountId: null });
}
function selectFromSidebar(next: AdminTab): void {
  roomFocus.value = null;
  selectTab(next);
}
function openAccount(accountId: string | null): void {
  go({ tab: 'accounts', accountId });
}
function openCall(next: CallRef): void {
  go({ tab: 'rooms', accountId: null, call: next });
}
function showCalls(): void {
  selectTab('rooms');
}
function openRoomHistory(room: HistoryRoom): void {
  roomFocus.value = room;
  selectTab('rooms');
}
function openLiveRoom(roomId: string): void {
  liveFocus.value = { roomId };
  selectTab('rooms');
}
function clearLiveFocus(): void {
  liveFocus.value = null;
}
function setOpenReports(count: number): void {
  openReports.value = count;
}
function reload(): void {
  window.location.reload();
}

onMounted(() => void session.load());
function signOut(): void {
  void session.leave().catch(() => {
    // Leaving still returns to the main site if the sign-out request failed.
  });
}

watch(canReview, (allowed, _, onCleanup) => {
  if (!allowed) return;
  let active = true;
  const load = () =>
    void Promise.all([fetchOpenReports(), fetchOpenUserReports()]).then(
      ([messages, users]) => {
        if (active) setOpenReports(messages.length + users.length);
      },
      () => {}
    );
  load();
  const timer = window.setInterval(load, 60_000);
  onCleanup(() => {
    active = false;
    window.clearInterval(timer);
  });
});

watch([tab, () => location.value.tab], ([current, requested]) => {
  if (current && current !== requested) go({ tab: current, accountId: null }, true);
});
watch([tab, () => location.value.accountId, call], () => main.value?.scrollTo?.({ top: 0 }), { flush: 'post' });

let pages: ReturnType<typeof mountLegacyPages> | undefined;
watchEffect(
  () => {
    const host = pageHost.value;
    const staff = session.staff;
    const current = tab.value;
    if (!host || !staff || !current) {
      pages?.unmount();
      pages = undefined;
      return;
    }
    pages ??= mountLegacyPages(host);
    pages.render({
      staff,
      frame,
      location: { ...location.value, tab: current },
      roomFocus: roomFocus.value,
      liveFocus: liveFocus.value,
      selectTab,
      openAccount,
      openCall,
      openRoomHistory,
      openLiveRoom,
      clearLiveFocus,
      setOpenReports
    });
  },
  { flush: 'post' }
);
onBeforeUnmount(() => pages?.unmount());
</script>

<template>
  <main v-if="session.failure" class="admin-startup admin-startup--failed">
    <Notice :failure="{ kind: 'failed', message: session.failure }" @retry="reload" />
  </main>
  <div v-else-if="session.staff && tab" class="admin-frame">
    <Sidebar
      :staff="session.staff"
      :tabs="tabs"
      :current="tab"
      :open-reports="openReports"
      @select="selectFromSidebar"
      @sign-out="signOut"
    />
    <div class="admin-frame__column">
      <Topbar
        :crumb="crumb"
        :title="title"
        :refresh="topbarRefresh"
        :still="call?.kind === 'finished' ? 'Звонок завершён · данные не меняются' : null"
      >
        <GlobalSearch @open-account="openAccount" @open-room="openRoomHistory" />
      </Topbar>
      <main ref="main" class="admin-frame__main">
        <div v-if="tab === 'accounts'" class="admin-frame__content">
          <AccountsPage
            :account-id="location.accountId"
            @open-account="openAccount"
            @open-call="openCall"
            @show-calls="showCalls"
          />
        </div>
        <div v-else-if="tab === 'staff'" class="admin-frame__content">
          <StaffPage />
        </div>
        <div v-else ref="pageHost" class="admin-frame__content" :class="{ 'admin-legacy': tab !== 'reports' }" />
      </main>
    </div>
  </div>
  <main v-else class="admin-startup">
    <div class="admin-startup__status" role="status"><Spinner />Загрузка…</div>
  </main>
</template>
