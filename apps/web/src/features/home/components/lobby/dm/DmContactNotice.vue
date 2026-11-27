<script setup lang="ts">
import { Button, Callout } from '@voiceroom/ui-kit/components';
import { Lock } from '@lucide/vue';
import type { DirectContact } from '@voiceroom/shared/contracts/messages';
import { t } from '@/shared/i18n';
import { displayNameOf } from '@/shared/utils/display-name';
import { contactReason } from '../../../model/contact-reason';

const { contact, composer, requestPending } = defineProps<{
  contact: DirectContact;
  composer?: boolean;
  requestPending?: boolean;
}>();
const emit = defineEmits<{ add: []; block: [] }>();
</script>

<template>
  <Callout v-if="composer" role="status" :text="contactReason(contact.messageReason, contact.peer.login)">
    <template #icon><Lock aria-hidden="true" /></template>
    <template v-if="!contact.isFriend && contact.messageReason !== 'blocked'" #actions>
      <Button variant="soft" size="sm" :disabled="requestPending" @click="emit('add')">{{
        t('Добавить в друзья')
      }}</Button>
    </template>
  </Callout>
  <Callout v-else :title="t('{p0} не в ваших друзьях', { p0: displayNameOf(contact.peer) })">
    <template #actions>
      <Button variant="soft" size="sm" :disabled="requestPending" @click="emit('add')">{{
        t('Добавить в друзья')
      }}</Button>
      <Button variant="danger-ghost" size="sm" @click="emit('block')">{{ t('Заблокировать') }}</Button>
    </template>
  </Callout>
</template>
