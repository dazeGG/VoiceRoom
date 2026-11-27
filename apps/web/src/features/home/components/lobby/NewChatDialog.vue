<script setup lang="ts">
import { Avatar, Callout, Dialog, EmptyState, Field, ListItem, TextField } from '@voiceroom/ui-kit/components';
import { iconSm } from '@voiceroom/ui-kit/icon-defaults';
import { Lock, Search } from '@lucide/vue';
import { computed, ref, watch } from 'vue';
import { searchPeople, type SearchResult } from '@/api/friends';
import EmojiText from '@/shared/chat/EmojiText.vue';
import { t } from '@/shared/i18n';
import { displayNameOf } from '@/shared/utils/display-name';
import { useLobby } from '../../model/lobby-context';

const emit = defineEmits<{ close: []; open: [userId: string] }>();
const lobby = useLobby();
const query = ref('');
const term = computed(() => query.value.trim().replace(/^@/, ''));
const matches = ref<SearchResult[]>([]);
const searched = ref('');
const failed = ref(false);
const results = computed(() => {
  if (term.value) return searched.value === term.value ? matches.value : [];
  return lobby.friends.slice(0, 20).map(({ user, online }) => ({ user, online, relationship: 'friend' as const }));
});

async function runSearch(value: string, signal: AbortSignal): Promise<void> {
  try {
    const result = await searchPeople(value, signal);
    if (!signal.aborted) matches.value = result;
  } catch {
    if (!signal.aborted) failed.value = true;
  } finally {
    if (!signal.aborted) searched.value = value;
  }
}

watch(term, (value, _previous, onCleanup) => {
  matches.value = [];
  searched.value = '';
  failed.value = false;
  if (!value) return;
  const controller = new AbortController();
  const timer = setTimeout(() => void runSearch(value, controller.signal), 200);
  onCleanup(() => {
    clearTimeout(timer);
    controller.abort();
  });
});

function select(result: SearchResult): void {
  if (result.relationship === 'friend') emit('open', result.user.id);
}
</script>

<template>
  <Dialog open :title="t('Новый чат')" :on-close="() => emit('close')" initial-focus="[data-new-chat-search]">
    <div class="new-chat">
      <Field :label="t('Логин или имя')">
        <TextField
          v-model="query"
          data-new-chat-search
          type="search"
          :placeholder="t('Логин или имя')"
          autocomplete="off"
          autocapitalize="off"
          spellcheck="false"
        >
          <template #leading><Search v-bind="iconSm" aria-hidden="true" /></template>
        </TextField>
      </Field>
      <Callout v-if="failed" tone="warning" :text="t('Не удалось найти людей')" />
      <EmptyState
        v-else-if="term && searched === term && results.length === 0"
        :title="t('Ничего не найдено')"
        compact
      />
      <div class="new-chat__results" :aria-busy="Boolean(term && searched !== term)">
        <ListItem
          v-for="result in results"
          :key="result.user.id"
          interactive
          :disabled="result.relationship !== 'friend'"
          :caption="result.relationship === 'friend' ? t('Можно написать') : t('Только друзьям')"
          @activate="select(result)"
        >
          <template #leading>
            <Avatar
              :name="displayNameOf(result.user)"
              :src="result.user.avatarUrl"
              :color-key="result.user.avatarColorKey"
              :background="result.user.avatarAccent"
              :size="36"
            />
          </template>
          <template #title><EmojiText :text="displayNameOf(result.user)" /> @{{ result.user.login }}</template>
          <template v-if="result.relationship !== 'friend'" #meta><Lock v-bind="iconSm" aria-hidden="true" /></template>
        </ListItem>
      </div>
    </div>
  </Dialog>
</template>
