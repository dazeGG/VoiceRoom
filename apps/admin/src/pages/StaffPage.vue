<script setup lang="ts">
import { computed, ref } from 'vue';
import { Check, Lock, Minus, Table2 } from '@lucide/vue';
import { Field } from '@voice-room/ui/components';
import {
  ROLE_PERMISSIONS,
  STAFF_PERMISSIONS,
  STAFF_ROLE_LABELS,
  STAFF_ROLES,
  type StaffRole
} from '@voice-room/shared/contracts/staff';
import { fetchStaff, setStaffRole } from '../api/staff.ts';
import { formatPeople } from '../format.ts';
import Notice from '../Notice.vue';
import { permissionGroups, rolesAreNested, sectionsOf } from '../staff-permissions.ts';
import { useStaffStore } from '../staff.store.ts';
import {
  AccountBadge,
  Button,
  Callout,
  Dialog,
  EmptyState,
  ListItem,
  Panel,
  Pill,
  Select,
  TextField,
  type Tone
} from '../ui';
import { useAdminResource } from '../use-admin-resource.ts';

const ROLE_TONES: Record<StaffRole, Tone> = { superadmin: 'accent', admin: 'info', moderator: 'neutral' };
const ranked = [...STAFF_ROLES].reverse();
const roleOptions = STAFF_ROLES.map((value) => ({ value, label: STAFF_ROLE_LABELS[value] }));
const groups = permissionGroups();
const nested = rolesAreNested();
const me = useStaffStore();
const {
  data: staff,
  failure,
  busy: loading,
  reload
} = useAdminResource(fetchStaff, [], {
  failureText: 'Не удалось загрузить сотрудников'
});
const login = ref('');
const role = ref<StaffRole>('moderator');
const busy = ref(false);
const message = ref<{ tone: 'ok' | 'error'; text: string } | null>(null);
const rightsOpen = ref(false);
const counts = computed(
  () =>
    staff.value &&
    new Map(
      ranked.map((rank) => [rank, formatPeople(staff.value?.filter((member) => member.role === rank).length ?? 0)])
    )
);

function chooseRole(value: string): void {
  const next = STAFF_ROLES.find((candidate) => candidate === value);
  if (next) role.value = next;
}
async function change(target: string, next: StaffRole | null): Promise<boolean> {
  if (busy.value) return false;
  busy.value = true;
  message.value = null;
  try {
    await setStaffRole(target, next);
    message.value = { tone: 'ok', text: next ? `@${target}: ${STAFF_ROLE_LABELS[next]}` : `@${target}: роль снята` };
    reload();
    return true;
  } catch (error) {
    message.value = { tone: 'error', text: error instanceof Error ? error.message : 'Не удалось изменить роль' };
    return false;
  } finally {
    busy.value = false;
  }
}
async function grant(): Promise<void> {
  const target = login.value.trim().replace(/^@/, '');
  if (target && (await change(target, role.value))) login.value = '';
}
</script>

