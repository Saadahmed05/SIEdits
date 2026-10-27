import type { ValidationIssue } from '../project/schema';

export type RenderErrorCode =
  | 'INVALID_PROJECT'
  | 'INVALID_PARAMS'
  | 'MISSING_ASSET'
  | 'FFMPEG_NOT_FOUND'
  | 'ENCODER_FAILED'
  | 'VERIFY_FAILED'
  | 'CANCELLED';

export class RenderError extends Error {
  constructor(
    readonly code: RenderErrorCode,
    message: string,
    readonly issues: ValidationIssue[] = [],
  ) {
    super(message);
    this.name = 'RenderError';
  }
}
