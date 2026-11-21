<script setup lang="ts">
import { computed } from 'vue';
import type { AdminWidgets, WidgetRuntimeOwnerState } from '@voiceroom/shared/contracts/admin';
import { formatCount } from '../../format.ts';
import { Panel, Pill } from '../../ui';

const ROLE_NAMES: Record<WidgetRuntimeOwnerState['role'], string> = { api: 'API', gate: 'gate' };

/** Whether the processes serving widgets confirmed the current recovery generation. */
function ownersStatus(state: AdminWidgets['state']): { tone: 'success' | 'warning'; text: string } {
  const behind = state.owners.filter((owner) => owner.acknowledgedGeneration !== state.recoveryGeneration);
  if (behind.length === 0) return { tone: 'success', text: 'подтвердили' };
  return { tone: 'warning', text: `ждём: ${behind.map((owner) => ROLE_NAMES[owner.role]).join(', ')}` };
}

function windowText(ms: number): string {
  if (ms === 60_000) return 'в минуту';
  if (ms % 60_000 === 0) return `за ${formatCount(ms / 60_000)} мин`;
  return `за ${formatCount(Math.round(ms / 1000))} с`;
}

const props = defineProps<{ widgets: AdminWidgets }>();
const state = computed(() => props.widgets.state);
const limits = computed(() => props.widgets.limits);
const owners = computed(() => ownersStatus(state.value));
</script>

<template>
  <Panel>
    <div class="admin-widget-state__groups">
      <div>
        <h3 class="admin-widget-state__facts-title">Приём</h3>
        <dl class="admin-widget-state__facts">
          <div class="admin-widget-state__facts-row">
            <dt>Приём звонков с сайтов</dt>
            <dd>
              <Pill :tone="state.admissionEnabled ? 'success' : 'neutral'" compact>
                {{ state.admissionEnabled ? 'включён' : 'выключен' }}
              </Pill>
            </dd>
          </div>
          <div class="admin-widget-state__facts-row">
            <dt>Граница комнат виджета</dt>
            <dd>
              <span v-if="state.boundaryRequired" class="admin-widget-state__facts-sub">не снимается</span>
              <Pill :tone="state.boundaryRequired ? 'success' : 'neutral'" compact>
                {{ state.boundaryRequired ? 'включена' : 'не включалась' }}
              </Pill>
            </dd>
          </div>
          <div class="admin-widget-state__facts-row">
            <dt>Флаг сервера</dt>
            <dd class="admin-metric-mono">WIDGET_ENABLED={{ state.flagEnabled ? 'true' : 'false' }}</dd>
          </div>
          <div class="admin-widget-state__facts-row">
            <dt>API и gate</dt>
            <dd>
              <span class="admin-widget-state__facts-sub">поколение {{ formatCount(state.recoveryGeneration) }}</span>
              <Pill :tone="owners.tone" compact>
                {{ owners.text }}
              </Pill>
            </dd>
          </div>
        </dl>
      </div>
      <div>
        <h3 class="admin-widget-state__facts-title">Лимиты из конфига</h3>
        <dl class="admin-widget-state__facts">
          <div class="admin-widget-state__facts-row">
            <dt>Мест в комнате</dt>
            <dd>
              <span class="admin-widget-state__facts-sub">MAX_ROOM_PEERS</span>
              {{ formatCount(limits.maxRoomPeers) }}
            </dd>
          </div>
          <div class="admin-widget-state__facts-row">
            <dt>Новых комнат с одного IP</dt>
            <dd>
              <span class="admin-widget-state__facts-sub">ROOM_CREATE_RATE_LIMIT</span>
              {{ formatCount(limits.createRateLimit) }} {{ windowText(limits.createRateWindowMs) }}
            </dd>
          </div>
          <div class="admin-widget-state__facts-row">
            <dt>Проверка от ботов</dt>
            <dd>
              <span class="admin-widget-state__facts-sub">ROOM_CREATE_POW_DIFFICULTY</span>
              сложность {{ formatCount(limits.powDifficulty) }}
            </dd>
          </div>
          <div class="admin-widget-state__facts-row">
            <dt>Чат в комнате</dt>
            <dd>
              <span class="admin-widget-state__facts-sub">граница</span>
              выключен
            </dd>
          </div>
        </dl>
      </div>
    </div>
    <p class="admin-metric-note">
      Включение и выключение — <span class="admin-metric-mono">scripts/cd/activate-widget.sh</span>, откат —
      <span class="admin-metric-mono">widget-recovery.ts</span> на сервере.
    </p>
  </Panel>
</template>
