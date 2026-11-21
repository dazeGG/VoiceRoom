import { render, type RenderOptions } from '@testing-library/vue';
import { createPinia, setActivePinia } from 'pinia';
import { defineComponent, type VNodeChild } from 'vue';

export function renderWithApp<C>(component: C, options: Omit<RenderOptions<C>, 'routes' | 'store'> = {}) {
  const pinia = createPinia();
  setActivePinia(pinia);
  return render(component, {
    ...options,
    global: { ...options.global, plugins: [pinia, ...(options.global?.plugins ?? [])] }
  });
}

export function renderFixture(setup: () => () => VNodeChild) {
  return renderWithApp(defineComponent({ setup }));
}
