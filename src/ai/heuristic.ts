/**
 * Deterministic, offline planner. It extracts what it reliably can from the brief with
 * patterns and keyword tables, uses clearly labelled placeholder copy where it cannot, and
 * reports requests it cannot fulfil. Same brief in → same storyboard out.
 */
import { TRANSITION_TYPES } from '../project/schema';
import { transitionDurationFor } from '../storyboard/compile';
import type { Mood, SceneKind, Storyboard, StoryboardScene } from '../storyboard/schema';
import { STORYBOARD_LIMITS } from '../storyboard/schema';
import type { PlannerProvider, PlanRequest, PlanResponse } from './types';

type Transition = (typeof TRANSITION_TYPES)[number];

const MOOD_KEYWORDS: Record<Mood, string[]> = {
  'dark-cinematic': ['dark', 'cinematic', 'night', 'glow', 'glowing', 'moody', 'futuristic', 'sci-fi', 'space', 'dramatic', 'epic'],
  'bright-clean': ['light', 'bright', 'clean', 'white', 'friendly', 'fresh', 'airy', 'corporate', 'pastel'],
  'bold-vibrant': ['bold', 'vibrant', 'energetic', 'colorful', 'colourful', 'playful', 'punchy', 'neon', 'loud', 'fun', 'hype'],
  'minimal-mono': ['minimal', 'minimalist', 'monochrome', 'black and white', 'simple', 'sleek', 'mono'],
  'warm-elegant': ['elegant', 'luxury', 'luxurious', 'warm', 'premium', 'classic', 'serif', 'gold', 'golden', 'refined'],
};

const TEMPLATE_DEFAULT_MOOD: Record<string, Mood> = {
  'product-launch': 'dark-cinematic',
  'kinetic-typography': 'bold-vibrant',
  'logo-reveal': 'warm-elegant',
  blank: 'dark-cinematic',
};

const COLOR_WORDS: Array<[RegExp, string]> = [
  [/\bpurple\b/, '#8b5cf6'],
  [/\bviolet\b/, '#7c3aed'],
  [/\bindigo\b/, '#6366f1'],
  [/\bblue\b/, '#3b82f6'],
  [/\bcyan\b/, '#06b6d4'],
  [/\bteal\b/, '#14b8a6'],
  [/\bgreen\b/, '#22c55e'],
  [/\bemerald\b/, '#10b981'],
  [/\blime\b/, '#84cc16'],
  [/\bred\b/, '#ef4444'],
  [/\borange\b/, '#f97316'],
  [/\byellow\b/, '#eab308'],
  [/\bgold(?:en)?\b/, '#d4a373'],
  [/\b(?:pink|magenta)\b/, '#ec4899'],
  [/\bcoral\b/, '#fb7185'],
];

const UNSUPPORTED: Array<[RegExp, string]> = [
  [/\b3d\b|three-dimensional|camera (?:move|movement|fly|orbit|pan|dolly)|fly-?through|orbiting camera/, '3D scenes and camera moves are not supported yet; 2D motion was used instead.'],
  [/\bmusic\b|soundtrack|\bbeat|\baudio\b|sound effect|\bsfx\b/, 'Music and audio sync are not supported yet; the exported video is silent.'],
  [/voice-?over|narrat/, 'Voice-over is not supported yet.'],
  [/(?:stock|real|live)[- ]?(?:footage|video)|photo-?real|realistic|ai[- ]generated (?:video|footage|image)|generated (?:video|footage)/, 'Generated or stock footage is not supported yet; upload images and use them as screenshots or logos.'],
  [/\bcharacters?\b|\bavatars?\b|\bmascot\b/, 'Characters and avatars are not supported.'],
  [/confetti|\bfire\b|smoke|explosion|\bsparks?\b/, 'Effects like confetti, fire or smoke are not supported; simple drifting particles are available.'],
  [/subtitles?|captions? (?:track|file)/, 'Subtitle tracks are not supported; on-screen text is part of the scenes.'],
];

const STOP_NAMES = new Set(['a', 'an', 'the', 'our', 'my', 'this', 'that', 'it', 'saas', 'app', 'product', 'brand']);

const KIND_WEIGHT: Record<SceneKind, number> = {
  title: 1,
  'kinetic-text': 1.2,
  'product-reveal': 1.4,
  'feature-list': 1.3,
  stat: 0.9,
  'logo-reveal': 1,
  'call-to-action': 1,
};

