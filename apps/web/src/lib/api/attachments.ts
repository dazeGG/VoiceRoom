import type {
  AttachmentAnswer,
  AttachmentContext,
  AttachmentDraft,
  AttachmentState
} from '@voice-room/shared/contracts/media';
import { api, ApiError, failureMessage } from './client';

export type { AttachmentContext, AttachmentDraft };
export type AttachmentDraftState = AttachmentState;

const UPLOAD_FAILED = 'Не удалось загрузить изображение';
const path = (id: string) => `/api/media/attachments/${encodeURIComponent(id)}`;

export async function createAttachmentSlot(input: {
  context: AttachmentContext;
  clientRequestId: string;
  bytes: number;
}): Promise<AttachmentDraft> {
  return (await api.post<AttachmentAnswer>('/api/media/attachments', input, { fallback: UPLOAD_FAILED })).attachment;
}

type UploadAnswer = Partial<AttachmentAnswer> & Record<string, unknown>;

function parseAnswer(text: string): UploadAnswer | null {
  try {
    return JSON.parse(text) as UploadAnswer;
  } catch {
    return null;
  }
}

/** Uploads over XHR, the one way to report upload progress; fails like the API client. */
export function uploadAttachmentContent(
  id: string,
  file: File,
  onProgress: (ratio: number) => void = () => {}
): Promise<AttachmentDraft> {
  return new Promise((resolve, reject) => {
    const body = new FormData();
    body.append('file', file, file.name);
    const request = new XMLHttpRequest();
    request.open('PUT', `${path(id)}/content`);
    request.withCredentials = true;
    request.setRequestHeader('Accept', 'application/json');
    request.upload.onprogress = (event) => {
      if (event.lengthComputable) onProgress(Math.max(0, Math.min(1, event.loaded / event.total)));
    };
    request.onerror = () => reject(new ApiError('Сервер недоступен', 0, { code: 'media_network_error' }));
    request.onload = () => {
      const payload = parseAnswer(request.responseText);
      if (request.status < 200 || request.status >= 300 || !payload?.attachment) {
        reject(new ApiError(failureMessage(payload, UPLOAD_FAILED), request.status, payload ?? {}));
        return;
      }
      onProgress(1);
      resolve(payload.attachment);
    };
    request.send(body);
  });
}

export async function getAttachmentStatus(id: string): Promise<AttachmentDraft> {
  return (await api.get<AttachmentAnswer>(path(id), { fallback: UPLOAD_FAILED })).attachment;
}

export async function retryAttachment(id: string): Promise<AttachmentDraft> {
  return (await api.post<AttachmentAnswer>(`${path(id)}/retry`, undefined, { fallback: UPLOAD_FAILED })).attachment;
}

export async function deleteAttachment(id: string): Promise<void> {
  await api.delete<AttachmentAnswer>(path(id), undefined, { fallback: UPLOAD_FAILED });
}

export function attachmentVariantUrl(id: string, variant: 'preview' | 'processed', download = false): string {
  return `${path(id)}/${variant}${download ? '?download=1' : ''}`;
}
