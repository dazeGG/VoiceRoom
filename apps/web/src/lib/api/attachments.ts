export type AttachmentContext = 'room' | 'dm';
export type AttachmentDraftState = 'pending' | 'processing' | 'ready' | 'failed' | 'deleted';

export interface AttachmentDraft {
  id: string;
  context: AttachmentContext;
  state: AttachmentDraftState;
  mimeType: string | null;
  bytes: number | null;
  width: number | null;
  height: number | null;
  failureCode: string | null;
  createdAt: string;
  updatedAt: string;
}

type Envelope = { ok: boolean; attachment: AttachmentDraft; code?: string; error?: string };

export class AttachmentApiError extends Error {
  constructor(public code: string, message: string, public status: number) {
    super(message);
    this.name = 'AttachmentApiError';
  }
}

async function envelope(response: Response): Promise<Envelope> {
  const payload = await response.json().catch(() => null) as Envelope | null;
  if (!response.ok || !payload?.ok) {
    throw new AttachmentApiError(payload?.code || 'media_error', payload?.error || 'Не удалось загрузить изображение', response.status);
  }
  return payload;
}

export async function createAttachmentSlot(input: {
  context: AttachmentContext;
  clientRequestId: string;
  bytes: number;
}): Promise<AttachmentDraft> {
  const response = await fetch('/api/media/attachments', {
    method: 'POST',
    credentials: 'same-origin',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify(input)
  });
  return (await envelope(response)).attachment;
}

export function uploadAttachmentContent(
  id: string,
  file: File,
  onProgress: (ratio: number) => void = () => {}
): Promise<AttachmentDraft> {
  return new Promise((resolve, reject) => {
    const body = new FormData();
    body.append('file', file, file.name);
    const request = new XMLHttpRequest();
    request.open('PUT', `/api/media/attachments/${encodeURIComponent(id)}/content`);
    request.withCredentials = true;
    request.setRequestHeader('Accept', 'application/json');
    request.upload.onprogress = (event) => {
      if (event.lengthComputable) onProgress(Math.max(0, Math.min(1, event.loaded / event.total)));
    };
    request.onerror = () => reject(new AttachmentApiError('media_network_error', 'Сервер недоступен', 0));
    request.onload = () => {
      let payload: Envelope | null = null;
      try { payload = JSON.parse(request.responseText) as Envelope; } catch { /* handled below */ }
      if (request.status < 200 || request.status >= 300 || !payload?.ok) {
        reject(new AttachmentApiError(payload?.code || 'media_error', payload?.error || 'Не удалось загрузить изображение', request.status));
        return;
      }
      onProgress(1);
      resolve(payload.attachment);
    };
    request.send(body);
  });
}

export async function getAttachmentStatus(id: string): Promise<AttachmentDraft> {
  const response = await fetch(`/api/media/attachments/${encodeURIComponent(id)}`, {
    credentials: 'same-origin', headers: { Accept: 'application/json' }
  });
  return (await envelope(response)).attachment;
}

export async function retryAttachment(id: string): Promise<AttachmentDraft> {
  const response = await fetch(`/api/media/attachments/${encodeURIComponent(id)}/retry`, {
    method: 'POST', credentials: 'same-origin', headers: { Accept: 'application/json' }
  });
  return (await envelope(response)).attachment;
}

export async function deleteAttachment(id: string): Promise<void> {
  const response = await fetch(`/api/media/attachments/${encodeURIComponent(id)}`, {
    method: 'DELETE', credentials: 'same-origin', headers: { Accept: 'application/json' }
  });
  await envelope(response);
}

export function attachmentVariantUrl(id: string, variant: 'preview' | 'processed', download = false): string {
  return `/api/media/attachments/${encodeURIComponent(id)}/${variant}${download ? '?download=1' : ''}`;
}
