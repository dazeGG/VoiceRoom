import assert from 'node:assert/strict';
import test from 'node:test';
import * as c from '../src/room-message-content.ts';
test('G51-A01 structured content projects deterministic safe text', () => {
  const value = {
    version: 1,
    segments: [
      { type: 'text', text: 'Привет ' },
      { type: 'mention', userId: 'u', label: '@Ёж' },
      { type: 'link', href: 'https://example.com/a?q=1', label: ' ссылка' }
    ]
  };
  assert.deepEqual(c.normalizeRoomMessageContent(value), value);
  assert.equal(c.projectRoomMessageContent(value), 'Привет @Ёж ссылка');
});
test('G51-A02 invalid or unknown content falls back and link protocols are checked', () => {
  assert.equal(c.normalizeRoomMessageContent({ version: 2, segments: [] }), null);
  assert.equal(
    c.normalizeRoomMessageContent({
      version: 1,
      segments: [{ type: 'link', label: 'link', href: 'data:text/plain,hello' }]
    }),
    null
  );
  assert.equal(c.projectRoomMessageContent({ version: 2 }, 'legacy'), 'legacy');
});

test('Markdown source projects as literal text, including whitespace and angle brackets', () => {
  const markdown = '\n```html\n  <article>e\u0301</article>\n\n\n```\n';
  const content = { version: 1, segments: [{ type: 'text', text: markdown }] };
  assert.deepEqual(c.contentFromPlainText(markdown.replaceAll('\n', '\r\n')), content);
  assert.deepEqual(c.normalizeRoomMessageContent(content), content);
  assert.equal(c.projectRoomMessageContent(content), markdown);
  assert.equal(c.contentFromPlainText('  \n'), null);
});
