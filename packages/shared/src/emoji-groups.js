'use strict';

// Category layer over the frozen reaction corpus.
//
// `emoji.js` is generated from the pinned Unicode emoji-test.txt and its content
// hash is asserted by G07, so it must not change. The generator walks that file
// top to bottom, which means the corpus is already in Unicode group order — the
// groups can therefore be recovered as index ranges instead of shipping a second
// 3944-entry table. Each range is anchored on the first emoji of its group; if a
// future corpus regeneration reorders or drops one of those anchors this module
// throws at load rather than silently mis-labelling half the picker.

const { listReactionEmojis } = require('./emoji.js');

// Unicode's "Component" group is rejected by the corpus policy, so it has no
// entry here. Order matches emoji-test.txt.
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

function listReactionEmojiGroups() {
  cached = cached || buildGroups();
  return cached;
}

function reactionEmojiGroupKey(emoji) {
  for (const group of listReactionEmojiGroups()) {
    if (group.emojis.includes(emoji)) return group.key;
  }
  return '';
}

module.exports = {
  listReactionEmojiGroups,
  reactionEmojiGroupKey
};
