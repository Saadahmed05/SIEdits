import { createAnthropicProvider } from './anthropic';
import { heuristicProvider } from './heuristic';
import { createOpenAICompatibleProvider } from './openai-compatible';
import type { PlannerProvider } from './types';

export interface ProviderEnv {
  ANTHROPIC_API_KEY?: string;
  ANTHROPIC_MODEL?: string;
  ANTHROPIC_EFFORT?: string;
  ANTHROPIC_BASE_URL?: string;
  OPENAI_BASE_URL?: string;
  OPENAI_API_KEY?: string;
  OPENAI_MODEL?: string;
}

/** All planners, in "auto" preference order. Add new providers here. */
export function createProviders(env: ProviderEnv): PlannerProvider[] {
  const effort = env.ANTHROPIC_EFFORT === 'low' || env.ANTHROPIC_EFFORT === 'high' ? env.ANTHROPIC_EFFORT : 'medium';
  return [
    createAnthropicProvider({
      apiKey: env.ANTHROPIC_API_KEY || undefined,
      model: env.ANTHROPIC_MODEL || 'claude-opus-5-5',
      effort,
      baseURL: env.ANTHROPIC_BASE_URL || undefined,
    }),
    createOpenAICompatibleProvider({
      baseURL: env.OPENAI_BASE_URL || undefined,
      apiKey: env.OPENAI_API_KEY || undefined,
      model: env.OPENAI_MODEL || undefined,
    }),
    heuristicProvider,
  ];
}
