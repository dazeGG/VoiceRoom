import { t } from '@voice-room/ui/i18n';
import { UserFacingError } from '../core/utils.ts';

export class LiveKitTransportError extends Error {
  code = 'transport_error';
  status = 0;

  constructor() {
    super('LiveKit transport unavailable');
    this.name = 'LiveKitTransportError';
  }
}

export function formatJoinError(error: unknown, transportFailure: { message: string } | null): string {
  if (error instanceof LiveKitTransportError) {
    return t('LiveKit недоступен: голосовой сервер не отвечает, попробуйте подключиться позже');
  }
  if (transportFailure) return transportFailure.message;
  if (error instanceof UserFacingError) return error.message;
  return t('Не удалось подключиться');
}
