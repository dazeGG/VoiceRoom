<script setup lang="ts">
import { EmptyState, Field, IconButton, ListItem, TextField, Button } from '@voice-room/ui/components';
import { getLocale, t } from '@/shared/i18n';
import { Check, ChevronLeft, Copy, X } from '@lucide/vue';
import { computed, ref } from 'vue';
import type { AuthUser } from '@/api/auth';
import EmojiText from '@/shared/chat/EmojiText.vue';
import { iconSm, iconXs } from '@voice-room/ui/icon-defaults';
import { copyText } from '@/shared/utils/clipboard';
import { displayNameOf } from '@/shared/utils/display-name';
import { useLobby } from '../../model/lobby-context';

const lobby = useLobby();

const { user } = defineProps<{ user: AuthUser }>();

const emit = defineEmits<{ toast: [message: string]; home: [] }>();

const query = ref('');
const sending = ref(false);
const copied = ref(false);
const busy = ref<Record<string, boolean>>({});

const incoming = computed(() => lobby.requests.incoming);
const outgoing = computed(() => lobby.requests.outgoing);

function statusMessage(status: string): string {
  switch (status) {
    case 'accepted':
      return t('Теперь вы друзья');
    case 'already_friends':
      return t('Вы уже друзья');
    case 'already_sent':
      return t('Заявка уже отправлена');
    default:
      return t('Заявка отправлена');
  }
}

async function sendByLogin(): Promise<void> {
  const login = query.value.trim().replace(/^@/, '');
  if (!login || sending.value) return;
  sending.value = true;
  try {
    const { status } = await lobby.addFriendByLogin(login);
    emit('toast', statusMessage(status));
    query.value = '';
  } catch (error) {
    emit('toast', error instanceof Error && error.message ? error.message : t('Не удалось отправить заявку'));
  } finally {
    sending.value = false;
  }
}

async function copyLogin(): Promise<void> {
  try {
    await copyText(user.login);
  } catch {
    // Clipboard may be unavailable; still show feedback.
  }
  copied.value = true;
  window.setTimeout(() => (copied.value = false), 2000);
}

function onKeydown(event: KeyboardEvent): void {
  if (event.key === 'Enter') {
    event.preventDefault();
    void sendByLogin();
  }
}

async function run(id: string, action: () => Promise<void>, ok: string): Promise<void> {
  if (busy.value[id]) return;
  busy.value = { ...busy.value, [id]: true };
  try {
    await action();
    emit('toast', ok);
  } catch (error) {
    emit('toast', error instanceof Error && error.message ? error.message : t('Не удалось выполнить действие'));
  } finally {
    busy.value = { ...busy.value, [id]: false };
  }
}

function mutualLabel(count: number): string {
  if (count === 0) return t('нет общих друзей');
  const category = new Intl.PluralRules(getLocale()).select(count);
  if (category === 'one') return t('{p0} общий друг', { p0: count });
  if (getLocale() === 'ru' && category === 'few') return t('{p0} общих друга', { p0: count });
  return t('{p0} общих друзей', { p0: count });
}
</script>

<template>
  <div class="people-view">
    <Button variant="plain" size="sm" class="people-view__back" @click="emit('home')">
      <template #icon><ChevronLeft v-bind="iconSm" aria-hidden="true" /></template>
      {{ t('На главную') }}
    </Button>
    <div class="people-view__title">{{ t('Друзья и заявки') }}</div>

    <div class="people-view__label people-view__label--add">{{ t('Добавить друга') }}</div>
    <div class="people-view__add-bar">
      <Field class="people-view__add-field" :label="t('Логин друга')">
        <TextField
          v-model="query"
          variant="mono"
          :placeholder="t('логин друга')"
          autocapitalize="off"
          autocomplete="off"
          spellcheck="false"
          @keydown="onKeydown"
        >
          <template #leading>@</template>
        </TextField>
      </Field>
      <Button :variant="query.trim() ? 'primary' : 'ghost'" :disabled="sending || !query.trim()" @click="sendByLogin">{{
        t('Отправить заявку')
      }}</Button>
    </div>
    <div class="people-view__hint">
      {{ t('Ваш логин') }} <code>@{{ user.login }}</code>
      <Button variant="plain" size="inline" class="people-view__copy" @click="copyLogin">
        <template #icon><Copy v-bind="iconXs" aria-hidden="true" /></template>
        {{ copied ? t('скопировано') : t('копировать') }}
      </Button>
      {{ t('— поделитесь им, чтобы вас нашли.') }}
    </div>

    <div class="people-view__label people-view__label--requests">{{ t('Заявки') }}</div>
    <div class="people-view__columns">
      <div>
        <div class="people-view__column-label">
          {{ t('Входящие') }} <span class="people-view__count">{{ incoming.length }}</span>
        </div>
        <EmptyState v-if="incoming.length === 0" :title="t('Новых заявок нет.')" compact />
        <template v-else>
          <ListItem
            v-for="request in incoming"
            :key="request.id"
            :avatar="{
              name: displayNameOf(request.user),
              src: request.user.avatarUrl,
              colorKey: request.user.avatarColorKey,
              background: request.user.avatarAccent
            }"
          >
            <template #title><EmojiText :text="displayNameOf(request.user)" /></template>
            <template #caption>
              @{{ request.user.login }} <span aria-hidden="true">·</span>
              <span>{{ mutualLabel(request.mutualFriends) }}</span>
            </template>
            <template #actions>
              <IconButton
                :label="t('Принять')"
                variant="primary"
                :size="28"
                :disabled="busy[request.id]"
                @click="run(request.id, () => lobby.acceptRequest(request.id), t('Заявка принята'))"
              >
                <Check aria-hidden="true" />
              </IconButton>
              <IconButton
                :label="t('Отклонить')"
                variant="danger"
                :size="28"
                :disabled="busy[request.id]"
                @click="run(request.id, () => lobby.declineRequest(request.id), t('Заявка отклонена'))"
              >
                <X aria-hidden="true" />
              </IconButton>
            </template>
          </ListItem>
        </template>
      </div>

      <div>
        <div class="people-view__column-label">
          {{ t('Исходящие') }} <span class="people-view__count">{{ outgoing.length }}</span>
        </div>
        <EmptyState v-if="outgoing.length === 0" :title="t('Вы пока никому не отправляли заявки.')" compact />
        <template v-else>
          <ListItem
            v-for="request in outgoing"
            :key="request.id"
            :avatar="{
              name: displayNameOf(request.user),
              src: request.user.avatarUrl,
              colorKey: request.user.avatarColorKey,
              background: request.user.avatarAccent
            }"
            :caption="`@${request.user.login} · ${t('заявка отправлена · ждём ответа')}`"
          >
            <template #title><EmojiText :text="displayNameOf(request.user)" /></template>
            <template #actions>
              <IconButton
                :label="t('Отменить')"
                variant="default"
                :size="28"
                :disabled="busy[request.id]"
                @click="run(request.id, () => lobby.cancelRequest(request.id), t('Заявка отменена'))"
              >
                <X aria-hidden="true" />
              </IconButton>
            </template>
          </ListItem>
        </template>
      </div>
    </div>
  </div>
</template>
