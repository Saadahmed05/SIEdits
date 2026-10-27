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

export const MOOD_STYLES: Record<Mood, MoodStyle> = {
  'dark-cinematic': {
    label: 'Dark cinematic',
    brand: {
      primary: '#7c5cff',
      secondary: '#00d4ff',
      accent: '#b9a8ff',
      background: '#07080d',
      text: '#f5f6fa',
      headingFont: 'Inter',
      bodyFont: 'Inter',
    },
    background: {
      type: 'radial-gradient',
      cx: 0.5,
      cy: 0.35,
      stops: [
        { offset: 0, color: '#1a1533' },
        { offset: 0.6, color: '@background' },
        { offset: 1, color: '@background' },
      ],
      vignette: 0.5,
    },
    emphasisBackground: {
      type: 'radial-gradient',
      cx: 0.5,
      cy: 0.5,
      stops: [
        { offset: 0, color: '#241a4d' },
        { offset: 0.7, color: '@background' },
        { offset: 1, color: '@background' },
      ],
      vignette: 0.6,
    },
    particles: true,
    glow: true,
  },
  'bright-clean': {
    label: 'Bright & clean',
    brand: {
      primary: '#2f6bff',
      secondary: '#00b894',
      accent: '#ffb020',
      background: '#f7f8fb',
      text: '#0f172a',
      headingFont: 'Inter',
      bodyFont: 'Inter',
    },
    background: {
      type: 'linear-gradient',
      angle: 120,
      stops: [
        { offset: 0, color: '#ffffff' },
        { offset: 1, color: '@background' },
      ],
      rotateSpeed: 0,
      vignette: 0,
    },
    emphasisBackground: {
      type: 'linear-gradient',
      angle: 135,
      stops: [
        { offset: 0, color: '#eef3ff' },
        { offset: 1, color: '#ffffff' },
      ],
      rotateSpeed: 0,
      vignette: 0,
    },
    particles: false,
    glow: false,
  },
  'bold-vibrant': {
    label: 'Bold & vibrant',
    brand: {
      primary: '#ff3d81',
      secondary: '#ffb300',
      accent: '#00e5ff',
      background: '#12002e',
      text: '#ffffff',
      headingFont: 'Space Grotesk',
      bodyFont: 'Inter',
    },
    background: {
      type: 'linear-gradient',
      angle: 135,
      stops: [
        { offset: 0, color: '@background' },
        { offset: 1, color: '#3b0a5c' },
      ],
      rotateSpeed: 6,
      vignette: 0.3,
    },
    emphasisBackground: {
      type: 'linear-gradient',
      angle: 45,
      stops: [
        { offset: 0, color: '#3b0a5c' },
        { offset: 1, color: '@background' },
      ],
      rotateSpeed: 8,
      vignette: 0.3,
    },
    particles: true,
    glow: true,
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
    background: {
      type: 'radial-gradient',
      cx: 0.3,
      cy: 0.3,
      stops: [
        { offset: 0, color: '#2e221a' },
        { offset: 1, color: '@background' },
      ],
      vignette: 0.4,
    },
    emphasisBackground: {
      type: 'radial-gradient',
      cx: 0.5,
      cy: 0.5,
      stops: [
        { offset: 0, color: '#3a2a1e' },
        { offset: 1, color: '@background' },
      ],
      vignette: 0.5,
    },
    particles: false,
    glow: false,
  },
};
