export interface EmojiReactionAuthority {
  name: 'Unicode emoji-test.txt';
  provider: 'Unicode Consortium';
  url: 'https://www.unicode.org/Public/17.0.0/emoji/emoji-test.txt';
  unicodeVersion: '17.0';
  fileDate: '2025-08-04, 20:55:31 GMT';
  accessedDate: '2026-07-20';
  byteSize: 669326;
  unicodeFileSha256: '1d8a944f88d7952f7ef7c5167fef3c67995bcae24543949710231b03a201acda';
  corpusSha256: '4a53e0c0dc317e6830f4055191e9fe287ab2db8978b2f78bdbaa43a60483d791';
  acceptedCount: 3944;
  license: 'Unicode Terms of Use';
  licenseUrl: 'https://www.unicode.org/terms_of_use.html';
  attribution: string;
  policy: {
    acceptedStatuses: readonly ['fully-qualified'];
    rejectedStatuses: readonly ['minimally-qualified', 'unqualified', 'component'];
    rejectStandaloneComponents: true;
    rejectUnknownSequences: true;
    rejectMultipleSequences: true;
    rejectMalformedInput: true;
  };
  counts: {
    'fully-qualified': 3944;
    'minimally-qualified': 1029;
    unqualified: 243;
    component: 9;
    total: 5225;
  };
}

export const EMOJI_REACTION_AUTHORITY: EmojiReactionAuthority;

export function isReactionEmoji(value: unknown): value is string;

export function cleanReactionEmoji(value: unknown): string;

export function assertReactionEmoji(value: unknown): string;

export function listReactionEmojis(): string[];

