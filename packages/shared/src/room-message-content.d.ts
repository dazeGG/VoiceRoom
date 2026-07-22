export type RoomMessageTextSegmentV1 = { type: 'text'; text: string };
export type RoomMessageLinkSegmentV1 = { type: 'link'; href: string; label: string };
export type RoomMessageMentionSegmentV1 = { type: 'mention'; userId: string; label: string };
export type RoomMessageSegmentV1 = RoomMessageTextSegmentV1 | RoomMessageLinkSegmentV1 | RoomMessageMentionSegmentV1;
export type RoomMessageContentV1 = { version: 1; segments: RoomMessageSegmentV1[] };

export const CONTENT_VERSION: 1;
export const MAX_CONTENT_BYTES: number;
export const MAX_SEGMENTS: number;
export function contentFromLegacyText(value: unknown): RoomMessageContentV1 | null;
export function normalizeRoomMessageContent(value: unknown): RoomMessageContentV1 | null;
export function projectRoomMessageContent(value: unknown, legacyText?: string): string;
