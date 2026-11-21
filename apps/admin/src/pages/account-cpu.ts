import type { AccountDetail } from '@voice-room/shared/contracts/admin';
import { formatCount } from '../format.ts';

/** A wide gap suggests that something besides VoiceRoom was using the CPU. */
const SYSTEM_OVER_APP_PCT = 40;

type Cpu = NonNullable<AccountDetail['cpu30d']>;

/** One careful phrase about the computer: nothing it could not know from these numbers. */
export function cpuConclusion(cpu: Cpu, badMinutes: number): string {
  const { appAvgPct: app, systemAvgPct: system, calls, criticalCalls, relievedCalls } = cpu;
  if (criticalCalls === 0) return 'Перегрузок процессора в звонках не было.';
  const overload = `Перегрузка в ${formatCount(criticalCalls)} из ${formatCount(calls)} звонков`;
  const relief = relievedCalls ? ', шумодав переключался на облегчённый' : '';
  const elsewhere = app !== null && system !== null && system - app >= SYSTEM_OVER_APP_PCT;
  if (elsewhere && badMinutes > 0 && criticalCalls * 2 >= calls) {
    return `${overload}${relief}. Система занята намного больше самого VoiceRoom: скорее всего, параллельно запущена игра.`;
  }
  return `${overload}${relief}.`;
}
