/**
 * Claude planner via the official Anthropic SDK. Uses structured outputs (JSON schema) so the
 * response is a storyboard object; the result is still validated by StoryboardSchema.
 */
import Anthropic from '@anthropic-ai/sdk';
import { STORYBOARD_JSON_SCHEMA } from '../storyboard/schema';
import { PLANNER_SYSTEM_PROMPT, parseJsonObject, plannerUserMessage } from './prompt';
import { ProviderError, type PlannerProvider, type PlanRequest, type PlanResponse } from './types';

export interface AnthropicConfig {
  apiKey?: string;
  model: string;
  effort: 'low' | 'medium' | 'high';
  baseURL?: string;
}

export function describeAnthropicError(err: unknown): string {
  if (err instanceof Anthropic.AuthenticationError) return 'the API key was rejected (401)';
  if (err instanceof Anthropic.PermissionDeniedError) return 'the API key lacks permission for this model (403)';
  if (err instanceof Anthropic.NotFoundError) return 'model not found (404) — check ANTHROPIC_MODEL';
  if (err instanceof Anthropic.RateLimitError) return 'rate limited (429) — try again shortly';
  if (err instanceof Anthropic.BadRequestError) return `request rejected (400): ${err.message}`;
  if (err instanceof Anthropic.APIConnectionError) return `could not reach the Anthropic API: ${err.message}`;
  if (err instanceof Anthropic.APIError) return `API error ${err.status ?? ''}: ${err.message}`.trim();
  return (err as Error)?.message ?? String(err);
}

export function createAnthropicProvider(config: AnthropicConfig): PlannerProvider {
  let client: Anthropic | null = null;
  return {
    id: 'anthropic',
    label: `Claude (${config.model})`,
    isConfigured: () => Boolean(config.apiKey),
    async plan(request: PlanRequest, signal: AbortSignal): Promise<PlanResponse> {
      if (!config.apiKey) throw new ProviderError('anthropic', 'ANTHROPIC_API_KEY is not set');
      client ??= new Anthropic({ apiKey: config.apiKey, baseURL: config.baseURL, maxRetries: 1 });
      let response: Anthropic.Beta.Messages.BetaMessage;
      try {
        response = await client.beta.messages.create(
          {
            model: config.model,
            max_tokens: 16000,
            // Server-side fallback: if the model declines, the API retries on a fallback model.
            betas: ['server-side-fallback-2026-07-01'],
            fallbacks: 'default',
            output_config: {
              effort: config.effort,
              format: { type: 'json_schema', schema: STORYBOARD_JSON_SCHEMA as unknown as Record<string, unknown> },
            },
            system: PLANNER_SYSTEM_PROMPT,
            messages: [{ role: 'user', content: plannerUserMessage(request) }],
          },
          { signal },
        );
      } catch (err) {
        throw new ProviderError('anthropic', describeAnthropicError(err));
      }
      if (response.stop_reason === 'refusal') throw new ProviderError('anthropic', 'the model declined this brief');
      if (response.stop_reason === 'max_tokens') throw new ProviderError('anthropic', 'the response was cut off (max_tokens)');
      const text = response.content
        .filter((b): b is Anthropic.Beta.Messages.BetaTextBlock => b.type === 'text')
        .map((b) => b.text)
        .join('');
      try {
        return { storyboard: parseJsonObject(text), model: response.model };
      } catch (err) {
        throw new ProviderError('anthropic', `could not parse the response as JSON: ${(err as Error).message}`);
      }
    },
  };
}
