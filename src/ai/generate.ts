/**
 * Brief → Project. Picks a planner, validates its untrusted output, falls back to the
 * deterministic planner on any failure, compiles the storyboard and reports what happened.
 */
import { MOOD_STYLES } from '../storyboard/moods';
import { compileStoryboard } from '../storyboard/compile';
import { StoryboardSchema, STORYBOARD_LIMITS, type Storyboard } from '../storyboard/schema';
import { getTemplate } from '../storyboard/templates';
import { PROJECT_FORMAT, PROJECT_VERSION, ProjectSchema, toIssues, type Project, type Settings } from '../project/schema';
import { totalDuration } from '../engine/timeline';
import { heuristicProvider } from './heuristic';
import { ProviderError, type PlannerProvider, type PlanRequest } from './types';

export interface GenerateRequest {
  brief: string;
  templateId: string;
  settings: Settings;
  targetDuration: number;
  name?: string;
  /** Provider id, or "auto" to use the first configured AI provider. */
  provider?: string;
}

export interface GenerationReport {
  planner: string;
  plannerLabel: string;
  model?: string;
  /** Set when an AI planner was attempted but the deterministic planner produced the result. */
  fallbackReason?: string;
  warnings: string[];
  unsupported: string[];
  duration: number;
}

export interface GenerateDeps {
  providers: PlannerProvider[];
  newId: () => string;
  now: () => string;
  timeoutMs?: number;
}

export function selectProvider(providers: PlannerProvider[], requested = 'auto'): PlannerProvider {
  if (requested !== 'auto') {
    const found = providers.find((p) => p.id === requested);
    if (!found) throw new ProviderError(requested, `unknown planner "${requested}"`);
    return found;
  }
  return providers.find((p) => p.id !== 'heuristic' && p.isConfigured()) ?? heuristicProvider;
}

/** Scale scene durations so the overlapped total lands near the requested length. */
export function fitDurations(board: Storyboard, target: number): Storyboard {
  const scenes = board.scenes;
  const sum = scenes.reduce((a, s) => a + s.duration, 0);
  // Expected overlap ≈ 0.5 s per transition (see transitionDurationFor).
  const goal = target + Math.max(0, scenes.length - 1) * 0.5;
  if (sum <= 0 || Math.abs(sum - goal) / goal < 0.08) return board;
  const k = goal / sum;
  return {
    ...board,
    scenes: scenes.map((s) => ({
      ...s,
      duration: Math.min(STORYBOARD_LIMITS.maxSceneDuration, Math.max(STORYBOARD_LIMITS.minSceneDuration, Math.round(s.duration * k * 10) / 10)),
    })),
  };
}

export function createBlankProject(id: string, name: string, settings: Settings, now: string): Project {
  const style = MOOD_STYLES['dark-cinematic'];
  return ProjectSchema.parse({
    format: PROJECT_FORMAT,
    version: PROJECT_VERSION,
    id,
    name,
    createdAt: now,
    updatedAt: now,
    settings,
    brand: style.brand,
    scenes: [
      {
        id: 'scene-1',
        name: '1. Scene',
        duration: 4,
        background: style.background,
        elements: [
          {
            id: 'headline-1',
            name: 'Headline',
            type: 'text',
            text: 'Your headline',
            animations: [{ type: 'fade-in', duration: 0.6 }, { type: 'slide-in', direction: 'up', distance: 0.04, duration: 0.8 }],
          },
        ],
      },
    ],
  });
}

export async function generateProject(
  request: GenerateRequest,
  deps: GenerateDeps,
): Promise<{ project: Project; report: GenerationReport }> {
  const template = getTemplate(request.templateId);
  const id = deps.newId();
  const now = deps.now();
  const name = request.name?.trim() || undefined;

  if (template.id === 'blank') {
    const project = createBlankProject(id, name ?? 'Untitled project', request.settings, now);
    return {
      project,
      report: { planner: 'none', plannerLabel: 'Blank template', warnings: [], unsupported: [], duration: totalDuration(project.scenes) },
    };
  }

  const planRequest: PlanRequest = {
    brief: request.brief,
    template,
    targetDuration: request.targetDuration,
    settings: request.settings,
  };
  const provider = selectProvider(deps.providers, request.provider);
  let fallbackReason: string | undefined;
  let board: Storyboard | null = null;
  let warnings: string[] = [];
  let model: string | undefined;
  let used = provider;

  if (provider.id !== 'heuristic') {
    try {
      if (!provider.isConfigured()) throw new ProviderError(provider.id, 'not configured');
      const signal = AbortSignal.timeout(deps.timeoutMs ?? 90_000);
      const response = await provider.plan(planRequest, signal);
      const parsed = StoryboardSchema.safeParse(response.storyboard);
      if (!parsed.success) {
        const issues = toIssues(parsed.error).slice(0, 5).map((i) => `${i.path}: ${i.message}`);
        throw new ProviderError(provider.id, `output failed validation (${issues.join('; ')})`);
      }
      board = parsed.data;
      warnings = response.warnings ?? [];
      model = response.model;
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      fallbackReason = `${provider.label} failed: ${reason}. Used the built-in planner instead.`;
      used = heuristicProvider;
    }
  }

  if (!board) {
    const response = await heuristicProvider.plan(planRequest, AbortSignal.timeout(10_000));
    // The heuristic planner is ours, but its output goes through the same validation.
    board = StoryboardSchema.parse(response.storyboard);
    warnings = response.warnings ?? [];
  }

  // The built-in planner allocates durations exactly; AI planners are only approximately right.
  const fitted = used.id === 'heuristic' ? board : fitDurations(board, request.targetDuration);
  if (fitted !== board) warnings.push(`Scene durations were scaled to fit the requested ${request.targetDuration}s.`);

  const project = compileStoryboard(fitted, {
    id,
    name,
    settings: request.settings,
    now,
    generation: {
      brief: request.brief.slice(0, 4000),
      template: template.id,
      planner: used.id,
      model,
      at: now,
      warnings: [...(fallbackReason ? [fallbackReason] : []), ...warnings].slice(0, 50),
      unsupported: fitted.unsupported,
    },
  });

  return {
    project,
    report: {
      planner: used.id,
      plannerLabel: used.label,
      model,
      fallbackReason,
      warnings,
      unsupported: fitted.unsupported,
      duration: totalDuration(project.scenes),
    },
  };
}
