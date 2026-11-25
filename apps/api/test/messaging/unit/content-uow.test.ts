import assert from 'node:assert/strict';
import test from 'node:test';
import { createContentRepository } from '../../../src/domains/messaging/content.repository.ts';
test('G53-A01 canonical write always derives text from content', () => {
  const repo = createContentRepository();
  assert.deepEqual(
    repo.prepareWrite({ text: 'ignored', content: { version: 1, segments: [{ type: 'text', text: 'canonical' }] } }),
    { text: 'canonical', content: { version: 1, segments: [{ type: 'text', text: 'canonical' }] } }
  );
});

test('room message length counts text and mentions together', () => {
  const repo = createContentRepository();
  const content = (text: string) => ({
    version: 1,
    segments: [
      { type: 'text', text },
      { type: 'mention', userId: 'anna', label: '@anna' }
    ]
  });
  const text = 'x'.repeat(1_995);
  assert.equal(repo.prepareWrite({ content: content(text) }).text, `${text}@anna`);
  assert.throws(() => repo.prepareWrite({ text, content: content(`${text}x`) }), { code: 'invalid_message_content' });
});
