import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeLocale, resolveLocale } from '../src/localization.ts';
import { localizeNotificationPayload } from '../src/notification-text.ts';

test('saved supported locale wins; otherwise preferences resolve in order with Russian fallback', () => {
  assert.equal(normalizeLocale(' FR-ca '), 'fr');
  assert.equal(normalizeLocale('en-GB'), 'en');
  assert.equal(normalizeLocale('ru-RU'), 'ru');
  assert.equal(normalizeLocale('fr<script>'), null);
  assert.equal(resolveLocale(['de-DE', 'fr-FR', 'en']), 'fr');
  assert.equal(resolveLocale(['en'], 'ru'), 'ru');
  assert.equal(resolveLocale(['de-DE'], 'corrupt'), 'ru');
});

test('notification copy localizes per recipient while preserving names/content and private selection', () => {
  const payload = {
    title: 'VoiceRoom',
    body: 'A user’s message',
    url: '/?dm=1',
    copy: {
      title: { key: 'ringTitle', args: { actor: 'Élodie 🐈' } },
      privateBody: { key: 'privateMessage' }
    }
  };
  assert.deepEqual(localizeNotificationPayload(payload, 'en'), {
    title: 'Élodie 🐈 is inviting you',
    body: 'A user’s message',
    url: '/?dm=1'
  });
  assert.deepEqual(localizeNotificationPayload({ ...payload, notificationPrivate: true }, 'fr'), {
    title: 'Élodie 🐈 vous invite',
    body: 'Ouvrez VoiceRoom pour lire le message.',
    url: '/?dm=1'
  });
  assert.deepEqual(localizeNotificationPayload({ body: 'legacy', copy: { body: { key: 'unknown' } } }, 'fr'), {
    body: 'legacy'
  });
  assert.deepEqual(
    localizeNotificationPayload(
      {
        body: 'legacy invitation',
        copy: {
          body: { key: 'roomInvitation', args: { room: 'Élodie 🐈' } }
        }
      },
      'fr'
    ),
    { body: 'Invitation au salon « Élodie 🐈 »' }
  );
});
