<script setup lang="ts">
import { Check, ChevronLeft, Copy, X } from '@lucide/vue';
import { computed, ref } from 'vue';
import type { AuthUser } from '@/api/auth';
import EmojiText from '@/shared/chat/EmojiText.vue';
import { Avatar, Button } from '@/shared/ui';
import { iconMd, iconSm, iconXs } from '@/shared/ui/icons';
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
      return 'Теперь вы друзья';
    case 'already_friends':
      return 'Вы уже друзья';
    case 'already_sent':
      return 'Заявка уже отправлена';
    default:
      return 'Заявка отправлена';
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
    emit('toast', error instanceof Error && error.message ? error.message : 'Не удалось отправить заявку');
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
    emit('toast', error instanceof Error && error.message ? error.message : 'Не удалось выполнить действие');
  } finally {
    busy.value = { ...busy.value, [id]: false };
  }
}

function mutualLabel(count: number): string {
  if (count === 0) return 'нет общих друзей';
  const mod10 = count % 10;
  const mod100 = count % 100;
  const word =
    mod10 === 1 && mod100 !== 11
      ? 'общий друг'
      : mod10 >= 2 && mod10 <= 4 && (mod100 < 10 || mod100 >= 20)
        ? 'общих друга'
        : 'общих друзей';
  return `${count} ${word}`;
}
</script>

<template>
  <div class="people-view">
    <button class="people-view__back" type="button" @click="emit('home')">
      <ChevronLeft v-bind="iconSm" aria-hidden="true" />
      На главную
    </button>
    <div class="people-view__title">Друзья и заявки</div>

    <div class="people-view__label people-view__label--add">Добавить друга</div>
    <div class="people-view__add-bar">
      <label class="people-view__add-field">
        <span class="people-view__add-at">@</span>
        <input
          v-model="query"
          class="people-view__add-input"
          type="text"
          placeholder="логин друга"
          aria-label="Логин друга"
          autocapitalize="off"
          autocomplete="off"
          spellcheck="false"
          @keydown="onKeydown"
        />
      </label>
      <Button
        :variant="query.trim() ? 'primary' : 'ghost'"
        size="lg"
        :disabled="sending || !query.trim()"
        @click="sendByLogin"
        >Отправить заявку</Button
      >
    </div>
    <div class="people-view__hint">
      Ваш логин <code>@{{ user.login }}</code>
      <button class="people-view__copy" type="button" @click="copyLogin">
        <Copy v-bind="iconXs" aria-hidden="true" />
        {{ copied ? 'скопировано' : 'копировать' }}
      </button>
      — поделитесь им, чтобы вас нашли.
    </div>

    <div class="people-view__label people-view__label--requests">Заявки</div>
    <div class="people-view__columns">
      <div>
        <div class="people-view__column-label">
          Входящие <span class="people-view__count">{{ incoming.length }}</span>
        </div>
        <p v-if="incoming.length === 0" class="people-view__empty">Новых заявок нет.</p>
        <template v-else>
          <div
            v-for="request in incoming"
            :key="request.id"
            class="people-view__request people-view__request--incoming"
          >
            <Avatar
              :name="displayNameOf(request.user)"
              :src="request.user.avatarUrl"
              :color-key="request.user.avatarColorKey"
              :background="request.user.avatarAccent || undefined"
              :size="44"
            />
            <div class="people-view__request-copy">
              <div class="people-view__request-name"><EmojiText :text="displayNameOf(request.user)" /></div>
              <div class="people-view__request-handle">@{{ request.user.login }}</div>
              <div class="people-view__request-meta">{{ mutualLabel(request.mutualFriends) }}</div>
            </div>
            <div class="people-view__request-actions">
              <button
                class="people-view__request-button people-view__request-button--accept"
                type="button"
                title="Принять"
                :disabled="busy[request.id]"
                @click="run(request.id, () => lobby.acceptRequest(request.id), 'Заявка принята')"
              >
                <Check v-bind="iconMd" aria-hidden="true" />
              </button>
              <button
                class="people-view__request-button people-view__request-button--decline"
                type="button"
                title="Отклонить"
                :disabled="busy[request.id]"
                @click="run(request.id, () => lobby.declineRequest(request.id), 'Заявка отклонена')"
              >
                <X v-bind="iconSm" aria-hidden="true" />
              </button>
            </div>
          </div>
        </template>
      </div>

      <div>
        <div class="people-view__column-label">
          Исходящие <span class="people-view__count">{{ outgoing.length }}</span>
        </div>
        <p v-if="outgoing.length === 0" class="people-view__empty">Вы пока никому не отправляли заявки.</p>
        <template v-else>
          <div v-for="request in outgoing" :key="request.id" class="people-view__request">
            <Avatar
              :name="displayNameOf(request.user)"
              :src="request.user.avatarUrl"
              :color-key="request.user.avatarColorKey"
              :background="request.user.avatarAccent || undefined"
              :size="44"
            />
            <div class="people-view__request-copy">
              <div class="people-view__request-name"><EmojiText :text="displayNameOf(request.user)" /></div>
              <div class="people-view__request-handle">@{{ request.user.login }}</div>
              <div class="people-view__request-pending">
                <span class="people-view__request-pending-dot"></span>заявка отправлена · ждём ответа
              </div>
            </div>
            <Button
              variant="outline"
              class="ui-button--compact"
              :disabled="busy[request.id]"
              @click="run(request.id, () => lobby.cancelRequest(request.id), 'Заявка отменена')"
              >Отменить</Button
            >
          </div>
        </template>
      </div>
    </div>
  </div>
</template>
