<script setup lang="ts">
import { SuggestionList, type ComboboxOption, Avatar } from '@voiceroom/ui-kit/components';
import type { MembershipMember } from '@voiceroom/shared/contracts/membership';
import { computed, useId } from 'vue';
import { t } from '@/shared/i18n';
import { displayNameOf } from '@/shared/utils/display-name';
import EmojiText from './EmojiText.vue';

const props = withDefaults(defineProps<{ id?: string; candidates: MembershipMember[]; activeIndex?: number }>(), {
  id: '',
  activeIndex: 0
});
const fallbackId = useId();
const emit = defineEmits<{ select: [member: MembershipMember] }>();

const people = computed(() => new Map(props.candidates.map((member) => [member.userId, member])));
const options = computed<ComboboxOption[]>(() =>
  props.candidates.map((member) => ({
    value: member.userId,
    label: displayNameOf(member),
    description: '@' + member.login + (member.role === 'owner' ? t(' · Создатель') : '')
  }))
);

function select(option: ComboboxOption): void {
  const member = people.value.get(option.value);
  if (member) emit('select', member);
}
</script>

<template>
  <SuggestionList
    :id="props.id || fallbackId"
    class="mention-menu"
    :label="t('Упомянуть участника')"
    :active="candidates[activeIndex]?.userId"
    :options="options"
    @select="select"
  >
    <template #avatar="{ option }">
      <Avatar
        :name="option.label"
        :src="people.get(option.value)?.avatarUrl"
        :color-key="people.get(option.value)?.avatarColorKey"
        :background="people.get(option.value)?.avatarAccent"
        :size="28"
      />
    </template>
    <template #option="{ option }"><EmojiText :text="option.label" /></template>
  </SuggestionList>
</template>
