// Image attachments for chat and direct messages: a slot is reserved, the
// bytes uploaded, the server processes them, and the message then binds the
// ready attachment. The image files themselves are served as binary.

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
  updatedAt: Nullable(Type.Number())
});
export type AttachmentDraft = Static<typeof AttachmentDraft>;

export const AttachmentAnswer = Ok({ attachment: AttachmentDraft });
export type AttachmentAnswer = Static<typeof AttachmentAnswer>;

/** The service names what is wrong with a slot request, so every field is optional here. */
export const CreateAttachmentBody = Type.Object({
  context: Type.Optional(Type.String()),
  clientRequestId: Type.Optional(Type.String()),
  bytes: Type.Optional(Type.Number())
});

export const AttachmentVariantParams = Type.Object({ id: Type.String(), variant: Type.String() });
export const AttachmentVariantQuery = Type.Object({ download: Type.Optional(Type.String()) });

export const ImageKeyParams = Type.Object({ key: Type.String() });
