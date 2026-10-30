<script setup lang="ts">
import { Check, MessageSquare, UserMinus, UserPlus } from '@lucide/vue';
import { computed } from 'vue';
import { AccountBadge, Avatar, Button, Ellipsis } from '@/shared/ui';
import { iconSm } from '@/shared/ui/icons';
import { dayMonthYear } from '@/shared/utils/date-format';
import { getAvatarColor } from '@/visual/tokens';
import type { ProfileCardProps } from './types';

const props = withDefaults(defineProps<ProfileCardProps>(), { friendsSince: null, busy: false });

// The card itself takes the person's avatar colour, washed into the surface
// from the top, so it reads as theirs even when they use a photo — where the
// accent would otherwise be invisible.
const accent = computed(() => props.person.avatarAccent || getAvatarColor(props.person.avatarColorKey).background);
const friendsSinceLabel = computed(() => {
  if (props.relationship !== 'friend' || !props.friendsSince) return '';
  return dayMonthYear(props.friendsSince);
});
</script>

<template>
  <div class="profile-card" data-profile-card :style="{ '--profile-accent': accent }">
    <div class="profile-card__body">
      <span class="profile-card__avatar">
        <Avatar
          :name="person.name"
          :src="person.avatarUrl"
          :color-key="person.avatarColorKey"
          :background="person.avatarAccent || undefined"
          :size="72"
          :online="person.presence === 'online'"
          :afk="person.presence === 'away'"
          :dnd="person.presence === 'dnd'"
          :show-dot="relationship !== 'unavailable'"
          ring="var(--vr-surface-2)"
        />
      </span>

      <span class="profile-card__identity">
        <span class="profile-card__name-row">
          <Ellipsis class="profile-card__name" :text="person.name" tag="span" />
          <AccountBadge :user-id="person.userId" :size="18" />
        </span>
        <Ellipsis v-if="person.login" class="profile-card__handle" :text="`@${person.login}`" tag="span" />
      </span>

      <span v-if="friendsSinceLabel" class="profile-card__since">
        <span class="profile-card__since-label">Знакомы с</span>
        <span class="profile-card__since-value">{{ friendsSinceLabel }}</span>
      </span>

      <!-- Identity only for 'self': social actions against your own account are invalid. -->
      <template v-if="relationship === 'self'" />
      <p v-else-if="relationship === 'unavailable'" class="profile-card__note">
        Гость комнаты — профиль и дружба недоступны.
      </p>
      <p v-else-if="relationship === 'outgoing'" class="profile-card__note">Заявка в друзья уже отправлена.</p>
      <div v-else class="profile-card__actions">
        <template v-if="relationship === 'friend'">
          <Button variant="primary" :disabled="busy" @click="onMessage?.()">
            <template #icon><MessageSquare v-bind="iconSm" aria-hidden="true" /></template>
            Написать
          </Button>
          <Button variant="danger-ghost" :disabled="busy" @click="onRemoveFriend?.()">
            <template #icon><UserMinus v-bind="iconSm" aria-hidden="true" /></template>
            Удалить из друзей
          </Button>
        </template>
        <Button v-else-if="relationship === 'incoming'" variant="primary" :disabled="busy" @click="onAcceptRequest?.()">
          <template #icon><Check v-bind="iconSm" aria-hidden="true" /></template>
          Принять заявку
        </Button>
        <Button v-else variant="soft" :disabled="busy" @click="onAddFriend?.()">
          <template #icon><UserPlus v-bind="iconSm" aria-hidden="true" /></template>
          Добавить в друзья
        </Button>
      </div>
    </div>
  </div>
</template>
