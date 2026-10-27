import { render, screen } from '@testing-library/vue';
import { expect, test } from 'vitest';

import App from '@/App.vue';

test('the app renders its name', () => {
  render(App);
  expect(screen.getByText('VoiceRoom')).toBeTruthy();
});
