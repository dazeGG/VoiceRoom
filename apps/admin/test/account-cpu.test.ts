import { expect, test } from 'vitest';
import { cpuConclusion } from '../src/pages/account-cpu.ts';

test('a computer busy far beyond VoiceRoom is only a hint, and only with bad minutes on top', () => {
  const cpu = { appAvgPct: 20, systemAvgPct: 90, calls: 4, criticalCalls: 3, relievedCalls: 1 };
  expect(cpuConclusion(cpu, 10)).toContain('скорее всего, параллельно запущена игра');
  expect(cpuConclusion(cpu, 0)).not.toContain('игра');
  expect(cpuConclusion({ ...cpu, systemAvgPct: 40 }, 10)).not.toContain('игра');
  expect(cpuConclusion({ ...cpu, criticalCalls: 0 }, 10)).toBe('Перегрузок процессора в звонках не было.');
});
