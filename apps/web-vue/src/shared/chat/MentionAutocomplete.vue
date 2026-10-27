<script setup lang="ts">
// Picking who to mention is picking a person, so the row carries the face
// alongside both names: two people can share a display name, and the login is
// what actually goes into the message.
import type { MembershipMember } from '@voice-room/shared/contracts/membership';
import { Avatar } from '@/shared/ui';
import { displayNameOf } from '@/shared/utils/display-name';
import EmojiText from './EmojiText.vue';

const { candidates, activeIndex = 0 } = defineProps<{ candidates: MembershipMember[]; activeIndex?: number }>();

const emit = defineEmits<{ select: [member: MembershipMember] }>();

function label(member: MembershipMember): string {
  return displayNameOf(member);
}
</script>

<template>
  <div class="mention-menu" role="listbox" aria-label="Упомянуть участника">
    <button
      v-for="(member, index) in candidates"
      :key="member.userId"
      class="mention-menu__option"
      type="button"
      role="option"
      :aria-selected="index === activeIndex"
      @mousedown.prevent
      @click="emit('select', member)"
    >
      <Avatar
        :name="label(member)"
        :src="member.avatarUrl"
        :color-key="member.avatarColorKey"
        :background="member.avatarAccent"
        :size="28"
      />
      <!-- The spaces keep the option's text as "initial name @login", as in the Svelte markup. -->
      {{ ' ' }}
      <span class="mention-menu__names">
        <span class="mention-menu__name"><EmojiText :text="label(member)" /></span>
        {{ ' ' }}
        <small class="mention-menu__login"
          >@{{ member.login }}{{ member.role === 'owner' ? ' · Создатель' : '' }}</small
        >
      </span>
    </button>
  </div>
</template>
