<script setup lang="ts">
import { Ban, Ellipsis, User, UserX } from '@lucide/vue';
import { presenceOfMember, type MembershipMember } from '@voice-room/shared/contracts/membership';
import { computed, ref, watch } from 'vue';
import type { ModerationDuration } from '@/api/moderation';
import { useProfileCardUiStore } from '@/entities/profile-card/profile-card-ui.store';
import { useSessionStore } from '@/features/auth/session.store';
import type { ProfileCardPerson } from '@/shared/components/profile-card';
import { AccountBadge, Popover, PopoverDivider, PopoverMenuItem, PopoverSubmenu } from '@/shared/ui';
import Avatar from '@/shared/ui/Avatar/Avatar.vue';
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
const { openProfileCardFor } = useProfileCardUiStore();

const roster = computed(() => membership.byRoomId[props.roomId] ?? null);
const onlineMembers = computed(() =>
  (roster.value?.members ?? []).filter((member) => member.presenceStatus !== 'offline')
);
const offlineMembers = computed(() =>
  (roster.value?.members ?? []).filter((member) => member.presenceStatus === 'offline')
);
const groups = computed(() => [
  { heading: 'В сети', label: 'Участники в сети', members: onlineMembers.value },
  { heading: 'Не в сети', label: 'Участники не в сети', members: offlineMembers.value }
]);

const banningUserId = ref('');
// The menu trigger that opened the current member menu; the profile card
// anchors to it because the menu item itself is gone once the menu closes.
let menuAnchor: HTMLElement | null = null;

// The roster is account-only: the API answers a guest with 401.
const signedIn = computed(() => Boolean(session.user?.id));

watch(
  [() => props.roomId, signedIn],
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

function toggleMenu(event: MouseEvent, toggle: () => void): void {
  menuAnchor = event.currentTarget instanceof HTMLElement ? event.currentTarget : null;
  toggle();
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
  <section class="room-member-list" aria-label="Участники комнаты">
    <div aria-live="polite" aria-atomic="true" class="room-member-list__sr-only">
      <template v-if="roster?.loading">Загрузка участников</template>
      <template v-if="roster?.error">{{ roster.error }}</template>
    </div>

    <div v-if="!signedIn" class="room-member-list__notice">
      <p>Список участников виден после входа в аккаунт.</p>
    </div>
    <div v-else-if="roster?.error && roster.members.length === 0" class="room-member-list__notice" role="alert">
      <p>{{ roster.error }}</p>
      <button type="button" @click="membership.loadRoomMembership(roomId)">Повторить</button>
    </div>
    <template v-else>
      <template v-for="group in groups" :key="group.heading">
        <h3 class="room-member-list__heading">
          {{ group.heading }} <span class="room-member-list__count">{{ group.members.length }}</span>
        </h3>
        <ul class="room-member-list__list" :aria-label="group.label">
          <li v-for="member in group.members" :key="member.userId" class="room-member-list__item">
            <div class="room-member-list__row">
              <button
                class="room-member-list__member"
                type="button"
                aria-haspopup="dialog"
                :aria-label="`Профиль ${nameFor(member)}`"
                @click="openMemberProfile(member, $event)"
              >
                <Avatar
                  :name="nameFor(member)"
                  :src="member.avatarUrl"
                  :color-key="member.avatarColorKey"
                  :size="32"
                  show-dot
                  :online="member.presenceStatus !== 'offline'"
                  :dnd="member.presenceStatus === 'dnd'"
                  :afk="member.presenceStatus === 'afk'"
                />
                <span class="room-member-list__text"
                  ><strong class="room-member-list__name"
                    >{{ nameFor(member) }}<AccountBadge :user-id="member.userId" /><em
                      v-if="member.userId === session.user?.id"
                      class="room-member-list__you"
                      >вы</em
                    ></strong
                  ><small class="room-member-list__login">@{{ member.login }}</small></span
                >
              </button>

              <Popover
                v-if="canModerateMember(member)"
                placement="bottom-end"
                flip
                floating
                role="menu"
                :aria-label="`Действия с ${nameFor(member)}`"
                root-class="room-member-list__menu-root"
              >
                <template #trigger="{ open, toggle, panelId }">
                  <button
                    class="room-member-list__menu-trigger"
                    type="button"
                    :aria-label="`Действия с ${nameFor(member)}`"
                    title="Действия"
                    aria-haspopup="menu"
                    :aria-expanded="open"
                    :aria-controls="panelId"
                    :disabled="banningUserId === member.userId"
                    @click="toggleMenu($event, toggle)"
                  >
                    <Ellipsis v-bind="iconMd" aria-hidden="true" />
                  </button>
                </template>

                <template #content="{ close }">
                  <div class="room-member-list__menu">
                    <PopoverMenuItem label="Профиль" @click="showProfileFromMenu(member, close)">
                      <template #icon><User v-bind="iconMd" aria-hidden="true" /></template>
                    </PopoverMenuItem>
                    <PopoverDivider />
                    <PopoverMenuItem
                      label="Выгнать"
                      variant="danger"
                      :disabled="!livePeerId(member)"
                      @click="
                        close();
                        void kick(member);
                      "
                    >
                      <template #icon><UserX v-bind="iconMd" aria-hidden="true" /></template>
                    </PopoverMenuItem>
                    <PopoverSubmenu label="Заблокировать" :aria-label="`Срок блокировки ${nameFor(member)}`">
                      <template #icon><Ban v-bind="iconMd" aria-hidden="true" /></template>
                      <template #default="{ close: closeSubmenu }">
                        <PopoverMenuItem
                          v-for="option in BAN_DURATIONS"
                          :key="option.value"
                          :label="option.label"
                          variant="danger"
                          @click="
                            closeSubmenu();
                            close();
                            void ban(member, option.value);
                          "
                        />
                      </template>
                    </PopoverSubmenu>
                  </div>
                </template>
              </Popover>
            </div>
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
        {{ roster.loading ? 'Загрузка…' : 'Показать ещё' }}
      </button>
      <p v-else-if="roster?.loaded && roster.members.length === 0" class="room-member-list__empty">Никого не найдено</p>
    </template>
  </section>
</template>
