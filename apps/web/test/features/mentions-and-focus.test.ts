import { createPinia, setActivePinia } from 'pinia';
import { beforeEach, expect, test } from 'vitest';
import { createMentionComposer } from '@/shared/chat/mention-composer';
import { state } from '@/features/room/client/core/room-runtime.store';
import { createInitialRoomState } from '@/features/room/client/model/room-state';
import { useParticipantsUiStore } from '@/features/room/participants-ui.store';
import { participant } from '../fixtures/participant.ts';

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

let participantsUi: ReturnType<typeof useParticipantsUiStore>;

beforeEach(() => {
  setActivePinia(createPinia());
  participantsUi = useParticipantsUiStore();
  Object.assign(state, createInitialRoomState());
  participantsUi.clearParticipantFocus();
});

test('you come first in the grid, then peers in the order they joined', () => {
  state.self = participant({ id: 'me', joinedAt: 5 });
  state.peers.set('late', participant({ id: 'late', joinedAt: 30 }));
  state.peers.set('early', participant({ id: 'early', joinedAt: 10 }));
  expect(participantsUi.getSortedParticipants().map((participant) => participant.id)).toEqual(['me', 'early', 'late']);
});

test('clicking a tile focuses it, clicking again unfocuses, and a departed peer is no longer focused', () => {
  state.peers.set('anna', participant({ id: 'anna', joinedAt: 1 }));
  participantsUi.toggleParticipantFocus('anna');
  expect(participantsUi.getFocusedParticipant()?.id).toBe('anna');
  participantsUi.toggleParticipantFocus('anna');
  expect(participantsUi.focusedParticipantId).toBe('');

  participantsUi.toggleParticipantFocus('anna');
  state.peers.delete('anna');
  expect(participantsUi.getFocusedParticipant()).toBeNull();
});
