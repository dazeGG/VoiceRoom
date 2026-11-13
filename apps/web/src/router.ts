// The app's routes. Each carries a route id in the SvelteKit format of the
// previous client as `meta.routeId`, the key the platform code
// (mobile-routes.ts) uses.

import {
  createRouter,
  createWebHistory,
  START_LOCATION,
  type RouteRecordRaw,
  type Router,
  type RouterHistory
} from 'vue-router';
import { isShallowEntry } from '@/shared/utils/shallow-routing';
import { APP_HOME } from './shared/app-home';
import MainRoute from './pages/MainRoute.vue';

declare module 'vue-router' {
  interface RouteMeta {
    /** The SvelteKit route id, `null` for an address no route knows. */
    routeId: string | null;
  }
}

export const routes: RouteRecordRaw[] = [
  // `/` is the public site; the app starts at /app (app-home.ts). A navigation
  // here to `/` (an old link, a notification's route) lands there with its query.
  { path: '/', redirect: (to) => ({ path: APP_HOME, query: to.query, hash: to.hash }), meta: { routeId: '/' } },
  // /app and `/r/:roomId` share one component so the lobby's address changes keep it (MainRoute.vue).
  { path: APP_HOME, component: MainRoute, meta: { routeId: APP_HOME } },
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

/**
 * A page that fails to load (a deploy replaced its chunk) opens as a full page
 * load instead, as SvelteKit fell back to; not the first page, which would loop.
 * Returns the removal.
 */
export function loadFailedPagesInFull(
  router: Router,
  load: (href: string) => void = (href) => (window.location.href = href)
): () => void {
  return router.onError((_error: unknown, to) => {
    if (router.currentRoute.value !== START_LOCATION) load(router.resolve(to).href);
  });
}
