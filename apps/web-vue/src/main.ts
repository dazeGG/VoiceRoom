import { createPinia, setActivePinia } from 'pinia';
import { createApp } from 'vue';

import App from './App.vue';
import { createAppRouter } from './router';
import { installBodyClasses } from './stores/page.store';
import './styles/main.scss';

const pinia = createPinia();
// Imperative code (the room client, services) reads stores outside components.
setActivePinia(pinia);
installBodyClasses();

const router = createAppRouter();
const app = createApp(App).use(pinia).use(router);
// The first route is known before the shell renders, so a phone never sees the
// block screen of a route it may open.
void router.isReady().then(() => app.mount('#app'));
