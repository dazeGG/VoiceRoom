<script setup lang="ts">
import { t } from '@/shared/i18n';
import { Ban, Ellipsis, User, UserX } from '@lucide/vue';
import { presenceOfMember, type MembershipMember } from '@voice-room/shared/contracts/membership';
import { computed, ref, watch } from 'vue';
import type { ModerationDuration } from '@/api/moderation';
import { useProfileCardUiStore } from '@/entities/profile-card/profile-card-ui.store';
import { useSessionStore } from '@/features/auth/session.store';
import type { ProfileCardPerson } from '@/shared/components/profile-card';
import { AccountBadge, DropdownMenu, MenuSeparator, MenuItem, MenuSub } from '@/shared/ui';
import { EmptyState, IconButton, ListItem } from '@voice-room/ui/components';
import { iconMd } from '@/shared/ui/icons';
import { displayNameOf } from '@/shared/utils/display-name';
import { BAN_DURATIONS, banRoomMember, kickRoomMember, type ModerationNotice } from '../room-moderation';
import { useRoomMembershipStore } from '../room-membership.store';
import { useRoomPresenceStore } from '../room-presence.store';

const props = withDefaults(
  defineProps<{
    roomId: string;
    /** Owner view: members other than the owner get a moderation menu. */
    canModerate?: boolean;
    onNotify?: ModerationNotice;
  }>(),
  { canModerate: false, onNotify: () => {} }
);

const membership = useRoomMembershipStore();
const presence = useRoomPresenceStore();
const session = useSessionStore();
const { openProfileCardFor, previewProfileCardFor, leaveProfileCardPreview } = useProfileCardUiStore();

const roster = computed(() => membership.byRoomId[props.roomId] ?? null);
const onlineMembers = computed(() =>
  (roster.value?.members ?? []).filter((member) => member.presenceStatus !== 'offline')
);
const offlineMembers = computed(() =>
  (roster.value?.members ?? []).filter((member) => member.presenceStatus === 'offline')
);
const groups = computed(() => [
  { heading: t('В сети'), label: t('Участники в сети'), members: onlineMembers.value },
  { heading: t('Не в сети'), label: t('Участники не в сети'), members: offlineMembers.value }
]);

const banningUserId = ref('');
// The menu trigger that opened the current member menu; the profile card
// anchors to it because the menu item itself is gone once the menu closes.
let menuAnchor: HTMLElement | null = null;

// The roster is account-only: the API answers a guest with 401.
const signedIn = computed(() => Boolean(session.user?.id));

watch(
  [() => props.roomId, () => session.user?.id],
  ([currentRoomId, isSignedIn]) => {
    if (!isSignedIn) return;
    membership.getRoomMembership(currentRoomId);
    void membership.loadRoomMembership(currentRoomId);
  },
  { immediate: true }
);

function nameFor(member: MembershipMember): string {
  return displayNameOf(member);
}

function canModerateMember(member: MembershipMember): boolean {
  return props.canModerate && member.role !== 'owner' && member.userId !== session.user?.id;
}

function profilePerson(member: MembershipMember): ProfileCardPerson {
  return {
    userId: member.userId,
    name: nameFor(member),
    login: member.login,
    avatarUrl: member.avatarUrl,
    avatarColorKey: member.avatarColorKey,
    avatarAccent: member.avatarAccent,
    presence: presenceOfMember(member.presenceStatus)
  };
}

function rememberMenuAnchor(event: MouseEvent | KeyboardEvent): void {
  menuAnchor = event.currentTarget instanceof HTMLElement ? event.currentTarget : null;
}

function openMemberProfile(member: MembershipMember, event: MouseEvent): void {
  openProfileCardFor(profilePerson(member), event.currentTarget);
}

function showProfileFromMenu(member: MembershipMember, close: (restoreFocus?: boolean) => void): void {
  const anchor = menuAnchor;
  close(false);
  // Deferred so the closing menu does not swallow the card's own outside-click
  // listener during the same pointer event.
  queueMicrotask(() => openProfileCardFor(profilePerson(member), anchor));
}

// Only someone in the call has a live peer to take out of it.
function livePeerId(member: MembershipMember): string {
  const peers = presence.peersByRoomId[props.roomId] ?? [];
  return peers.find((peer) => peer.accountUserId === member.userId)?.id ?? '';
}

async function kick(member: MembershipMember): Promise<void> {
  const peerId = livePeerId(member);
  if (banningUserId.value || !peerId) return;
  banningUserId.value = member.userId;
  try {
    await kickRoomMember(props.roomId, { peerId, name: nameFor(member) }, props.onNotify);
  } finally {
    banningUserId.value = '';
  }
}

