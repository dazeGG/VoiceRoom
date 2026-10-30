<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import EmojiText from './EmojiText.vue';
import Emoji from './Emoji.vue';
import { avatarInitial } from '@/shared/utils/avatar-initial';
import type { ReactionStore } from './reaction-store';

const { store, messageId, emoji } = defineProps<{
  store: ReactionStore;
  messageId: string;
  emoji: string;
}>();

const emit = defineEmits<{ close: [] }>();

const heading = ref<HTMLHeadingElement | null>(null);
const listState = computed(() => store.reactorState(messageId, emoji));

onMounted(() => {
  void store.loadReactors(messageId, emoji);
  queueMicrotask(() => heading.value?.focus());
});
</script>

<template>
  <section class="reactor-list" aria-labelledby="reactor-list-title">
    <header class="reactor-list__header">
      <h3 id="reactor-list-title" ref="heading" class="reactor-list__title" tabindex="-1">
        Реакция <Emoji :emoji="emoji" :size="18" decorative />
      </h3>
      <button class="reactor-list__close" type="button" aria-label="Закрыть список" @click="emit('close')">×</button>
    </header>

    <p v-if="listState.error" class="reactor-list__message" role="alert">{{ listState.error }}</p>

    <ul v-if="listState.reactors.length > 0" class="reactor-list__items" aria-live="polite">
      <li v-for="reactor in listState.reactors" :key="reactor.userId" class="reactor-list__item">
        <img
          v-if="reactor.avatarUrl"
          class="reactor-list__avatar"
          :src="reactor.avatarUrl"
          alt=""
          width="28"
          height="28"
        />
        <span v-else class="reactor-list__avatar reactor-list__avatar--initial" aria-hidden="true">{{
          avatarInitial(reactor.displayName)
        }}</span>
        <span><EmojiText :text="reactor.displayName" /></span>
      </li>
    </ul>
    <p v-else-if="!listState.loading && !listState.error" class="reactor-list__message">Пока никто не отреагировал</p>

    <p v-if="listState.loading" class="reactor-list__message" aria-live="polite">Загрузка…</p>
    <button
      v-else-if="listState.nextCursor"
      class="reactor-list__more"
      type="button"
      @click="void store.loadReactors(messageId, emoji, true)"
    >
      Показать ещё
    </button>
  </section>
</template>