const MOOD_TRANSITIONS: Record<Mood, Transition[]> = {
  'dark-cinematic': ['fade', 'zoom', 'fade'],
  'bright-clean': ['slide-left', 'fade', 'slide-up'],
  'bold-vibrant': ['slide-left', 'wipe', 'zoom'],
  'minimal-mono': ['wipe', 'fade', 'wipe'],
  'warm-elegant': ['fade', 'fade', 'zoom'],
};

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const round1 = (v: number) => Math.round(v * 10) / 10;
const sentenceCase = (s: string) => (s ? s[0]!.toUpperCase() + s.slice(1) : s);

export function extractDuration(brief: string): number | null {
  const m = brief.match(/(\d+(?:\.\d+)?)\s*-?\s*(?:seconds?|secs?|s)\b/i);
  return m ? clamp(Number(m[1]), 2, 120) : null;
}

export function extractProductName(brief: string): string | null {
  // A name is 1-3 words; dots are allowed only inside a word (e.g. "Nova.ai"), never before a space.
  const word = "[A-Za-z0-9](?:[\\w&'’-]|\\.(?=\\w))*";
  const capWord = "[A-Z](?:[\\w&'’-]|\\.(?=\\w))*";
  const name = `(${word}(?:[ \\t]+${capWord}){0,2})`;
  const patterns = [
    new RegExp(`\\b(?:called|named)\\s+["“'‘]?${name}`),
    new RegExp(`\\bproduct name\\s*[:=]?\\s*["“']?${name}`, 'i'),
    new RegExp(`\\b(?:[Ff]or|[Ii]ntroducing|[Mm]eet|[Ll]aunching)\\s+["“']?(${capWord}(?:[ \\t]+${capWord}){0,2})`),
  ];
  for (const p of patterns) {
    const m = brief.match(p);
    const name = m?.[1]?.replace(/[.,;:!?'’"]+$/, '').trim();
    if (name && !STOP_NAMES.has(name.toLowerCase())) return name.slice(0, 60);
  }
  return null;
}

/** Quoted phrases of two or more words, in order. */
export function extractQuotes(brief: string): string[] {
  return Array.from(brief.matchAll(/["“]([^"”]{3,160})["”]/g))
    .map((m) => m[1]!.trim())
    .filter((q) => q.split(/\s+/).length >= 2);
}

export function extractMood(brief: string, templateId: string): Mood {
  const text = brief.toLowerCase();
  let best: Mood | null = null;
  let bestScore = 0;
  for (const [mood, words] of Object.entries(MOOD_KEYWORDS) as Array<[Mood, string[]]>) {
    const score = words.reduce((n, w) => n + (new RegExp(`\\b${w}\\b`).test(text) ? 1 : 0), 0);
    if (score > bestScore) {
      best = mood;
      bestScore = score;
    }
  }
  return best ?? TEMPLATE_DEFAULT_MOOD[templateId] ?? 'dark-cinematic';
}

export function extractColors(brief: string): string[] {
  const text = brief.toLowerCase();
  const hexes = Array.from(brief.matchAll(/#[0-9a-fA-F]{6}\b/g)).map((m) => m[0].toLowerCase());
  const named = COLOR_WORDS.map(([re, hex]) => ({ hex, index: text.search(re) }))
    .filter((c) => c.index >= 0)
    .sort((a, b) => a.index - b.index)
    .map((c) => c.hex);
  return Array.from(new Set([...hexes, ...named])).slice(0, 2);
}

export function extractUnsupported(brief: string): string[] {
  const text = brief.toLowerCase();
  return UNSUPPORTED.filter(([re]) => re.test(text)).map(([, msg]) => msg);
}

function extractUrl(brief: string): string | null {
  return brief.match(/\b(?:https?:\/\/)?((?:[\w-]+\.)+(?:com|io|dev|app|ai|co|org|net|so|xyz))\b/i)?.[1] ?? null;
}

function extractCta(brief: string): string | null {
  const m = brief.match(/\b(sign up(?: today| now| free)?|join the waitlist|get started|try it (?:free|today|now)|download now|book a demo|start (?:your )?free trial|pre-?order now|learn more)\b/i);
  return m ? sentenceCase(m[1]!.toLowerCase()) : null;
}

function extractFeatures(brief: string): string[] {
  const m = brief.match(/\bfeatures?\s*(?:like|such as|including|include|:)\s*([^.]+)/i);
  if (!m) return [];
  return m[1]!
    .split(/,|\band\b|;/)
    .map((s) => sentenceCase(s.trim().replace(/^(?:a|an|the)\s+/i, '')))
    .filter((s) => s.length > 1 && s.length <= 80)
    .slice(0, 4);
}

function extractStat(brief: string): string | null {
  const m = brief.match(/\b(\d+(?:\.\d+)?\s*(?:%|x|×)(?:\s+(?:faster|more|less|cheaper|better|growth|uptime))?)/i);
  return m ? m[1]!.replace(/\s+/g, ' ') : null;
}

function extractCategory(brief: string): string | null {
  const m = brief.match(/\b(?:fictional\s+)?([A-Za-z-]+(?:\s+[A-Za-z-]+)?)\s+(?:product|app|platform|tool|startup|brand)\b/i);
  const cat = m?.[1]?.replace(/^(?:a|an|the|fictional)\s+/i, '').trim();
  if (!cat || /^(?:a|an|the|fictional|for|of)$/i.test(cat)) return null;
  return cat;
}

/** Scene kinds for the brief, starting from the template skeleton and adding requested ones. */
export function chooseSceneKinds(brief: string, templateKinds: SceneKind[], duration: number): SceneKind[] {
  const text = brief.toLowerCase();
  const kinds = [...templateKinds];
  const ensure = (kind: SceneKind, cue: RegExp, position: 'end' | 'before-end' = 'before-end') => {
    if (!cue.test(text) || kinds.includes(kind)) return;
    const logoIdx = kinds.indexOf('logo-reveal');
    if (position === 'end' || logoIdx < 0) kinds.push(kind);
    else kinds.splice(logoIdx, 0, kind);
  };
  ensure('kinetic-text', /kinetic|word[- ]by[- ]word/);
  ensure('product-reveal', /screenshot|product shot|dashboard|\bui\b|interface|app screen|mock-?up/);
  ensure('feature-list', /\bfeatures?\b|benefits|bullet/);
  ensure('stat', /\d+(?:\.\d+)?\s*(?:%|x|×)\s|\bstats?\b|statistic/);
  ensure('logo-reveal', /\blogo\b/, 'end');
  const ctaCue = /call to action|\bcta\b|sign up|waitlist|get started|book a demo|free trial|download|visit\s/;
  if (ctaCue.test(text) && !kinds.includes('call-to-action')) {
    if (/end (?:with|on) (?:a |the )?(?:call to action|cta)/.test(text) || !kinds.includes('logo-reveal')) kinds.push('call-to-action');
    else kinds.splice(kinds.indexOf('logo-reveal'), 0, 'call-to-action');
  }
  // Roughly one scene per 2.5 seconds; drop the least essential kinds first.
  const maxScenes = clamp(Math.floor(duration / 2.5), 1, STORYBOARD_LIMITS.maxScenes);
  const dropOrder: SceneKind[] = ['stat', 'feature-list', 'kinetic-text', 'title', 'call-to-action', 'product-reveal', 'logo-reveal'];
  for (const kind of dropOrder) {
    while (kinds.length > maxScenes && kinds.includes(kind)) kinds.splice(kinds.lastIndexOf(kind), 1);
  }
  return kinds.length ? kinds : ['title'];
}

/**
 * Durations whose overlapped total (sum of durations minus transitions) ≈ target.
 * Transitions are derived from durations with transitionDurationFor, so iterate a few times.
 */
export function allocateDurations(kinds: SceneKind[], target: number): number[] {
  const weights = kinds.map((k) => KIND_WEIGHT[k]);
  const weightSum = weights.reduce((a, b) => a + b, 0);
  let sum = target;
  let durations: number[] = [];
  for (let iter = 0; iter < 4; iter++) {
    durations = weights.map((w) => clamp(round1((w / weightSum) * sum), STORYBOARD_LIMITS.minSceneDuration, STORYBOARD_LIMITS.maxSceneDuration));
    const overlap = durations.slice(1).reduce((acc, d, i) => acc + transitionDurationFor(durations[i]!, d), 0);
    sum = target + overlap;
  }
  return durations;
}

export function planFromBrief(request: PlanRequest): { storyboard: Storyboard; warnings: string[] } {
  const brief = request.brief.trim();
  const warnings: string[] = [];
  const duration = extractDuration(brief) ?? request.targetDuration;
  const name = extractProductName(brief);
  if (!name) warnings.push('No product name found in the brief; used "Your Product". Edit the text in each scene.');
  const productName = name ?? 'Your Product';
  const quotes = extractQuotes(brief);
  const taglineMatch = brief.match(/\btagline\s*[:=]?\s*["“]([^"”]{2,160})["”]/i);
  const tagline = taglineMatch?.[1]?.trim() ?? (quotes.length === 1 && quotes[0]!.split(/\s+/).length <= 8 ? quotes[0]! : '');
  const mood = extractMood(brief, request.template.id);
  const colors = extractColors(brief);
  const category = extractCategory(brief);
  const kinds = chooseSceneKinds(brief, request.template.sceneKinds, duration);
  const durations = allocateDurations(kinds, duration);
  const transitions = MOOD_TRANSITIONS[mood];
  const url = extractUrl(brief);
  const cta = extractCta(brief);

  // Kinetic phrases: sentences from quotes, split across kinetic scenes.
  const kineticCount = kinds.filter((k) => k === 'kinetic-text').length;
  const phrases = quotes
    .flatMap((q) => q.split(/(?<=[.!?])\s+/))
    .map((s) => s.replace(/[.!?]+$/, '').trim())
    .filter(Boolean);
  const phraseGroups: string[][] = Array.from({ length: kineticCount }, () => []);
  phrases.forEach((p, i) => phraseGroups[Math.min(kineticCount - 1, Math.floor((i * kineticCount) / phrases.length))]?.push(p));
  let kineticIndex = 0;

  const scenes: StoryboardScene[] = kinds.map((kind, i) => {
    const base = { kind, duration: durations[i]!, subheadline: '', items: [] as string[], transition: transitions[i % transitions.length]! };
    switch (kind) {
      case 'title':
        return {
          ...base,
          headline: tagline && !kinds.includes('logo-reveal') ? tagline : `Meet ${productName}`,
          subheadline: category ? `The ${category} platform built for what's next` : "Built for what's next",
        };
      case 'kinetic-text': {
        const group = phraseGroups[kineticIndex++] ?? [];
        if (group.length) return { ...base, headline: group.join(' '), items: group.slice(0, STORYBOARD_LIMITS.maxItems) };
        warnings.push('No quoted phrases found for kinetic text; used placeholder phrases.');
        return { ...base, headline: `Faster. Simpler. ${productName}.`, items: ['Faster', 'Simpler', productName] };
      }
      case 'product-reveal':
        return { ...base, headline: `${productName} in action`, subheadline: 'Everything you need, in one place.' };
      case 'feature-list': {
        const features = extractFeatures(brief);
        if (!features.length) warnings.push('No features listed in the brief; used placeholder feature copy.');
        return {
          ...base,
          headline: `Why teams choose ${productName}`,
          items: features.length ? features : ['Set up in minutes', 'Real-time insights', 'Built for teams'],
        };
      }
      case 'stat': {
        const statText = extractStat(brief);
        if (!statText) warnings.push('No statistic found in the brief; used a placeholder number. Replace it with a real figure.');
        return { ...base, headline: statText ?? '10x faster', subheadline: `with ${productName}` };
      }
      case 'logo-reveal':
        return { ...base, headline: productName, subheadline: tagline };
      case 'call-to-action':
        return { ...base, headline: `Try ${productName} today`, subheadline: cta ?? 'Get started', items: url ? [url] : [] };
    }
  });

  const palette: Storyboard['palette'] = {};
  if (colors[0]) palette.primary = colors[0];
  if (colors[1]) palette.secondary = colors[1];

  return {
    storyboard: {
      title: `${productName} — ${request.template.label}`,
      productName,
      tagline,
      mood,
      palette,
      scenes,
      unsupported: extractUnsupported(brief),
    },
    warnings,
  };
}

export const heuristicProvider: PlannerProvider = {
  id: 'heuristic',
  label: 'Built-in planner (offline)',
  isConfigured: () => true,
  async plan(request: PlanRequest): Promise<PlanResponse> {
    const { storyboard, warnings } = planFromBrief(request);
    return { storyboard, warnings };
  },
};