async function ban(member: MembershipMember, duration: ModerationDuration): Promise<void> {
  if (banningUserId.value) return;
  banningUserId.value = member.userId;
  try {
    await banRoomMember(props.roomId, { userId: member.userId, name: nameFor(member) }, duration, props.onNotify);
  } finally {
    banningUserId.value = '';
  }
}
</script>

<template>
  <section class="room-member-list" :aria-label="t('Участники комнаты')">
    <div aria-live="polite" aria-atomic="true" class="room-member-list__sr-only">
      <template v-if="roster?.loading">{{ t('Загрузка участников') }}</template>
      <template v-if="roster?.error">{{ roster.error }}</template>
    </div>

    <div v-if="!signedIn" class="room-member-list__notice">
      <p>{{ t('Список участников виден после входа в аккаунт.') }}</p>
    </div>
    <div v-else-if="roster?.error && roster.members.length === 0" class="room-member-list__notice" role="alert">
      <p>{{ roster.error }}</p>
      <button type="button" @click="membership.loadRoomMembership(roomId)">{{ t('Повторить') }}</button>
    </div>
    <template v-else>
      <template v-for="group in groups" :key="group.heading">
        <h3 class="room-member-list__heading">
          {{ group.heading }} <span class="room-member-list__count">{{ group.members.length }}</span>
        </h3>
        <ul class="room-member-list__list" :aria-label="group.label">
          <li v-for="member in group.members" :key="member.userId" class="room-member-list__item">
            <ListItem
              interactive
              aria-haspopup="dialog"
              :aria-label="t('Профиль {p0}', { p0: nameFor(member) })"
              :avatar="{
                name: nameFor(member),
                src: member.avatarUrl,
                colorKey: member.avatarColorKey,
                showDot: true,
                online: member.presenceStatus !== 'offline',
                dnd: member.presenceStatus === 'dnd',
                afk: member.presenceStatus === 'afk'
              }"
              :caption="'@' + member.login"
              @pointerenter="previewProfileCardFor(profilePerson(member), $event)"
              @pointerleave="leaveProfileCardPreview"
              @focus="previewProfileCardFor(profilePerson(member), $event)"
              @blur="leaveProfileCardPreview"
              @activate="openMemberProfile(member, $event)"
            >
              <template #title>
                {{ nameFor(member) }}<AccountBadge :user-id="member.userId" />
                <em v-if="member.userId === session.user?.id" class="room-member-list__you">{{ t('вы') }}</em>
              </template>
              <template v-if="canModerateMember(member)" #actions>
                <DropdownMenu
                  :aria-label="t('Действия с {p0}', { p0: nameFor(member) })"
                  :disabled="banningUserId === member.userId"
                >
                  <template #trigger>
                    <IconButton
                      :size="28"
                      :label="t('Действия с {p0}', { p0: nameFor(member) })"
                      @click="rememberMenuAnchor"
                      @keydown="rememberMenuAnchor"
                    >
                      <Ellipsis aria-hidden="true" />
                    </IconButton>
                  </template>

                  <template #content="{ close }">
                    <MenuItem :label="t('Профиль')" @select.prevent="showProfileFromMenu(member, close)">
                      <template #icon><User v-bind="iconMd" aria-hidden="true" /></template>
                    </MenuItem>
                    <MenuSeparator />
                    <MenuItem
                      :label="t('Выгнать')"
                      tone="danger"
                      :disabled="!livePeerId(member)"
                      @select.prevent="
                        close();
                        void kick(member);
                      "
                    >
                      <template #icon><UserX v-bind="iconMd" aria-hidden="true" /></template>
                    </MenuItem>
                    <MenuSub
                      :label="t('Заблокировать')"
                      tone="danger"
                      :aria-label="t('Срок блокировки {p0}', { p0: nameFor(member) })"
                    >
                      <template #icon><Ban v-bind="iconMd" aria-hidden="true" /></template>
                      <template #default="{ close: closeSubmenu }">
                        <MenuItem
                          v-for="option in BAN_DURATIONS"
                          :key="option.value"
                          :label="option.label"
                          tone="danger"
                          @select.prevent="
                            closeSubmenu();
                            close();
                            void ban(member, option.value);
                          "
                        />
                      </template>
                    </MenuSub>
                  </template>
                </DropdownMenu>
              </template>
            </ListItem>
          </li>
        </ul>
      </template>

      <button
        v-if="roster?.hasMore"
        class="room-member-list__more"
        type="button"
        :disabled="roster.loading"
        @click="membership.loadRoomMembership(roomId, { append: true })"
      >
        {{ roster.loading ? t('Загрузка…') : t('Показать ещё') }}
      </button>
      <EmptyState v-else-if="roster?.loaded && roster.members.length === 0" :title="t('Никого не найдено')" compact />
    </template>
  </section>
</template>
