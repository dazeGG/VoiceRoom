<script setup lang="ts">
import {
  AudioLines,
  CodeXml,
  Flag,
  LayoutDashboard,
  LifeBuoy,
  Server,
  ShieldCheck,
  ThumbsUp,
  TrendingUp,
  Users
} from '@lucide/vue';
import { Badge, NavList, NavListGroup, NavListItem } from '@voiceroom/ui-kit/components';
import { computed } from 'vue';
import { TAB_GROUPS, TAB_LABELS, pathOf, type AdminTab } from '../tabs.ts';

const props = defineProps<{
  tabs: readonly AdminTab[];
  current: AdminTab;
  openReports: number;
  /** Open support conversations with a message staff have not read. */
  supportUnread?: number;
  compact?: boolean;
  previewOpen?: boolean;
}>();
const emit = defineEmits<{ select: [tab: AdminTab, event: MouseEvent] }>();

const icons = {
  overview: LayoutDashboard,
  product: TrendingUp,
  feedback: ThumbsUp,
  system: Server,
  accounts: Users,
  rooms: AudioLines,
  widgets: CodeXml,
  support: LifeBuoy,
  reports: Flag,
  staff: ShieldCheck
} satisfies Record<AdminTab, typeof LayoutDashboard>;

const groups = computed(() =>
  TAB_GROUPS.map((group) => ({
    label: group.label,
    tabs: group.tabs.filter((tab) => props.tabs.includes(tab))
  })).filter((group) => group.tabs.length > 0)
);
const count = (tab: AdminTab) =>
  tab === 'reports' ? props.openReports : tab === 'support' ? (props.supportUnread ?? 0) : 0;
const countLabel = (tab: AdminTab) => (tab === 'support' ? 'непрочитанных: ' : 'открытых: ') + String(count(tab));
</script>

<template>
  <NavList
    :label="compact ? 'Разделы, кратко' : 'Разделы'"
    class="admin-sidebar__nav"
    :class="{ 'admin-sidebar__nav--compact': compact }"
  >
    <NavListGroup v-for="group in groups" :key="group.label" v-bind="compact ? {} : { label: group.label }">
      <NavListItem
        v-for="tab in group.tabs"
        :key="tab"
        :icon-only="compact"
        class="admin-sidebar__item"
        :label="TAB_LABELS[tab]"
        :href="pathOf({ tab, accountId: null })"
        :current="tab === current"
        :title="compact ? TAB_LABELS[tab] : undefined"
        :aria-label="compact ? TAB_LABELS[tab] + (count(tab) ? ', ' + countLabel(tab) : '') : undefined"
        :tabindex="compact && previewOpen ? -1 : undefined"
        @click="emit('select', tab, $event)"
      >
        <template #icon><component :is="icons[tab]" /></template>
        <template v-if="count(tab)" #trailing>
          <Badge
            class="admin-sidebar__count"
            :count="count(tab)"
            :size="compact ? 'sm' : 'md'"
            :aria-label="compact ? undefined : countLabel(tab)"
            :aria-hidden="compact || undefined"
          />
        </template>
      </NavListItem>
    </NavListGroup>
  </NavList>
</template>
