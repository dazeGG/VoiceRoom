<script setup lang="ts">
import { computed, ref, useId, watch } from 'vue';
import type { AdminUserReport, UserReportResolveBody } from '@voiceroom/shared/contracts/reports';
import { REPORT_REASON_LABELS } from '@voiceroom/shared/report-labels';
import { fetchOpenUserReports, resolveUserReport } from '../api/admin.ts';
import { formatDateTime } from '../format.ts';
import Notice from '../Notice.vue';
import { Button, Callout, Card, EmptyState, Pill } from '../ui';
import { useAdminResource } from '../use-admin-resource.ts';

const emit = defineEmits<{ resolved: [openLeft: number]; openAccount: [accountId: string] }>();
const titleId = useId();
const { data, failure, reload, update } = useAdminResource(fetchOpenUserReports, [], {
  failureText: 'Не удалось загрузить жалобы на пользователей',
  refreshMs: 60_000
});
const busy = ref(false);
const error = ref('');
watch(data, (next) => {
  if (next) emit('resolved', next.length);
});

const groups = computed(() => {
  const byAccount = new Map<string, { report: AdminUserReport; reports: AdminUserReport[] }>();
  for (const report of data.value ?? []) {
    const group = byAccount.get(report.target.userId);
    if (group) group.reports.push(report);
    else byAccount.set(report.target.userId, { report, reports: [report] });
  }
  return [...byAccount.values()];
});

async function decide(report: AdminUserReport, action: UserReportResolveBody['action']): Promise<void> {
  if (busy.value) return;
  busy.value = true;
  error.value = '';
  try {
    await resolveUserReport(report.id, action);
    update((current) => (current ?? []).filter((item) => item.target.userId !== report.target.userId));
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : 'Не удалось закрыть жалобу';
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <section class="admin-user-reports" :aria-labelledby="titleId">
    <header>
      <h2 :id="titleId">Жалобы на пользователей</h2>
      <p class="admin-user-reports__quiet">
        Проверьте аккаунт и при необходимости примените меры в его карточке. Закрытие жалоб само по себе не блокирует и
        не удаляет аккаунт.
      </p>
    </header>
    <Notice v-if="failure" :failure="failure" @retry="reload" />
    <p v-else-if="!data" aria-busy="true">Загружаем жалобы…</p>
    <EmptyState v-if="data?.length === 0" title="Жалоб на пользователей нет" compact />
    <Callout v-if="error" :title="error" tone="danger" role="alert" />
    <ul class="admin-user-reports__list" aria-label="Жалобы на пользователей">
      <li v-for="{ report, reports } in groups" :key="report.target.userId">
        <Card class="admin-user-reports__card">
          <div class="admin-user-reports__heading">
            <h3>
              {{ report.target.displayName || 'Удалённый аккаунт' }}
              {{ report.target.login ? `@${report.target.login}` : '' }}
            </h3>
            <Pill tone="danger">{{ reports.length }}</Pill>
          </div>
          <p v-if="report.target.deleted">Аккаунт уже удалён</p>
          <Button v-else variant="ghost" @click="emit('openAccount', report.target.userId)">Открыть аккаунт</Button>
          <ul class="admin-user-reports__items">
            <li v-for="item in reports" :key="item.id">
              <strong>{{ REPORT_REASON_LABELS[item.reason] }}</strong> · {{ item.reporter.displayName }} ·
              {{ formatDateTime(item.createdAt) }}
              <p v-if="item.comment">{{ item.comment }}</p>
            </li>
          </ul>
          <div class="admin-user-reports__actions">
            <Button :disabled="busy" @click="decide(report, 'dismiss')">Отклонить жалобы</Button>
            <Button :disabled="busy" @click="decide(report, 'reviewed')">Рассмотрено</Button>
          </div>
        </Card>
      </li>
    </ul>
  </section>
</template>
