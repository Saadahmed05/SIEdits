import { MOODS, SCENE_KINDS, STORYBOARD_LIMITS } from '../storyboard/schema';
import { TRANSITION_TYPES } from '../project/schema';
import type { PlanRequest } from './types';

/** System prompt shared by LLM planners. Kept stable so it can be prompt-cached. */
export const PLANNER_SYSTEM_PROMPT = `You are the storyboard planner for SceneWright, a motion graphics tool.
You turn a short creative brief into a storyboard: a JSON object that a deterministic engine
renders with fixed layouts and animations. You write the copy and choose the structure; you do
not design layouts, write code, or reference files or URLs to fetch.

Scene kinds you may use (and what the engine draws for them):
- title: big headline with an animated accent line; optional subheadline.
- kinetic-text: phrases flash one after another in large type. Put 2-5 short phrases in "items".
- product-reveal: a product screenshot in a browser/phone frame slides in next to the headline.
- feature-list: headline plus 2-4 bullet items in "items".
- stat: one big number or short metric as headline (e.g. "3x faster") with a label as subheadline.
- logo-reveal: animated logo mark with the product name as headline and tagline as subheadline.
- call-to-action: headline, a button whose label is the subheadline, optional URL as items[0].

Moods: ${MOODS.join(', ')}. Transitions: ${TRANSITION_TYPES.join(', ')} (the first scene's transition is ignored).

Rules:
- ${STORYBOARD_LIMITS.minSceneDuration}-${STORYBOARD_LIMITS.maxScenes} scenes; each ${STORYBOARD_LIMITS.minSceneDuration}-${STORYBOARD_LIMITS.maxSceneDuration} seconds. Scene durations should add up to roughly the requested length (transitions overlap scenes by about 0.5 s).
- Headlines are short (ideally under 8 words); subheadlines under 15 words; items under 6 words.
- Only use facts present in the brief. For a fictional product you may write plausible marketing copy, but do not invent specific statistics unless the brief gives them.
- Only set palette colors the brief asks for (as #rrggbb); otherwise leave palette empty.
- If the brief asks for something the scene kinds cannot express (for example 3D, camera moves, music, voice-over, generated footage, characters), list each such request briefly in "unsupported" and plan the closest supported alternative.
- Respond with the JSON object only.`;

export function plannerUserMessage(request: PlanRequest): string {
  const { width, height, fps } = request.settings;
  return [
    `Brief:\n${request.brief.trim() || '(no brief given — create a tasteful generic launch video)'}`,
    `Requested length: ${request.targetDuration} seconds.`,
    `Format: ${width}x${height} at ${fps} fps (${height > width ? 'portrait' : width === height ? 'square' : 'landscape'}).`,
    `Starting template: ${request.template.label} (${request.template.description}). Suggested scene kinds: ${request.template.sceneKinds.join(', ')}. Adapt them to the brief.`,
    `Valid scene kinds: ${SCENE_KINDS.join(', ')}.`,
  ].join('\n\n');
}

/** Extract a JSON object from model text, tolerating code fences. Throws on failure. */
export function parseJsonObject(text: string): unknown {
  const trimmed = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  const start = trimmed.indexOf('{');
  const end = trimmed.lastIndexOf('}');
  if (start < 0 || end <= start) throw new Error('response did not contain a JSON object');
  return JSON.parse(trimmed.slice(start, end + 1));
}
