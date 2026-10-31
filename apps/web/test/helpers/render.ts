// Renders a component the way the app mounts it: a new Pinia and a vue-router
// memory router are installed as plugins. Imperative code that reads stores
// through useXStore() works too, since the new Pinia is also the active one.

import { render, type RenderOptions, type RenderResult } from '@testing-library/vue';
import { createPinia, setActivePinia, type Pinia } from 'pinia';
import { defineComponent } from 'vue';
import { createMemoryHistory, createRouter, type RouteRecordRaw, type Router } from 'vue-router';

// Testing Library's own `routes` and `store` options are deprecated; the router is built here.
export interface AppRenderOptions<C> extends Omit<RenderOptions<C>, 'routes' | 'store'> {
  /** Where the router starts; `/` by default. */
  route?: string;
  /** Routes the component navigates to. Any other path still resolves, to an empty page. */
  extraRoutes?: RouteRecordRaw[];
}

export interface AppRenderResult extends RenderResult {
  router: Router;
  pinia: Pinia;
}

const EmptyPage = defineComponent({ render: () => null });

export async function renderWithApp<C>(component: C, options: AppRenderOptions<C> = {}): Promise<AppRenderResult> {
  const { route = '/', extraRoutes = [], global, ...renderOptions } = options;
  const pinia = createPinia();
  setActivePinia(pinia);
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [...extraRoutes, { path: '/:pathMatch(.*)*', component: EmptyPage }]
  });
  await router.push(route);
  await router.isReady();
  const result = render(component, {
    ...renderOptions,
    global: { ...global, plugins: [pinia, router, ...(global?.plugins ?? [])] }
  });
  return { ...result, router, pinia };
}
