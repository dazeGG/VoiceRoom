// What the lobby shows staff: a link to the admin app, a site of its own
// (apps/admin), with the open reports on it, and a notice for each new report.

import type { AdminReportsEvent } from '@voice-room/shared/contracts/admin';
import { describeFiledReport } from '@voice-room/shared/report-labels';
import { fetchStaffAccess } from '$lib/api/staff';
import { getAppRealtime } from '$lib/api/realtime';
import { SvelteURL } from 'svelte/reactivity';
import { dismissToast, type ToastOptions } from './toasts.svelte';

export class StaffAccess {
  /** The admin app, for staff only; null hides the link. */
  adminUrl = $state<string | null>(null);
  openReports = $state(0);
  readonly #onToast: (message: string, options?: ToastOptions) => void;

  constructor(onToast: (message: string, options?: ToastOptions) => void) {
    this.#onToast = onToast;
  }

  /** Asks the server once and follows the report count; returns the teardown. */
  start(): () => void {
    fetchStaffAccess().then(
      (access) => {
        this.adminUrl = access.adminUrl;
        this.openReports = access.openReports;
      },
      // Without an answer the link stays hidden; the admin app still opens by its address.
      () => {}
    );
    return getAppRealtime().subscribe((event) => {
      if (event.type === 'admin.reports') this.#reportsChanged(event.payload);
    });
  }

  #reportsChanged(event: AdminReportsEvent): void {
    this.openReports = event.openReports;
    const filed = event.filed;
    if (!filed) return;
    // It stays until closed: a report must not slip by while the admin is away.
    this.#onToast('Новая жалоба', {
      description: describeFiledReport(filed),
      variant: 'warning',
      duration: 0,
      actions: [
        {
          label: 'Посмотреть',
          onClick: (toastId: string) => {
            dismissToast(toastId);
            if (this.adminUrl) window.open(new SvelteURL('reports', this.adminUrl).href, '_blank', 'noopener');
          }
        }
      ]
    });
  }
}