<template>
  <Notice v-if="failure && !loading" :failure="failure" @retry="reload" />
  <div v-else class="admin-staff">
    <Panel title="Сотрудники" class="admin-staff__main">
      <template v-if="staff" #aside
        ><small>{{ formatPeople(staff.length) }}</small></template
      >
      <p v-if="!staff" aria-busy="true">Загружаем…</p>
      <EmptyState v-else-if="!staff.length" title="Сотрудников пока нет" compact />
      <ul v-else class="admin-staff__list" aria-label="Сотрудники">
        <li v-for="member in staff" :key="member.user.id" class="admin-staff__member">
          <ListItem
            :avatar="{
              name: member.user.displayName,
              src: member.user.avatarUrl,
              colorKey: member.user.avatarColorKey,
              background: member.user.avatarAccent
            }"
            :caption="`@${member.user.login}`"
          >
            <template #title>{{ member.user.displayName }} <AccountBadge :user-id="member.user.id" /></template>
          </ListItem>
          <Pill :tone="ROLE_TONES[member.role]">{{ STAFF_ROLE_LABELS[member.role] }}</Pill>
          <span v-if="member.fixed" class="admin-staff__quiet">задан в настройках</span>
          <span v-else-if="member.user.id === me.staff?.user.id" class="admin-staff__quiet">это вы</span>
          <Button
            v-else
            size="sm"
            variant="ghost"
            :disabled="busy"
            :aria-label="`Снять роль с @${member.user.login}`"
            @click="change(member.user.login, null)"
            >Снять роль</Button
          >
        </li>
      </ul>
    </Panel>

    <div class="admin-staff__side">
      <Panel title="Выдать роль">
        <form class="admin-staff__grant" @submit.prevent="grant">
          <Field label="Логин">
            <TextField v-model="login" variant="mono" placeholder="login" autocomplete="off" :spellcheck="false">
              <template #leading>@</template>
            </TextField>
          </Field>
          <Field label="Роль">
            <Select :model-value="role" :options="roleOptions" label="Роль" @value-change="chooseRole" />
          </Field>
          <Button variant="primary" type="submit" :disabled="busy || !login.trim()">Выдать роль</Button>
        </form>
        <Callout v-if="message?.tone === 'error'" :title="message.text" tone="danger" role="alert" />
        <p v-else-if="message" class="admin-staff__quiet" role="status">{{ message.text }}</p>
      </Panel>

      <Panel title="Кто что может">
        <ul class="admin-staff__summary" aria-label="Права по ролям">
          <li v-for="rank in ranked" :key="rank">
            <div class="admin-staff__summary-line">
              <strong>{{ STAFF_ROLE_LABELS[rank] }}</strong>
              <span>{{ ROLE_PERMISSIONS[rank].length }} из {{ STAFF_PERMISSIONS.length }} прав</span>
            </div>
            <div class="admin-staff__pips" aria-hidden="true">
              <span
                v-for="permission in STAFF_PERMISSIONS"
                :key="permission"
                :class="
                  ROLE_PERMISSIONS[rank].includes(permission)
                    ? `admin-tone--${ROLE_TONES[rank]}`
                    : 'admin-staff__pip--empty'
                "
              />
            </div>
          </li>
        </ul>
        <Button @click="rightsOpen = true"><Table2 aria-hidden="true" />Таблица прав</Button>
      </Panel>
    </div>

    <Dialog
      :open="rightsOpen"
      size="lg"
      title="Кто что может"
      v-bind="nested ? { description: 'Каждая следующая роль может всё, что предыдущая, и ещё немного.' } : {}"
      @close="rightsOpen = false"
    >
      <div class="admin-rights">
        <table class="admin-rights__table" aria-label="Права ролей">
          <thead>
            <tr>
              <th scope="col">Право</th>
              <th v-for="rank in ranked" :key="rank" scope="col">
                <Pill :tone="ROLE_TONES[rank]">{{ STAFF_ROLE_LABELS[rank] }}</Pill>
                <small v-if="counts">{{ counts.get(rank) }}</small>
              </th>
            </tr>
          </thead>
          <tbody v-for="group in groups" :key="group.label" :aria-label="group.label">
            <tr class="admin-rights__group">
              <th scope="rowgroup" :colspan="ranked.length + 1">{{ group.label }}</th>
            </tr>
            <tr v-for="row in group.rows" :key="row.permission">
              <th scope="row">
                {{ row.title }}<small v-if="row.opens">{{ row.opens }}</small>
              </th>
              <td v-for="rank in ranked" :key="rank">
                <span v-if="row.roles[rank]" class="admin-rights__yes" role="img" aria-label="может" title="может"
                  ><Check aria-hidden="true"
                /></span>
                <span v-else class="admin-rights__no" role="img" aria-label="не может" title="не может"
                  ><Minus aria-hidden="true"
                /></span>
              </td>
            </tr>
          </tbody>
          <tfoot>
            <tr>
              <th scope="row">Разделы в меню</th>
              <td v-for="rank in ranked" :key="rank">{{ sectionsOf(rank).join(', ') }}</td>
            </tr>
          </tfoot>
        </table>
      </div>
      <template #footer>
        <span class="admin-rights__note"
          ><Lock aria-hidden="true" />Суперадминистраторы из настроек сервера в панели не меняются.</span
        >
      </template>
    </Dialog>
  </div>
</template>
