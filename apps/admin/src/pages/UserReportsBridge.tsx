import { useEffect, useRef } from 'react';
import { createApp } from 'vue';
import UserReports from './UserReports.vue';

// Removed when the message reports page is moved to Vue.
export function UserReportsBridge({
  onResolved,
  onOpenAccount
}: {
  onResolved: (openLeft: number) => void;
  onOpenAccount: (accountId: string) => void;
}) {
  const host = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!host.current) return;
    const app = createApp(UserReports, { onResolved, onOpenAccount });
    app.config.idPrefix = 'admin-user-reports';
    app.mount(host.current);
    return () => app.unmount();
  }, [onResolved, onOpenAccount]);

  return <div ref={host} />;
}
