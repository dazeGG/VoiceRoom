// Test component: a prop and a default slot.

import { defineComponent, h } from 'vue';

export default defineComponent({
  props: { title: { type: String, required: true } },
  setup(props, { slots }) {
    return () => h('section', [h('h2', props.title), slots.default?.()]);
  }
});
