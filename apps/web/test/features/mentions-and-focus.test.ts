import { beforeEach, expect, test } from 'vitest';
import { createMentionComposer } from '../../src/lib/shared/chat/mention-composer.svelte.ts';
import { state } from '../../src/lib/features/room/client/core/state.svelte.ts';
import { createInitialRoomState } from '../../src/lib/features/room/client/model/room-state.ts';
import {
  clearParticipantFocus,
  getFocusedParticipant,
  getSortedParticipants,
  participantsUi,
  toggleParticipantFocus
} from '../../src/lib/features/room/participants-ui.svelte.ts';

const member = (userId: string, login: string) =>
  ({
    userId,
    login,
    displayName: login,
    avatarColorKey: 'blue',
    avatarUrl: null,
    avatarAccent: null,
    role: 'member',
    joinedAt: null,
    inVoice: false,
    presenceStatus: 'online'
  }) as const;

test('typing @ after a space opens a mention query; e-mail-like text does not', () => {
  const mentions = createMentionComposer();
  expect(mentions.update('привет @ан', 10)).toBe('ан');
  expect(mentions.update('mail@host', 9)).toBe('');
});

test('choosing a member replaces the query with @login and keeps the mention bound to the account', () => {
  const mentions = createMentionComposer();
  const text = 'привет @ан';
  mentions.update(text, text.length);
  mentions.setCandidates([member('u-anna', 'anna'), member('u-andrey', 'andrey')]);
  const chosen = mentions.choose(text, text.length);
  expect(chosen).toEqual({ text: 'привет @anna ', caret: 13 });

  const content = mentions.toContent(`${chosen?.text}как дела`);
  expect(content.segments).toEqual([
    { type: 'text', text: 'привет ' },
    { type: 'mention', userId: 'u-anna', label: '@anna' },
    { type: 'text', text: ' как дела' }
  ]);
});

test('someone already mentioned is not offered again', () => {
  const mentions = createMentionComposer();
  mentions.update('@a', 2);
  mentions.setCandidates([member('u-anna', 'anna')]);
  const first = mentions.choose('@a', 2);
  mentions.update(`${first?.text}@a`, `${first?.text}@a`.length);
  mentions.setCandidates([member('u-anna', 'anna'), member('u-alex', 'alex')]);
  expect(mentions.candidates.map((candidate) => candidate.userId)).toEqual(['u-alex']);
});

beforeEach(() => {
  Object.assign(state, createInitialRoomState());
  clearParticipantFocus();
});

test('you come first in the grid, then peers in the order they joined', () => {
  state.self = { id: 'me', joinedAt: 5 } as never;
  state.peers.set('late', { id: 'late', joinedAt: 30 } as never);
  state.peers.set('early', { id: 'early', joinedAt: 10 } as never);
  expect(getSortedParticipants().map((participant) => participant.id)).toEqual(['me', 'early', 'late']);
});

test('clicking a tile focuses it, clicking again unfocuses, and a departed peer is no longer focused', () => {
  state.peers.set('anna', { id: 'anna', joinedAt: 1 } as never);
  toggleParticipantFocus('anna');
  expect(getFocusedParticipant()?.id).toBe('anna');
  toggleParticipantFocus('anna');
  expect(participantsUi.focusedParticipantId).toBe('');

  toggleParticipantFocus('anna');
  state.peers.delete('anna');
  expect(getFocusedParticipant()).toBeNull();
});
