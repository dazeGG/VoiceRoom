import { createPinia, setActivePinia } from 'pinia';
import { createApp } from 'vue';

import App from './App.vue';
import { createAppRouter, loadFailedPagesInFull } from './router';
import { installBodyClasses } from './stores/page.store';
import './styles/main.scss';

const pinia = createPinia();
// Imperative code (the room client, services) reads stores outside components.
setActivePinia(pinia);
installBodyClasses();

const router = createAppRouter();
const app = createApp(App).use(pinia).use(router);
loadFailedPagesInFull(router);
// The first route is known before the shell renders, so a phone never sees the
// block screen of a route it may open. It mounts also when that route failed.
const mount = () => app.mount('#app');
void router.isReady().then(mount, mount);
