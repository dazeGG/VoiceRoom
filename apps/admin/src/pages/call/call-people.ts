import type { VoiceMinute } from '@voiceroom/shared/contracts/admin';
import type { CallPerson } from '../rooms/room-bits.ts';

export const personName = (person: Pick<CallPerson, 'account' | 'guestName'>) =>
  person.account ? person.account.displayName || person.account.login : (person.guestName ?? 'Гость');

export const minutesOfPerson = (person: CallPerson): VoiceMinute[] =>
  person.spans.flatMap((span) => span.minutes).sort((a, b) => a.at - b.at);
