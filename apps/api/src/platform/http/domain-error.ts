// A refusal a domain raises on its own: the HTTP status and the catalogued
// code the central error handler (http-kit) answers with.

import type { ErrorCode } from '@voice-room/shared/contracts/errors';

export class DomainError extends Error {
  readonly code: ErrorCode;
  readonly statusCode: number;

  constructor(code: ErrorCode, statusCode: number, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = new.target.name;
    this.code = code;
    this.statusCode = statusCode;
  }
}
