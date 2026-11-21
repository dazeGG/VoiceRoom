<script setup lang="ts">
import { Avatar, Combobox, Kbd, type AvatarProps, type ComboboxOption } from '@voice-room/ui/components';
import { computed, onBeforeUnmount, onMounted, ref, shallowRef, useTemplateRef, watch } from 'vue';
import type { AccountRow, LiveRoom } from '@voice-room/shared/contracts/admin';
import { fetchAccounts, fetchLiveRooms } from '../api/admin.ts';
import { useCan } from '../staff.store.ts';

const emit = defineEmits<{ openAccount: [id: string]; openRoom: [room: { id: string; name: string | null }] }>();
const SEARCH_DELAY_MS = 250;
const SHOWN = 5;
type Hit =
  | { option: ComboboxOption; kind: 'account'; account: AccountRow }
  | { option: ComboboxOption; kind: 'room'; room: LiveRoom };

const canAccounts = useCan('accounts.view');
const canRooms = useCan('rooms.view');
const typed = ref('');
const query = computed(() => typed.value.trim());
const open = ref(false);
const selected = ref('');
const host = useTemplateRef<HTMLElement>('host');
const isMac = /Mac|iPhone|iPad/.test(navigator.platform);
const found = shallowRef<{ query: string; hits: Hit[] }>();
const hits = computed(() => (found.value?.query === query.value ? found.value.hits : []));
const loading = computed(() => query.value !== '' && found.value?.query !== query.value);
const options = computed(() => hits.value.map((hit) => hit.option));
const byValue = computed(() => new Map(hits.value.map((hit) => [hit.option.value, hit])));

function accountHit(account: AccountRow): Hit {
  return {
    kind: 'account',
    account,
    option: {
      value: 'a-' + account.id,
      group: 'Аккаунты',
      label: account.displayName || account.login,
      description: '@' + account.login
    }
  };
}
function roomHit(room: LiveRoom): Hit {
  return {
    kind: 'room',
    room,
    option: {
      value: 'r-' + room.roomId,
      group: 'Комнаты в звонке',
      label: room.name || room.roomId,
      description: 'в звонке: ' + String(room.peers.length)
    }
  };
}
function roomMatches(room: LiveRoom, term: string): boolean {
  const needle = term.toLowerCase();
  return room.name.toLowerCase().includes(needle) || room.roomId.toLowerCase().includes(needle);
}

watch([query, canAccounts, canRooms], ([term, accountsAllowed, roomsAllowed], _, onCleanup) => {
  if (!term) return;
  let active = true;
  const timer = window.setTimeout(() => {
    void Promise.all([
      accountsAllowed ? fetchAccounts({ q: term, page: '1' }).then((page) => page.accounts) : [],
      roomsAllowed ? fetchLiveRooms().then((live) => live.rooms.filter((room) => roomMatches(room, term))) : []
    ]).then(
      ([accounts, rooms]) => {
        if (active)
          found.value = {
            query: term,
            hits: [...accounts.slice(0, SHOWN).map(accountHit), ...rooms.slice(0, SHOWN).map(roomHit)]
          };
      },
      () => {
        if (active) found.value = { query: term, hits: [] };
      }
    );
  }, SEARCH_DELAY_MS);
  onCleanup(() => {
    active = false;
    window.clearTimeout(timer);
  });
});

function input(): HTMLInputElement | null | undefined {
  return host.value?.querySelector<HTMLInputElement>('input[role="combobox"]');
}

function avatarFor(option: ComboboxOption): AvatarProps {
  const hit = byValue.value.get(option.value);
  if (hit?.kind === 'account') {
    const { avatarUrl, avatarColorKey, avatarAccent } = hit.account;
    return { name: option.label, src: avatarUrl, colorKey: avatarColorKey, background: avatarAccent, size: 28 };
  }
  return { name: '#', shape: 'squircle', background: 'var(--vr-surface-3)', size: 28 };
}
function onShortcut(event: KeyboardEvent): void {
  if (!(event.ctrlKey || event.metaKey) || event.key.toLowerCase() !== 'k') return;
  event.preventDefault();
  if (document.querySelector('dialog[open], [role="dialog"][aria-modal="true"], [role="alertdialog"]')) return;
  input()?.focus();
  input()?.select();
}
onMounted(() => document.addEventListener('keydown', onShortcut));
onBeforeUnmount(() => document.removeEventListener('keydown', onShortcut));

function choose(option: ComboboxOption): void {
  const hit = byValue.value.get(option.value);
  if (!hit) return;
  open.value = false;
  selected.value = '';
  typed.value = '';
  input()?.blur();
  if (hit.kind === 'account') emit('openAccount', hit.account.id);
  else emit('openRoom', { id: hit.room.roomId, name: hit.room.name });
}
</script>

<template>
  <div ref="host" class="admin-search">
    <Combobox
      v-model="selected"
      v-model:query="typed"
      v-model:open="open"
      overlay
      visually-hidden-label
      external-filter
      :options="options"
      :loading="loading"
      label="Поиск по аккаунтам и комнатам"
      results-label="Найдено"
      placeholder="Аккаунт, логин, комната или id"
      @select="choose"
    >
      <template #trailing
        ><Kbd class="admin-search__shortcut" :keys="isMac ? ['⌘K'] : ['Ctrl', 'K']" aria-hidden="true"
      /></template>
      <template #avatar="{ option }">
        <Avatar v-bind="avatarFor(option)" />
      </template>
    </Combobox>
  </div>
</template>
