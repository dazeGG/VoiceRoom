<script setup lang="ts">
import { ExternalLink, LogOut, PanelLeftClose, PanelLeftOpen } from '@lucide/vue';
import { Avatar, IconButton, ListItem, Separator, type AvatarProps } from '@voice-room/ui/components';
import { computed, useId, useTemplateRef } from 'vue';
import type { StaffRole } from '@voice-room/shared/contracts/staff';
import type { Staff } from '../staff.store.ts';
import { TAB_LABELS, pathOf, type AdminTab } from '../tabs.ts';
import BrandMark from './BrandMark.vue';
import SidebarNavigation from './SidebarNavigation.vue';
import { useSidebar } from './use-sidebar.ts';

const props = defineProps<{ staff: Staff; tabs: readonly AdminTab[]; current: AdminTab; openReports: number }>();
const emit = defineEmits<{ select: [tab: AdminTab]; signOut: [] }>();

const roles: Record<StaffRole, string> = { moderator: 'модератор', admin: 'админ', superadmin: 'суперадмин' };
const {
  layoutCollapsed,
  peeking,
  visible,
  width,
  maxWidth,
  resizing,
  toggle,
  showPreview,
  hidePreview,
  startResize,
  resize,
  finishResize,
  cancelResize,
  resizeWithKeyboard
} = useSidebar();
const sidebarId = useId();
const toggleLabel = computed(() => (layoutCollapsed.value ? 'Развернуть боковую панель' : 'Свернуть боковую панель'));
const first = computed(() => props.tabs[0] ?? 'overview');
const user = computed(() => props.staff.user);
const avatar = computed<AvatarProps>(() => ({
  name: user.value.displayName,
  src: user.value.avatarUrl,
  colorKey: user.value.avatarColorKey,
  background: user.value.avatarAccent,
  size: 32
}));
const toggleHost = useTemplateRef<HTMLElement>('toggleHost');

function select(tab: AdminTab, event: MouseEvent): void {
  if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button !== 0) return;
  event.preventDefault();
  hidePreview();
  emit('select', tab);
}

function resizeFromKey(event: KeyboardEvent): void {
  resizeWithKeyboard(event);
  if (layoutCollapsed.value) toggleHost.value?.querySelector('button')?.focus();
}
</script>

<template>
  <div
    class="admin-sidebar"
    :class="{ 'admin-sidebar--collapsed': layoutCollapsed, 'admin-sidebar--resizing': resizing }"
    :style="{ '--admin-sidebar-width': width + 'px' }"
    @pointerenter="showPreview"
    @pointerleave="hidePreview"
  >
    <div v-if="layoutCollapsed" class="admin-sidebar__rail">
      <BrandMark class="admin-sidebar__mark" />
      <SidebarNavigation
        :tabs="tabs"
        :current="current"
        :open-reports="openReports"
        compact
        :preview-open="visible"
        @select="select"
      />
      <div class="admin-sidebar__rail-profile" :title="user.displayName"><Avatar v-bind="avatar" /></div>
    </div>
    <div ref="toggleHost" class="admin-sidebar__toggle" :class="{ 'admin-sidebar__toggle--peek': peeking }">
      <IconButton :label="toggleLabel" :aria-controls="sidebarId" :aria-expanded="visible" @click="toggle">
        <PanelLeftOpen v-if="layoutCollapsed" aria-hidden="true" />
        <PanelLeftClose v-else aria-hidden="true" />
      </IconButton>
    </div>
    <aside v-if="visible" :id="sidebarId" class="admin-sidebar__panel">
      <a
        class="admin-sidebar__brand"
        :href="pathOf({ tab: first, accountId: null })"
        :title="TAB_LABELS[first]"
        @click="select(first, $event)"
      >
        <BrandMark class="admin-sidebar__mark" label="VoiceRoom" />
        <span><strong>VoiceRoom</strong><small>Админка</small></span>
      </a>
      <SidebarNavigation :tabs="tabs" :current="current" :open-reports="openReports" @select="select" />
      <div class="admin-sidebar__profile">
        <ListItem
          class="admin-sidebar__profile-details"
          :text="user.displayName"
          :caption="'@' + user.login + ' · ' + roles[staff.role]"
        >
          <template #leading>
            <span class="admin-sidebar__presence" role="img" aria-label="в сети"
              ><Avatar v-bind="avatar" show-dot online
            /></span>
          </template>
        </ListItem>
        <div class="admin-sidebar__actions">
          <IconButton :href="staff.siteUrl" label="Открыть VoiceRoom" target="_blank" rel="noopener">
            <ExternalLink aria-hidden="true" />
          </IconButton>
          <IconButton label="Выйти из админки" @click="emit('signOut')"><LogOut aria-hidden="true" /></IconButton>
        </div>
      </div>
    </aside>
    <Separator
      v-if="!layoutCollapsed || resizing"
      variant="resize"
      orientation="vertical"
      class="admin-sidebar__resizer"
      tabindex="0"
      :aria-controls="sidebarId"
      aria-label="Ширина боковой панели"
      :aria-valuemin="0"
      :aria-valuemax="maxWidth"
      :aria-valuenow="width"
      @pointerdown="startResize"
      @pointermove="resize"
      @pointerup="finishResize"
      @pointercancel="cancelResize"
      @keydown="resizeFromKey"
    />
  </div>
</template>
