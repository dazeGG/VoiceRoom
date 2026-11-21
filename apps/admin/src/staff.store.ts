import { defineStore } from 'pinia';
import { computed, shallowRef } from 'vue';
import type { StaffMe, StaffPermission } from '@voiceroom/shared/contracts/staff';
import { ApiError } from './api/client.ts';
import { fetchMe, signOut } from './api/staff.ts';

export type Staff = Omit<StaffMe, 'ok'>;

export const useStaffStore = defineStore('admin-staff', () => {
  const staff = shallowRef<Staff | null>(null);
  const failure = shallowRef('');

  async function load(): Promise<void> {
    try {
      const { ok: _ok, ...me } = await fetchMe();
      staff.value = me;
    } catch (error) {
      // A lost session already went through the handoff in the API client.
      if (error instanceof ApiError && error.code === 'staff_session_required') return;
      failure.value = error instanceof Error ? error.message : 'Не удалось открыть админку';
    }
  }

  async function leave(): Promise<void> {
    const siteUrl = staff.value?.siteUrl;
    if (siteUrl) await signOut().finally(() => window.location.assign(siteUrl));
  }

  return { staff, failure, load, leave };
});

export function useCan(permission: StaffPermission) {
  const session = useStaffStore();
  return computed(() => session.staff?.permissions.includes(permission) ?? false);
}
