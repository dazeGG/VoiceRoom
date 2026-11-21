import { createPinia, setActivePinia } from 'pinia';
import { createApp } from 'vue';
import App from './App.vue';
import './styles/main.scss';

const pinia = createPinia();
setActivePinia(pinia);
createApp(App).use(pinia).mount('#root');
