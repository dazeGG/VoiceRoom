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
import { APP_HOME, LEGACY_APP_HOME } from './shared/app-home';
import MainRoute from './pages/MainRoute.vue';

declare module 'vue-router' {
  interface RouteMeta {
    /** The SvelteKit route id, `null` for an address no route knows. */
    routeId: string | null;
  }
}

// Home and `/r/:roomId` share one component so lobby navigation keeps it mounted.
const openAppRoutes: RouteRecordRaw[] = [
  { path: '/r/:roomId', component: MainRoute, meta: { routeId: '/r/[roomId]' } },
  { path: '/widgets', component: () => import('./pages/WidgetsPage.vue'), meta: { routeId: '/widgets' } },
  { path: '/login', component: () => import('./pages/LoginPage.vue'), meta: { routeId: '/login' } },
  { path: '/register', component: () => import('./pages/RegisterPage.vue'), meta: { routeId: '/register' } },
  { path: '/privacy', component: () => import('./pages/PrivacyPage.vue'), meta: { routeId: '/privacy' } },
  { path: '/terms', component: () => import('./pages/TermsPage.vue'), meta: { routeId: '/terms' } },
  { path: '/licenses', component: () => import('./pages/LicensesPage.vue'), meta: { routeId: '/licenses' } },
  { path: '/:unknown(.*)*', component: () => import('./pages/NotFoundPage.vue'), meta: { routeId: null } }
];

function routesForHome(home: typeof APP_HOME): RouteRecordRaw[] {
  const alias = home === '/' ? LEGACY_APP_HOME : '/';
  return [
    { path: alias, redirect: (to) => ({ path: home, query: to.query, hash: to.hash }), meta: { routeId: alias } },
    { path: home, component: MainRoute, meta: { routeId: LEGACY_APP_HOME } },
    ...openAppRoutes
  ];
}

export const routes = routesForHome(APP_HOME);

export function createAppRouter(history: RouterHistory = createWebHistory(), home = APP_HOME): Router {
  return createRouter({
    history,
    routes: home === APP_HOME ? routes : routesForHome(home),
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
