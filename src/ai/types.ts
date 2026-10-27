import type { Settings } from '../project/schema';
import type { Template } from '../storyboard/templates';

export interface PlanRequest {
  brief: string;
  template: Template;
  /** Desired total video length in seconds. */
  targetDuration: number;
  settings: Settings;
}

export interface PlanResponse {
  /** Untrusted planner output. Always validated against StoryboardSchema by the caller. */
  storyboard: unknown;
  /** Notes the planner wants surfaced to the user (e.g. placeholder copy was used). */
  warnings?: string[];
  model?: string;
}

/**
 * A planner turns a brief into a storyboard. Implementations must not construct projects or
 * return executable content; anything they return is treated as untrusted data.
 */
export interface PlannerProvider {
  readonly id: string;
  readonly label: string;
  /** True when the provider has the configuration it needs (API key, URL…). */
  isConfigured(): boolean;
  plan(request: PlanRequest, signal: AbortSignal): Promise<PlanResponse>;
}

export class ProviderError extends Error {
  constructor(
    readonly provider: string,
    message: string,
  ) {
    super(message);
    this.name = 'ProviderError';
  }
}
