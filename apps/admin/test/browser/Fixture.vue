<script setup lang="ts">
import { ref } from 'vue';
import { Button, Popover, SegmentControl, TextField } from '@voice-room/ui/components';
import GlobalSearch from '../../src/shell/GlobalSearch.vue';
import Sidebar from '../../src/shell/Sidebar.vue';
import type { Staff } from '../../src/staff.store.ts';
import TimeRangePicker from '../../src/TimeRangePicker.vue';
import { PRODUCT_PRESETS, type TimeRange } from '../../src/time-range.ts';
import Dialog from '../../src/ui/Dialog.vue';
import AccountDialogsFixture from './AccountDialogsFixture.vue';

defineProps<{ staff: Staff }>();

const open = ref(false);
type Period = 'a' | 'b';
const period = ref<Period>('a');
const periods: { value: Period; label: string }[] = [
  { value: 'a', label: 'Day' },
  { value: 'b', label: 'Week' }
];
const range = ref<TimeRange>({ kind: 'preset', id: '7d' });
</script>

<template>
  <div class="admin-frame">
    <Sidebar :staff="staff" :tabs="['overview', 'accounts']" current="accounts" :open-reports="0" />
    <main class="admin-frame__column admin-frame__main">
      <div class="admin-frame__content">
        <div
          class="admin-product__scroll"
          data-testid="retention-scroll"
          role="region"
          aria-label="Таблица возвращаемости"
          tabindex="0"
        >
          <table class="admin-product__table">
            <thead>
              <tr>
                <th scope="col">Неделя</th>
                <th scope="col">Аккаунтов</th>
                <th scope="col">Вернулись на 1–7 день</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <th scope="row">с 01.11.2026</th>
                <td class="admin-metric-mono">120</td>
                <td>75%</td>
              </tr>
            </tbody>
          </table>
        </div>
        <GlobalSearch />
        <div class="admin-metric-toolbar">
          <Button @click="open = true">Open modal</Button>
          <SegmentControl
            v-bind="{ ariaLabel: 'Period' }"
            :value="period"
            :options="periods"
            @change="period = $event"
          />
          <Popover role="dialog" aria-label="Dates" placement="bottom-start">
            <template #trigger="{ open: expanded, toggle, panelId }">
              <Button aria-haspopup="dialog" :aria-expanded="expanded" :aria-controls="panelId" @click="toggle"
                >Dates</Button
              >
            </template>
            <template #content="{ close }">
              <form class="admin-range__form" @submit.prevent="close()">
                <TextField aria-label="Date" type="date" />
                <Button type="submit">Apply</Button>
              </form>
            </template>
          </Popover>
          <Button>Outside</Button>
        </div>
        <TimeRangePicker :value="range" :presets="PRODUCT_PRESETS" :with-time="false" @change="range = $event" />
        <output aria-label="Range">{{ range.kind }}</output>
        <Dialog :open="open" title="Fixture modal" @close="open = false">
          <TextField aria-label="Reason" />
          <template #footer><Button @click="open = false">Done</Button></template>
        </Dialog>
        <AccountDialogsFixture :staff="staff" />
      </div>
    </main>
  </div>
</template>
