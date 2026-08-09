// ESM view of the category layer. Mirrors emoji-groups.js — see that file for
// why the groups are derived from the frozen corpus rather than shipped as a
// second table.

import { listReactionEmojis } from './emoji.mjs';

const GROUP_ANCHORS = Object.freeze([
  { key: 'smileys', label: 'Смайлы и эмоции', icon: '😀', anchor: '\u{1F600}' },
  { key: 'people', label: 'Люди', icon: '🧑', anchor: '\u{1F44B}' },
  { key: 'nature', label: 'Животные и природа', icon: '🐶', anchor: '\u{1F435}' },
  { key: 'food', label: 'Еда и напитки', icon: '🍔', anchor: '\u{1F347}' },
  { key: 'travel', label: 'Путешествия и места', icon: '🚗', anchor: '\u{1F30D}' },
  { key: 'activities', label: 'Занятия', icon: '⚽', anchor: '\u{1F383}' },
  { key: 'objects', label: 'Предметы', icon: '💡', anchor: '\u{1F453}' },
  { key: 'symbols', label: 'Символы', icon: '🔣', anchor: '\u{1F3E7}' },
  { key: 'flags', label: 'Флаги', icon: '🚩', anchor: '\u{1F3C1}' }
]);

function buildGroups() {
  const corpus = listReactionEmojis();
  const starts = GROUP_ANCHORS.map((group) => {
    const index = corpus.indexOf(group.anchor);
    if (index < 0) {
      throw new Error(`Emoji corpus is missing the "${group.key}" group anchor`);
    }
    return index;
  });

  for (let i = 1; i < starts.length; i += 1) {
    if (starts[i] <= starts[i - 1]) {
      throw new Error('Emoji corpus is no longer in Unicode group order');
    }
  }
  if (starts[0] !== 0) {
    throw new Error('Emoji corpus does not start at the first Unicode group');
  }

  return Object.freeze(
    GROUP_ANCHORS.map((group, index) =>
      Object.freeze({
        key: group.key,
        label: group.label,
        icon: group.icon,
        emojis: Object.freeze(corpus.slice(starts[index], starts[index + 1] ?? corpus.length))
      })
    )
  );
}

let cached = null;

export function listReactionEmojiGroups() {
  cached = cached || buildGroups();
  return cached;
}

export function reactionEmojiGroupKey(emoji) {
  for (const group of listReactionEmojiGroups()) {
    if (group.emojis.includes(emoji)) return group.key;
  }
  return '';
}
