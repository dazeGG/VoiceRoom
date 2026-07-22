import {
  createAttachmentSlot,
  deleteAttachment,
  getAttachmentStatus,
  retryAttachment,
  uploadAttachmentContent,
  type AttachmentContext,
  type AttachmentDraft
} from '../../api/attachments';

export interface ComposeDraft extends AttachmentDraft {
  file: File | null;
  progress: number;
  error: string | null;
}

const stores = new Map<string, AttachmentComposeStore>();
const allowedTypes = new Set(['image/jpeg', 'image/png', 'image/webp']);

export class AttachmentComposeStore {
  drafts = $state<ComposeDraft[]>([]);
  busy = $state(false);

  private readonly storageKey: string;

  constructor(readonly context: AttachmentContext, readonly contextId: string) {
    this.storageKey = `voice-room:attachment-drafts:${context}:${contextId}`;
    if (typeof localStorage !== 'undefined') {
      try {
        const ids = JSON.parse(localStorage.getItem(this.storageKey) || '[]');
        if (Array.isArray(ids) && ids.length) void this.resume(ids.filter((id): id is string => typeof id === 'string'));
      } catch { localStorage.removeItem(this.storageKey); }
    }
  }

  get readyIds(): string[] { return this.drafts.filter((draft) => draft.state === 'ready').map((draft) => draft.id); }
  get canSend(): boolean { return this.drafts.length > 0 && this.drafts.every((draft) => draft.state === 'ready'); }

  async addFiles(files: Iterable<File>): Promise<void> {
    const candidates = Array.from(files).slice(0, Math.max(0, 4 - this.drafts.length));
    for (const file of candidates) {
      if (!allowedTypes.has(file.type) || file.size < 1 || file.size > 10 * 1024 * 1024) {
        throw new Error('Поддерживаются JPEG, PNG и WebP размером до 10 МБ');
      }
      await this.upload(file);
    }
  }

  private async upload(file: File): Promise<void> {
    this.busy = true;
    let draft: ComposeDraft | null = null;
    try {
      const slot = await createAttachmentSlot({
        context: this.context,
        bytes: file.size,
        clientRequestId: crypto.randomUUID()
      });
      draft = { ...slot, file, progress: 0, error: null };
      this.drafts.push(draft);
      this.persist();
      Object.assign(draft, await uploadAttachmentContent(slot.id, file, (progress) => {
        if (draft) draft.progress = progress;
      }), { progress: 1 });
      await this.waitUntilTerminal(draft);
    } catch (error) {
      if (draft && draft.state !== 'ready') draft.error = error instanceof Error ? error.message : 'Ошибка загрузки';
      else throw error;
    } finally {
      this.busy = false;
    }
  }

  async waitUntilTerminal(draft: ComposeDraft): Promise<void> {
    for (let attempt = 0; attempt < 120 && draft.state === 'processing'; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 1_000));
      Object.assign(draft, await getAttachmentStatus(draft.id));
    }
  }

  async resume(ids: string[]): Promise<void> {
    const statuses = await Promise.all(ids.slice(0, 4).map(getAttachmentStatus));
    this.drafts = statuses.filter((draft) => draft.context === this.context && draft.state !== 'deleted')
      .map((draft) => ({ ...draft, file: null, progress: draft.state === 'ready' ? 1 : 0, error: null }));
    this.persist();
    await Promise.all(this.drafts.filter((draft) => draft.state === 'processing').map((draft) => this.waitUntilTerminal(draft)));
  }

  move(from: number, to: number): void {
    if (from === to || from < 0 || to < 0 || from >= this.drafts.length || to >= this.drafts.length) return;
    const [draft] = this.drafts.splice(from, 1);
    this.drafts.splice(to, 0, draft);
    this.persist();
  }

  async retry(draft: ComposeDraft): Promise<void> {
    draft.error = null;
    Object.assign(draft, await retryAttachment(draft.id));
    await this.waitUntilTerminal(draft);
  }

  async remove(draft: ComposeDraft): Promise<void> {
    await deleteAttachment(draft.id);
    this.drafts = this.drafts.filter((item) => item.id !== draft.id);
    this.persist();
  }

  private persist(): void {
    if (typeof localStorage === 'undefined') return;
    if (this.drafts.length) localStorage.setItem(this.storageKey, JSON.stringify(this.drafts.map((draft) => draft.id)));
    else localStorage.removeItem(this.storageKey);
  }

  clearBound(): void { this.drafts = []; this.persist(); }
}

export function getAttachmentComposeStore(context: AttachmentContext, contextId: string): AttachmentComposeStore {
  const key = `${context}:${contextId}`;
  let store = stores.get(key);
  if (!store) {
    store = new AttachmentComposeStore(context, contextId);
    stores.set(key, store);
  }
  return store;
}

export function clearAttachmentComposeStores(): void {
  stores.clear();
  if (typeof localStorage !== 'undefined') {
    for (let index = localStorage.length - 1; index >= 0; index -= 1) {
      const key = localStorage.key(index);
      if (key?.startsWith('voice-room:attachment-drafts:')) localStorage.removeItem(key);
    }
  }
}
