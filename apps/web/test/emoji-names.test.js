import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const webRoot = resolve(import.meta.dirname, '..');
const read = (path) => readFileSync(resolve(webRoot, 'src/lib', path), 'utf8');

// Display names and room names may hold emoji, as on Discord; logins may not.
// Wherever a name is shown as text it goes through the same renderer as
// messages, so an emoji in a name is the same artwork as in the picker.
const NAME_SITES = {
  'shared/ui/Ellipsis/Ellipsis.svelte': ['<EmojiText {text} />'],
  'shared/chat/ReactorList.svelte': ['<EmojiText text={reactor.displayName} />'],
  'shared/chat/MentionAutocomplete.svelte': ['<EmojiText text={label(member)} />'],
  'shared/chat/TypingIndicator.svelte': ['<EmojiText text={label} />'],
  'shared/chat/ReplyPreview.svelte': ['<EmojiText text={author} />'],
  'shared/ui/ToastStack/ToastStack.svelte': ['<EmojiText text={toast.message} />'],
  'shared/components/room-menu/RoomInviteFriendList.svelte': ['<EmojiText text={name} />'],
  'features/home/components/lobby/DmView.svelte': [
    '<div class="lobby-dm-head-name"><EmojiText text={friendName(peer)} /></div>',
    '<EmojiText text={self.displayName?.trim() || self.login} />',
    '<EmojiText text={friendName(peer!)} />',
    '<div class="lobby-profile-panel-name"><EmojiText text={friendName(peer)} /></div>'
  ],
  'features/home/components/lobby/Sidebar.svelte': ['<EmojiText text={friendName(entry.user)} />', '<EmojiText text={selfName} />'],
  'features/home/components/lobby/PeopleView.svelte': ['<EmojiText text={friendName(request.user)} />'],
  'features/home/components/lobby/VoiceCallWidget.svelte': ['<EmojiText text={roomName} />'],
  'features/home/components/SettingsModal.svelte': ['<EmojiText text={label} />', '<EmojiText text={blocked.displayName?.trim() || blocked.login} />'],
  'features/room/components/ParticipantTile.svelte': ['<span class="participant-name"><EmojiText text={participant.name} /></span>'],
  'features/room/components/RoomChatPanel.svelte': ['<EmojiText text={group.name} /></button>', '<EmojiText text={group.name} /></span>'],
  'features/room/components/StreamTile.svelte': ['<strong><EmojiText text={title} /></strong>'],
  'features/room/components/PinnedMessagesBar.svelte': ["<EmojiText text={pin.author.name || 'Участник'} />"]
};

test('names and room names are drawn with the emoji renderer wherever they are text', () => {
  for (const [path, snippets] of Object.entries(NAME_SITES)) {
    const source = read(path);
    assert.match(source, /import EmojiText from '(\.\/|\$lib\/shared\/chat\/)EmojiText\.svelte'/, `${path} imports the renderer`);
    for (const snippet of snippets) assert.ok(source.includes(snippet), `${path} renders ${snippet}`);
  }
});

test('an avatar initial skips a leading emoji instead of splitting it in half', () => {
  const avatar = read('shared/ui/Avatar/Avatar.svelte');
  const reactors = read('shared/chat/ReactorList.svelte');
  for (const source of [avatar, reactors]) {
    assert.match(source, /match\(\/\[\\p\{L\}\\p\{N\}\]\/u\)\?\.\[0\]/);
    assert.doesNotMatch(source, /charAt\(0\)|slice\(0, 1\)/);
  }

  const firstLetter = (name) => {
    const letter = name.trim().match(/[\p{L}\p{N}]/u)?.[0];
    return letter ? letter.toUpperCase() : '?';
  };
  assert.equal(firstLetter('😀 вова'), 'В');
  assert.equal(firstLetter('🇷🇺Анна'), 'А');
  assert.equal(firstLetter('👍'), '?');
  assert.equal(firstLetter('bob'), 'B');
});
