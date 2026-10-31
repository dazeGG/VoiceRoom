// What the lobby shows staff: a link to the admin app, a site of its own
// (apps/admin), with the open reports on it, and a notice for each new report.

import { ref } from 'vue';
import type { AdminReportsEvent } from '@voice-room/shared/contracts/admin';
import { describeFiledReport } from '@voice-room/shared/report-labels';
import { fetchStaffAccess } from '@/api/staff';
import { getAppRealtime } from '@/api/realtime';
import { useToastsStore, type ToastOptions } from './toasts.store';

export function useStaffAccess(onToast: (message: string, options?: ToastOptions) => void) {
  /** The admin app, for staff only; null hides the link. */
  const adminUrl = ref<string | null>(null);
  const openReports = ref(0);

  /** Asks the server once and follows the report count; returns the teardown. */
  function start(): () => void {
    fetchStaffAccess().then(
      (access) => {
        adminUrl.value = access.adminUrl;
        openReports.value = access.openReports;
      },
      // Without an answer the link stays hidden; the admin app still opens by its address.
      () => {}
    );
    return getAppRealtime().subscribe((event) => {
      if (event.type === 'admin.reports') reportsChanged(event.payload);
    });
  }

  function reportsChanged(event: AdminReportsEvent): void {
    openReports.value = event.openReports;
    const filed = event.filed;
    if (!filed) return;
    // It stays until closed: a report must not slip by while the admin is away.
    onToast('Новая жалоба', {
      description: describeFiledReport(filed),
      variant: 'warning',
      duration: 0,
      actions: [
        {
          label: 'Посмотреть',
          onClick: (toastId: string) => {
            useToastsStore().dismissToast(toastId);
            if (adminUrl.value) window.open(new URL('reports', adminUrl.value).href, '_blank', 'noopener');
          }
        }
      ]
    });
  }

  return { adminUrl, openReports, start };
}
