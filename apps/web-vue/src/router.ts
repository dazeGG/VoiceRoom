// The app's routes, one per SvelteKit route of apps/web (src/routes/**). Each
// carries the SvelteKit route id as `meta.routeId`, the key the copied
// platform code (mobile-routes.ts) uses.

import { createRouter, createWebHistory, type RouteRecordRaw, type Router, type RouterHistory } from 'vue-router';
import { isShallowEntry } from '@/shared/utils/shallow-routing';
import MainRoute from './pages/MainRoute.vue';

declare module 'vue-router' {
  interface RouteMeta {
    /** The SvelteKit route id, `null` for an address no route knows. */
    routeId: string | null;
  }
}

export const routes: RouteRecordRaw[] = [
  // `/` and `/r/:roomId` share one component so the lobby's address changes keep it (MainRoute.vue).
  { path: '/', component: MainRoute, meta: { routeId: '/' } },
  { path: '/r/:roomId', component: MainRoute, meta: { routeId: '/r/[roomId]' } },
  { path: '/login', component: () => import('./pages/LoginPage.vue'), meta: { routeId: '/login' } },
  { path: '/register', component: () => import('./pages/RegisterPage.vue'), meta: { routeId: '/register' } },
  { path: '/privacy', component: () => import('./pages/PrivacyPage.vue'), meta: { routeId: '/privacy' } },
  { path: '/terms', component: () => import('./pages/TermsPage.vue'), meta: { routeId: '/terms' } },
  { path: '/licenses', component: () => import('./pages/LicensesPage.vue'), meta: { routeId: '/licenses' } },
  { path: '/:unknown(.*)*', component: () => import('./pages/NotFoundPage.vue'), meta: { routeId: null } }
];

export function createAppRouter(history: RouterHistory = createWebHistory()): Router {
  return createRouter({
    history,
    routes,
    // SvelteKit scrolled to the top on a navigation, kept the place on the back
    // button, and left it alone for a shallow entry or a `noScroll` change of
    // the query (the landing's ?auth=).
    scrollBehavior(to, from, savedPosition) {
      if (savedPosition) return savedPosition;
      if (to.path === from.path || isShallowEntry(to.fullPath)) return false;
      return { top: 0 };
    }
  });
}
