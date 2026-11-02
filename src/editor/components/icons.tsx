/** Interface icons: drawn on a 16 px grid in one stroke weight, so they stay consistent across systems. */
const PATHS = {
  back: 'M10 3 5 8l5 5',
  undo: 'M6 3 3 6l3 3M3 6h6a4 4 0 0 1 0 8H6',
  redo: 'm10 3 3 3-3 3M13 6H7a4 4 0 0 0 0 8h3',
  start: 'M4 3v10M13 3 6 8l7 5z',
  up: 'M8 13V3M4 7l4-4 4 4',
  down: 'M8 3v10M4 9l4 4 4-4',
  duplicate: 'M6 6h7v7H6zM3 10V3h7',
  close: 'm4 4 8 8M12 4l-8 8',
} as const;

const FILLED = {
  play: 'M4 2.5v11l9-5.5z',
  pause: 'M4 3h3v10H4zM9 3h3v10H9z',
} as const;

export type IconName = keyof typeof PATHS | keyof typeof FILLED;

export function Icon({ name }: { name: IconName }) {
  const filled = name === 'play' || name === 'pause';
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true" fill={filled ? 'currentColor' : 'none'} stroke={filled ? 'none' : 'currentColor'} strokeWidth="1.5" strokeLinecap="square">
      <path d={filled ? FILLED[name] : PATHS[name]} />
    </svg>
  );
}
