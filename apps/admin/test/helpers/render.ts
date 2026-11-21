import { render, type RenderOptions } from '@testing-library/vue';
import { createPinia, setActivePinia } from 'pinia';
import { defineComponent, type VNodeChild } from 'vue';
import type { StaffRole } from '@voiceroom/shared/contracts/staff';
import { useStaffStore as getStaffStore } from '../../src/staff.store.ts';
import { staffOf } from './api.ts';

export function renderWithApp<C>(
  component: C,
  options: Omit<RenderOptions<C>, 'routes' | 'store'> = {},
  pinia = createPinia()
) {
  setActivePinia(pinia);
  return render(component, {
    ...options,
    global: { ...options.global, plugins: [pinia, ...(options.global?.plugins ?? [])] }
  });
}

export function renderFixture(setup: () => () => VNodeChild) {
  return renderWithApp(defineComponent({ setup }));
}

export function renderAsStaff<C>(
  component: C,
  options: Omit<RenderOptions<C>, 'routes' | 'store'> = {},
  role: StaffRole = 'admin'
) {
  const pinia = createPinia();
  getStaffStore(pinia).staff = staffOf(role);
  return renderWithApp(component, options, pinia);
}
