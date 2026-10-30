<script setup lang="ts">
// Active bans of one room, shown as the «Блокировки» section of the room
// settings. Bans are placed from a member's menu; this list only lifts them.
import { Ban, Clock } from '@lucide/vue';
import type { Ban as RoomBan } from '@voice-room/shared/contracts/moderation';
import { onMounted, ref } from 'vue';
import { fetchActiveBans } from '@/api/moderation';
import EmojiText from '@/shared/chat/EmojiText.vue';
import { Avatar } from '@/shared/ui';
import { iconMd, iconSm } from '@/shared/ui/icons';
import { banExpiryLabel, banSubjectName, liftRoomBan, type ModerationNotice } from '../room-moderation';

const props = withDefaults(defineProps<{ roomId: string; onNotify?: ModerationNotice }>(), { onNotify: () => {} });

const bans = ref<RoomBan[]>([]);
const nextCursor = ref<string>();
const loading = ref(true);
const loadingMore = ref(false);
const error = ref('');
const liftingId = ref('');

async function load(reset = false): Promise<void> {
  if (reset) loading.value = true;
  else loadingMore.value = true;
  error.value = '';
  try {
    const page = await fetchActiveBans(props.roomId, { cursor: reset ? undefined : nextCursor.value });
    bans.value = reset
      ? page.bans
      : [...bans.value, ...page.bans.filter((ban) => !bans.value.some((item) => item.id === ban.id))];
    nextCursor.value = page.pageInfo.nextCursor;
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : 'Не удалось загрузить блокировки';
  } finally {
    loading.value = false;
    loadingMore.value = false;
  }
}

async function lift(ban: RoomBan): Promise<void> {
  if (liftingId.value) return;
  liftingId.value = ban.id;
  try {
    if (await liftRoomBan(props.roomId, ban, props.onNotify))
      bans.value = bans.value.filter((item) => item.id !== ban.id);
  } finally {
    liftingId.value = '';
  }
}

onMounted(() => {
  void load(true);
});
</script>

<template>
  <section class="room-bans" aria-labelledby="room-bans-title" :aria-busy="loading">
    <header class="room-bans__head">
      <h3 id="room-bans-title" class="room-bans__title">
        Блокировки<span v-if="!loading && !error" class="room-bans__count"
          >{{ bans.length }}{{ nextCursor ? '+' : '' }}</span
        >
      </h3>
      <p class="room-bans__hint">
        Заблокированные не могут зайти в комнату. Заблокировать участника можно через меню «⋯» во вкладке «Участники».
      </p>
    </header>

    <div v-if="error" class="room-bans__error" role="alert">
      <span>{{ error }}</span>
      <button type="button" @click="load(true)">Повторить</button>
    </div>

    <p v-if="loading" class="room-bans__loading" aria-live="polite">Загружаем…</p>
    <div v-else-if="bans.length === 0 && !error" class="room-bans__empty">
      <span class="room-bans__empty-icon" aria-hidden="true"><Ban v-bind="iconMd" /></span>
      <strong class="room-bans__empty-title">Активных блокировок нет</strong>
      <span>Здесь появятся участники, которых вы заблокируете.</span>
    </div>
    <template v-else-if="bans.length > 0">
      <ul class="room-bans__list">
        <li v-for="ban in bans" :key="ban.id" class="room-ban">
          <Avatar
            :name="banSubjectName(ban)"
            :src="ban.subject.profile?.avatarUrl ?? null"
            :color-key="ban.subject.profile?.avatarColorKey"
            :size="36"
          />
          <div class="room-ban__body">
            <div class="room-ban__name">
              <strong class="room-ban__display-name"><EmojiText :text="banSubjectName(ban)" /></strong>
              <small v-if="ban.subject.profile" class="room-ban__login">@{{ ban.subject.profile.login }}</small>
            </div>
            <span :class="['room-ban__term', { 'room-ban__term--permanent': ban.expiresAt == null }]">
              <Clock v-bind="iconSm" aria-hidden="true" />{{ banExpiryLabel(ban) }}
            </span>
            <p v-if="ban.reason" class="room-ban__reason">{{ ban.reason }}</p>
          </div>
          <button
            class="settings__unblock-button room-ban__unblock"
            type="button"
            :aria-label="`Снять блокировку ${banSubjectName(ban)}`"
            :disabled="liftingId === ban.id"
            @click="lift(ban)"
          >
            {{ liftingId === ban.id ? 'Снимаем…' : 'Разблокировать' }}
          </button>
        </li>
      </ul>
      <button v-if="nextCursor" class="room-bans__more" type="button" :disabled="loadingMore" @click="load(false)">
        {{ loadingMore ? 'Загружаем…' : 'Показать ещё' }}
      </button>
    </template>
  </section>
</template>
