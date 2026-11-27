<script setup lang="ts">
import { Button, Dialog, Field, TextField } from '@voiceroom/ui-kit/components';
import { Copy } from '@lucide/vue';
import { ref } from 'vue';
import { iconXs } from '@voiceroom/ui-kit/icon-defaults';
import { t } from '@/shared/i18n';
import { copyText } from '@/shared/utils/clipboard';
import { useLobby } from '../../model/lobby-context';

const { login } = defineProps<{ login: string }>();
const emit = defineEmits<{ close: []; toast: [message: string] }>();
const lobby = useLobby();
const query = ref('');
const sending = ref(false);
const copied = ref(false);

async function send(): Promise<void> {
  const login = query.value.trim().replace(/^@/, '');
  if (!login || sending.value) return;
  sending.value = true;
  try {
    const { status } = await lobby.addFriendByLogin(login);
    const messages = {
      accepted: t('Теперь вы друзья'),
      already_friends: t('Вы уже друзья'),
      already_sent: t('Заявка уже отправлена'),
      sent: t('Заявка отправлена')
    };
    emit('toast', messages[status]);
    emit('close');
  } catch (error) {
    emit('toast', error instanceof Error && error.message ? error.message : t('Не удалось отправить заявку'));
  } finally {
    sending.value = false;
  }
}

async function copyLogin(): Promise<void> {
  await copyText(login).catch(() => {});
  copied.value = true;
}
</script>

<template>
  <Dialog open :title="t('Добавить друга')" :on-close="() => emit('close')" initial-focus="[data-add-friend-login]">
    <form @submit.prevent="send">
      <Field :label="t('Логин друга')">
        <TextField
          v-model="query"
          data-add-friend-login
          size="lg"
          variant="mono"
          :placeholder="t('логин друга')"
          autocapitalize="off"
          autocomplete="off"
          spellcheck="false"
        >
          <template #leading>@</template>
          <template #action>
            <Button variant="outline" size="lg" type="submit" :disabled="sending || !query.trim()">{{
              t('Отправить заявку')
            }}</Button>
          </template>
        </TextField>
      </Field>
    </form>
    <p>
      {{ t('Ваш логин') }} <code>@{{ login }}</code>
      <Button variant="plain" size="inline" @click="copyLogin">
        <template #icon><Copy v-bind="iconXs" aria-hidden="true" /></template>
        {{ copied ? t('скопировано') : t('копировать') }}
      </Button>
      {{ t('— поделитесь им, чтобы вас нашли.') }}
    </p>
  </Dialog>
</template>
