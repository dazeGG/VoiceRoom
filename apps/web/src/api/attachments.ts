import { t } from '@/shared/i18n';
import {
  AttachmentAnswer,
  CreateAttachmentBody,
  type AttachmentContext,
  type AttachmentDraft,
  type AttachmentKind
} from '@voiceroom/shared/contracts/media';
import { api, ApiError, checkedAnswer, failureMessage, isJsonObject } from './client';

export type { AttachmentContext, AttachmentDraft };

const UPLOAD_FAILED = 'Не удалось загрузить изображение';
const path = (id: string) => `/api/media/attachments/${encodeURIComponent(id)}`;

export async function createAttachmentSlot(
  input: {
    context: AttachmentContext;
    clientRequestId: string;
    bytes: number;
    kind?: AttachmentKind;
  },
  signal?: AbortSignal
): Promise<AttachmentDraft> {
  return (
    await api.post('/api/media/attachments', AttachmentAnswer, input, {
      bodySchema: CreateAttachmentBody,
      signal,
      fallback: t(UPLOAD_FAILED)
    })
  ).attachment;
}

function parseAnswer(text: string): Record<string, unknown> | null {
  try {
    const body: unknown = JSON.parse(text);
    return isJsonObject(body) ? body : null;
  } catch {
    return null;
  }
}

/** Uploads over XHR, the one way to report upload progress; fails like the API client. */
export async function uploadAttachmentContent(
  id: string,
  file: File,
  onProgress: (ratio: number) => void = () => {},
  signal?: AbortSignal
): Promise<AttachmentDraft> {
  signal?.throwIfAborted();
  const url = `${path(id)}/content`;
  const request = new XMLHttpRequest();
  const abort = () => request.abort();
  const { status, payload } = await new Promise<{ status: number; payload: Record<string, unknown> | null }>(
    (resolve, reject) => {
      const body = new FormData();
      body.append('file', file, file.name);
      request.open('PUT', url);
      request.withCredentials = true;
      request.setRequestHeader('Accept', 'application/json');
      request.upload.onprogress = (event) => {
        if (event.lengthComputable) onProgress(Math.max(0, Math.min(1, event.loaded / event.total)));
      };
      request.onerror = () => reject(new ApiError(t('Сервер недоступен'), 0));
      request.onabort = () => reject(new DOMException('Upload aborted', 'AbortError'));
      request.onload = () => resolve({ status: request.status, payload: parseAnswer(request.responseText) });
      signal?.addEventListener('abort', abort, { once: true });
      request.send(body);
    }
  ).finally(() => signal?.removeEventListener('abort', abort));
  if (status < 200 || status >= 300 || !payload) {
    throw new ApiError(failureMessage(payload, t(UPLOAD_FAILED)), status, payload ?? {});
  }
  const { attachment } = checkedAnswer(AttachmentAnswer, payload, status, url);
  onProgress(1);
  return attachment;
}

export async function getAttachmentStatus(id: string, signal?: AbortSignal): Promise<AttachmentDraft> {
  return (await api.get(path(id), AttachmentAnswer, { fallback: t(UPLOAD_FAILED), signal })).attachment;
}

export async function retryAttachment(id: string, signal?: AbortSignal): Promise<AttachmentDraft> {
  return (await api.post(`${path(id)}/retry`, AttachmentAnswer, undefined, { fallback: t(UPLOAD_FAILED), signal }))
    .attachment;
}

export async function deleteAttachment(id: string, signal?: AbortSignal): Promise<void> {
  await api.delete(path(id), AttachmentAnswer, undefined, { fallback: t(UPLOAD_FAILED), signal });
}

export function attachmentVariantUrl(id: string, variant: 'preview' | 'processed' | 'file', download = false): string {
  return `${path(id)}/${variant}${download ? '?download=1' : ''}`;
}
