<script setup lang="ts">
import {
  Avatar,
  Button,
  Callout,
  Field,
  SegmentControl,
  SettingRow,
  SettingsGroup,
  TextField
} from '@voiceroom/ui-kit/components';
import type { AccountPrivacy, ContactAudience, ContactKind } from '@voiceroom/shared/contracts/privacy';
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import { fetchBlockedUsers, searchPeople, unblockUser, type PublicUser } from '@/api/friends';
import { changePrivacyAllowList, fetchPrivacy, savePrivacy } from '@/api/privacy';
import { getAppRealtime } from '@/api/realtime';
import { t } from '@/shared/i18n';
import { displayNameOf } from '@/shared/utils/display-name';

const privacy = ref<AccountPrivacy | null>(null);
const blocked = ref<PublicUser[] | null>(null);
const logins = ref<Record<ContactKind, string>>({ messages: '', calls: '' });
const busy = ref(false);
const failure = ref('');
const blockFailure = ref('');
const pendingBlock = ref('');
const lifetime = new AbortController();
let unsubscribe: (() => void) | undefined;
let updates = 0;

const groups = computed(
  () =>
    [
      { kind: 'messages', key: 'messagesFrom', label: t('Кто может мне писать') },
      { kind: 'calls', key: 'callsFrom', label: t('Кто может мне звонить') }
    ] as const
);
const options = computed(
  () =>
    [
      { value: 'everyone', label: t('Все') },
      { value: 'friends', label: t('Только друзья') },
      { value: 'selected', label: t('Выбранные') }
    ] satisfies { value: ContactAudience; label: string }[]
);

function errorText(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

onMounted(() => {
  unsubscribe = getAppRealtime().subscribe((event) => {
    if (event.type !== 'account.privacy.updated') return;
    updates += 1;
    privacy.value = event.payload.privacy;
  });
  void fetchPrivacy(lifetime.signal)
    .then((value) => {
      if (!updates) privacy.value = value;
    })
    .catch((error: unknown) => {
      if (!lifetime.signal.aborted && !updates)
        failure.value = errorText(error, t('Не удалось загрузить настройки конфиденциальности'));
    });
  void fetchBlockedUsers()
    .then((users) => (blocked.value = users))
    .catch((error: unknown) => {
      blockFailure.value = errorText(error, t('Не удалось загрузить блокировки'));
    });
});

onBeforeUnmount(() => {
  lifetime.abort();
  unsubscribe?.();
});

async function change(action: () => Promise<AccountPrivacy>): Promise<boolean> {
  if (busy.value) return false;
  const knownUpdates = updates;
  busy.value = true;
  failure.value = '';
  try {
    const next = await action();
    if (knownUpdates === updates) privacy.value = next;
    return true;
  } catch (error) {
    failure.value = errorText(error, t('Не удалось сохранить настройки конфиденциальности'));
    return false;
  } finally {
    busy.value = false;
  }
}

function updateAudience(key: 'messagesFrom' | 'callsFrom', value: ContactAudience): void {
  if (!privacy.value || privacy.value[key] === value) return;
  const { messagesFrom, callsFrom } = privacy.value;
  void change(() => savePrivacy({ messagesFrom, callsFrom, [key]: value }));
}

async function add(kind: ContactKind): Promise<void> {
  const login = logins.value[kind].trim().replace(/^@/, '').toLowerCase();
  if (!login) return;
  const saved = await change(async () => {
    const results = await searchPeople(login, lifetime.signal);
    const match = results.find(({ user }) => user.login.toLowerCase() === login);
    if (!match) throw new Error(t('Пользователь с таким логином не найден'));
    return changePrivacyAllowList(kind, match.user.id, true);
  });
  if (saved) logins.value[kind] = '';
}

async function unblock(userId: string): Promise<void> {
  if (pendingBlock.value) return;
  pendingBlock.value = userId;
  blockFailure.value = '';
  try {
    await unblockUser(userId);
    blocked.value = blocked.value?.filter((user) => user.id !== userId) ?? [];
  } catch (error) {
    blockFailure.value = errorText(error, t('Не удалось разблокировать'));
  } finally {
    pendingBlock.value = '';
  }
}
</script>

<template>
  <div class="settings__sound">
    <Callout v-if="failure" role="status" tone="warning" :text="failure" />
    <p v-else-if="!privacy" role="status">{{ t('Загружаем…') }}</p>
    <template v-if="privacy">
      <SettingsGroup v-for="group in groups" :key="group.kind" :heading="group.label">
        <div class="settings__privacy-controls">
          <!-- @vue-generic {ContactAudience} -->
          <SegmentControl
            v-bind="{ ariaLabel: group.label }"
            :value="privacy[group.key]"
            :options="options"
            layout="equal"
            @change="updateAudience(group.key, $event)"
          />
          <form
            v-if="privacy[group.key] === 'selected'"
            class="settings__privacy-form"
            :aria-label="group.label"
            @submit.prevent="void add(group.kind)"
          >
            <Field :label="t('Логин')">
              <TextField
                v-model="logins[group.kind]"
                name="login"
                autocomplete="off"
                autocorrect="off"
                autocapitalize="none"
                :spellcheck="false"
                required
              />
            </Field>
            <Button type="submit" variant="soft" size="md" :disabled="busy">{{ t('Добавить') }}</Button>
          </form>
        </div>
        <template v-if="privacy[group.key] === 'selected'">
          <SettingRow
            v-for="entry in privacy.allowList.filter((entry) => entry.kind === group.kind)"
            :key="entry.user.id"
            :label="displayNameOf(entry.user)"
            :description="`@${entry.user.login}`"
          >
            <template #leading>
              <Avatar
                :name="displayNameOf(entry.user)"
                :src="entry.user.avatarUrl"
                :color-key="entry.user.avatarColorKey"
                :background="entry.user.avatarAccent"
                :size="32"
              />
            </template>
            <template #control>
              <Button
                variant="ghost"
                size="sm"
                :disabled="busy"
                @click="void change(() => changePrivacyAllowList(group.kind, entry.user.id, false))"
                >{{ t('Убрать') }}</Button
              >
            </template>
          </SettingRow>
        </template>
      </SettingsGroup>
    </template>

    <SettingsGroup :heading="t('Чёрный список')" :description="t('Эти пользователи не могут писать вам и звонить.')">
      <Callout v-if="blockFailure" role="status" tone="warning" :text="blockFailure" />
      <div v-else-if="!blocked" class="settings__notification-empty" role="status">{{ t('Загружаем…') }}</div>
      <div v-else-if="!blocked.length" class="settings__notification-empty">
        {{ t('Заблокированных пользователей нет.') }}
      </div>
      <SettingRow v-for="user in blocked" :key="user.id" :label="displayNameOf(user)" :description="`@${user.login}`">
        <template #leading>
          <Avatar
            :name="displayNameOf(user)"
            :src="user.avatarUrl"
            :color-key="user.avatarColorKey"
            :background="user.avatarAccent"
            :size="32"
          />
        </template>
        <template #control>
          <Button variant="ghost" size="sm" :disabled="Boolean(pendingBlock)" @click="void unblock(user.id)">
            {{ t('Разблокировать') }}
          </Button>
        </template>
      </SettingRow>
    </SettingsGroup>
  </div>
</template>
