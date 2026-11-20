import { errorText } from '@/api/error-texts';
export { useLocalizedText } from '@voice-room/ui/localized-text';

/** Known API failures have semantic codes; unknown/server-provided messages stay unchanged. */
export function currentErrorMessage(error: { message: string; code?: unknown }): string {
  return typeof error.code === 'string' ? (errorText(error.code) ?? error.message) : error.message;
}
