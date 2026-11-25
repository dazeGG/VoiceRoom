// The jump and the "react" entry of a message's menu act on the message's own markup: the bubble
// is flashed with the class its stylesheet styles, and the hover toolbar's "more" button is clicked.

import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { useChatScroll } from '@/shared/chat/use-chat-scroll';

function chatBody() {
  const element = document.createElement('div');
  element.innerHTML = `
    <div class="message-bubble" data-message-id="m1">
      <button class="reaction-picker__button reaction-picker__button--more" type="button"></button>
    </div>`;
  document.body.append(element);
  const scroll = useChatScroll();
  const stop = scroll.body(element);
  const bubble = element.querySelector<HTMLElement>('[data-message-id="m1"]');
  const more = element.querySelector<HTMLButtonElement>('.reaction-picker__button--more');
  if (!bubble || !more) throw new Error('chat fixture is incomplete');
  const cleanup = (): void => {
    stop();
    element.remove();
  };
  return { scroll, bubble, more, cleanup };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal('CSS', { escape: (value: string) => value });
  Object.defineProperty(Element.prototype, 'scrollIntoView', { value: () => {}, configurable: true });
});
afterEach(() => vi.useRealTimers());

test('jumping to a message flashes its bubble with the highlighted class, then takes it off', () => {
  const { scroll, bubble, cleanup } = chatBody();
  const onMissing = vi.fn();

  scroll.jumpTo('m1', onMissing);
  expect(bubble.classList.contains('message-bubble--highlighted')).toBe(true);
  expect(onMissing).not.toHaveBeenCalled();

  vi.advanceTimersByTime(2000);
  expect(bubble.classList.contains('message-bubble--highlighted')).toBe(false);
  cleanup();
});

test('a message that is not on screen reports it instead of flashing', () => {
  const { scroll, cleanup } = chatBody();
  const onMissing = vi.fn();
  scroll.jumpTo('gone', onMissing);
  expect(onMissing).toHaveBeenCalledTimes(1);
  cleanup();
});

test("the menu's react entry opens the picker of that message's toolbar", async () => {
  const { scroll, more, cleanup } = chatBody();
  const clicked = vi.fn();
  more.addEventListener('click', clicked);

  scroll.openReactionPicker('m1');
  await Promise.resolve();

  expect(clicked).toHaveBeenCalledTimes(1);
  cleanup();
});
