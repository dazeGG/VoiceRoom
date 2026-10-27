import { createPinia, setActivePinia } from 'pinia';
import { createApp } from 'vue';

import App from './App.vue';
import { installBodyClasses } from './stores/page.store';
import './styles/main.scss';

const pinia = createPinia();
// Imperative code (the room client, services) reads stores outside components.
setActivePinia(pinia);
installBodyClasses();

createApp(App).use(pinia).mount('#app');
