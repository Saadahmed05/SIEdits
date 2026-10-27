import type { SceneKind } from './schema';

export interface Template {
  id: string;
  label: string;
  description: string;
  /** Scene kinds the deterministic planner uses as a skeleton, in order. */
  sceneKinds: SceneKind[];
  defaultBrief: string;
}

export const TEMPLATES: Template[] = [
  {
    id: 'product-launch',
    label: 'Product launch',
    description: 'Title, product reveal and logo outro; adds features, stats or a call to action when the brief asks.',
    sceneKinds: ['title', 'product-reveal', 'logo-reveal'],
    defaultBrief:
      'Create a 12-second cinematic launch animation for a fictional SaaS product called Nova. Use a dark background, glowing typography, a product screenshot reveal, smooth transitions, and an animated final logo.',
  },
  {
    id: 'kinetic-typography',
    label: 'Kinetic typography',
    description: 'Punchy word-by-word text animation.',
    sceneKinds: ['kinetic-text', 'kinetic-text', 'call-to-action'],
    defaultBrief: 'A bold 8-second kinetic typography teaser for Orbit: "Plan less. Ship more. Stay in orbit." End with a call to action to visit orbit.dev.',
  },
  {
    id: 'logo-reveal',
    label: 'Logo reveal',
    description: 'A single animated logo sting with tagline.',
    sceneKinds: ['logo-reveal'],
    defaultBrief: 'A 4-second elegant logo reveal for Atelier with the tagline "Crafted to last".',
  },
  {
    id: 'blank',
    label: 'Blank',
    description: 'One empty scene to build from scratch.',
    sceneKinds: ['title'],
    defaultBrief: '',
  },
];

export function getTemplate(id: string): Template {
  return TEMPLATES.find((t) => t.id === id) ?? TEMPLATES[0]!;
}
