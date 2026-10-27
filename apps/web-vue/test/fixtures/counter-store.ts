// A small app module for the test-kit tests: module-level state and a Pinia
// store, the two things freshImport has to give back as new.

import { defineStore } from 'pinia';
import { ref } from 'vue';

export { ref as vueRef } from 'vue';

let calls = 0;

export function countCall(): number {
  calls += 1;
  return calls;
}

export const useCounterStore = defineStore('counter', () => {
  const count = ref(0);
  function increment(): void {
    count.value += 1;
  }
  return { count, increment };
});
