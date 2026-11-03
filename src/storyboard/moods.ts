import type { Background, Brand } from '../project/schema';
import type { Mood } from './schema';

export interface MoodStyle {
  label: string;
  brand: Brand;
  /** Background used by most scenes; may reference brand tokens. */
  background: Background;
  /** Alternate background for emphasis scenes (logo, stat). */
  emphasisBackground: Background;
  /** Add drifting particles to hero scenes. */
  particles: boolean;
  /** Glow on headings. */
  glow: boolean;
}

/**
 * Default looks are flat and typographic: solid backgrounds, no glow, no particles. Gradients and
 * effects remain available to anyone who adds them on purpose, but are never the starting point.
 * tests/style-rules.test.ts holds these defaults to that.
 */
export const MOOD_STYLES: Record<Mood, MoodStyle> = {
  'dark-cinematic': {
    label: 'Dark cinematic',
    brand: {
      primary: '#d98a3d',
      secondary: '#8f8f93',
      accent: '#e8d3b8',
      background: '#0e0e0f',
      text: '#f2f0eb',
      headingFont: 'Inter',
      bodyFont: 'Inter',
    },
    background: { type: 'solid', color: '@background' },
    emphasisBackground: { type: 'solid', color: '#171718' },
    particles: false,
    glow: false,
  },
  'bright-clean': {
    label: 'Bright & clean',
    brand: {
      primary: '#2f6bff',
      secondary: '#00806a',
      accent: '#b35c00',
      background: '#f7f7f5',
      text: '#141415',
      headingFont: 'Inter',
      bodyFont: 'Inter',
    },
    background: { type: 'solid', color: '@background' },
    emphasisBackground: { type: 'solid', color: '#ffffff' },
    particles: false,
    glow: false,
  },
  'bold-vibrant': {
    label: 'Bold & vibrant',
    brand: {
      primary: '#ff4d2e',
      secondary: '#ffc400',
      accent: '#f2f0eb',
      background: '#111112',
      text: '#ffffff',
      headingFont: 'Space Grotesk',
      bodyFont: 'Inter',
    },
    background: { type: 'solid', color: '@background' },
    emphasisBackground: { type: 'solid', color: '#1c1c1d' },
    particles: false,
    glow: false,
  },
  'minimal-mono': {
    label: 'Minimal mono',
    brand: {
      primary: '#ffffff',
      secondary: '#8a8a8a',
      accent: '#e5e5e5',
      background: '#0d0d0d',
      text: '#ffffff',
      headingFont: 'Space Grotesk',
      bodyFont: 'Inter',
    },
    background: { type: 'solid', color: '@background' },
    emphasisBackground: { type: 'solid', color: '#151515' },
    particles: false,
    glow: false,
  },
  'warm-elegant': {
    label: 'Warm & elegant',
    brand: {
      primary: '#d4a373',
      secondary: '#e9c46a',
      accent: '#f4e3c1',
      background: '#1a1410',
      text: '#fbf6ee',
      headingFont: 'Playfair Display',
      bodyFont: 'Inter',
    },
    background: { type: 'solid', color: '@background' },
    emphasisBackground: { type: 'solid', color: '#241b15' },
    particles: false,
    glow: false,
  },
};
