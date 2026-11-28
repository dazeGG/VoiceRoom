// Attachments for chat and direct messages: a slot is reserved, the bytes
// uploaded, the server processes them, and the message then binds the ready
// attachment. The files themselves are served as binary.
//
// Images are the ordinary kind. The one other kind is the diagnostics file a
// person attaches in the VoiceRoom chat: a plain-text report that is never
// processed, is bound only into a conversation with the official account and
// is always served as a download.

import { Type, type Static } from 'typebox';
import { Nullable, Ok } from './http.ts';

export const AttachmentContext = Type.Union([Type.Literal('room'), Type.Literal('dm')]);
export type AttachmentContext = Static<typeof AttachmentContext>;

export const AttachmentState = Type.Union([
  Type.Literal('pending'),
  Type.Literal('processing'),
  Type.Literal('ready'),
  Type.Literal('failed'),
  Type.Literal('deleted')
]);
export type AttachmentState = Static<typeof AttachmentState>;

export const AttachmentKind = Type.Union([Type.Literal('image'), Type.Literal('diagnostics')]);
export type AttachmentKind = Static<typeof AttachmentKind>;

/** The diagnostics file: plain text, at most 512 KiB, named by the moment it was built. */
export const DIAGNOSTICS_MIME_TYPE = 'text/plain';
export const DIAGNOSTICS_MAX_BYTES = 512 * 1024;
/** `voiceroom-diagnostics-<yyyy-mm-dd>-<hhmm>.txt`, optionally with seconds. */
export const DIAGNOSTICS_FILE_NAME_PATTERN = /^voiceroom-diagnostics-\d{4}-\d{2}-\d{2}-\d{4}(\d{2})?\.txt$/;

/** The diagnostics file name for a local moment, e.g. `voiceroom-diagnostics-2026-11-27-1402.txt`. */
export function diagnosticsFileName(at: Date): string {
  const two = (value: number) => String(value).padStart(2, '0');
  const date = `${at.getFullYear()}-${two(at.getMonth() + 1)}-${two(at.getDate())}`;
  return `voiceroom-diagnostics-${date}-${two(at.getHours())}${two(at.getMinutes())}.txt`;
}

/** An attachment as its owner sees it while composing a message. */
export const AttachmentDraft = Type.Object({
  id: Type.String(),
  context: AttachmentContext,
  state: AttachmentState,
  mimeType: Nullable(Type.String()),
  bytes: Nullable(Type.Number()),
  width: Nullable(Type.Number()),
  height: Nullable(Type.Number()),
  failureCode: Nullable(Type.String()),
  createdAt: Nullable(Type.Number()),
  updatedAt: Nullable(Type.Number()),
  /** Absent from servers before 1.6.0, which take images only. */
  kind: Type.Optional(AttachmentKind),
  /** The diagnostics file's name; null for an image. */
  name: Type.Optional(Nullable(Type.String()))
});
export type AttachmentDraft = Static<typeof AttachmentDraft>;

export const AttachmentAnswer = Ok({ attachment: AttachmentDraft });
export type AttachmentAnswer = Static<typeof AttachmentAnswer>;

/** The service names what is wrong with a slot request, so every field is optional here. */
export const CreateAttachmentBody = Type.Object({
  context: Type.Optional(Type.String()),
  clientRequestId: Type.Optional(Type.String()),
  bytes: Type.Optional(Type.Number()),
  /** `diagnostics` reserves a slot for the diagnostics file; without it the slot is for an image. */
  kind: Type.Optional(Type.String())
});

export const AttachmentVariantParams = Type.Object({ id: Type.String(), variant: Type.String() });
export const AttachmentVariantQuery = Type.Object({ download: Type.Optional(Type.String()) });

export const ImageKeyParams = Type.Object({ key: Type.String() });
