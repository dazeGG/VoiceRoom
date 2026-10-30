// Test component: shows a store value and the current route.

import { defineComponent, h } from 'vue';
import { useRoute } from 'vue-router';

import { useCounterStore } from '../fixtures/counter-store.ts';

export default defineComponent({
  setup() {
    const counter = useCounterStore();
    const route = useRoute();
    return () => h('p', `${counter.count} at ${route.fullPath}`);
  }
});
