/**
 * Planner for any OpenAI-compatible chat completions endpoint: Ollama, LM Studio, vLLM,
 * llama.cpp server, or hosted APIs. Uses JSON mode; the schema is given in the prompt and the
 * result is validated by StoryboardSchema.
 */
import { STORYBOARD_JSON_SCHEMA } from '../storyboard/schema';
import { PLANNER_SYSTEM_PROMPT, parseJsonObject, plannerUserMessage } from './prompt';
import { ProviderError, type PlannerProvider, type PlanRequest, type PlanResponse } from './types';

export interface OpenAICompatibleConfig {
  baseURL?: string;
  apiKey?: string;
  model?: string;
}

export function createOpenAICompatibleProvider(
  config: OpenAICompatibleConfig,
  fetchImpl: typeof fetch = globalThis.fetch,
): PlannerProvider {
  return {
    id: 'openai-compatible',
    label: `OpenAI-compatible (${config.model ?? 'not configured'})`,
    isConfigured: () => Boolean(config.baseURL && config.model),
    async plan(request: PlanRequest, signal: AbortSignal): Promise<PlanResponse> {
      if (!config.baseURL || !config.model) {
        throw new ProviderError('openai-compatible', 'OPENAI_BASE_URL and OPENAI_MODEL must be set');
      }
      const url = `${config.baseURL.replace(/\/+$/, '')}/chat/completions`;
      let res: Response;
      try {
        res = await fetchImpl(url, {
          method: 'POST',
          signal,
          headers: {
            'content-type': 'application/json',
            ...(config.apiKey ? { authorization: `Bearer ${config.apiKey}` } : {}),
          },
          body: JSON.stringify({
            model: config.model,
            stream: false,
            response_format: { type: 'json_object' },
            messages: [
              {
                role: 'system',
                content: `${PLANNER_SYSTEM_PROMPT}\n\nThe JSON object must match this JSON Schema:\n${JSON.stringify(STORYBOARD_JSON_SCHEMA)}`,
              },
              { role: 'user', content: plannerUserMessage(request) },
            ],
          }),
        });
      } catch (err) {
        throw new ProviderError('openai-compatible', `could not reach ${url}: ${(err as Error).message}`);
      }
      if (!res.ok) {
        const body = (await res.text().catch(() => '')).slice(0, 300);
        throw new ProviderError('openai-compatible', `HTTP ${res.status} from ${url}${body ? `: ${body}` : ''}`);
      }
      const data = (await res.json().catch(() => null)) as { choices?: Array<{ message?: { content?: string } }>; model?: string } | null;
      const content = data?.choices?.[0]?.message?.content;
      if (typeof content !== 'string') throw new ProviderError('openai-compatible', 'response had no message content');
      try {
        return { storyboard: parseJsonObject(content), model: data?.model ?? config.model };
      } catch (err) {
        throw new ProviderError('openai-compatible', `could not parse the response as JSON: ${(err as Error).message}`);
      }
    },
  };
}
