/** Browser helpers for spike pages: the engine's fonts, a render env, and result reporting. */
import { FONT_FACES } from '../../src/engine/fonts';
import type { Ctx2D, RenderEnv } from '../../src/engine/types';

let fontsPromise: Promise<void> | null = null;

/** Load the engine's woff2 files straight from node_modules (served by the Vite dev server). */
export function loadEngineFonts(): Promise<void> {
  fontsPromise ??= Promise.all(
    FONT_FACES.map(async (f) => {
      const face = new FontFace(f.family, `url(/node_modules/@fontsource/${f.pkg}/files/${f.file})`, {
        weight: String(f.weight),
      });
      await face.load();
      document.fonts.add(face);
    }),
  ).then(() => undefined);
  return fontsPromise;
}

export function createSpikeEnv(): RenderEnv {
  return {
    assets: { get: () => undefined },
    pixelRatio: 1,
    createSurface(width, height) {
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      return { canvas, ctx: canvas.getContext('2d') as Ctx2D };
    },
  };
}

declare global {
  interface Window {
    /** Latest spike result, for scripted runs (read it from DevTools or a test driver). */
    __spikeResult?: unknown;
  }
}

/** Show a result as JSON on the page and expose it on window.__spikeResult. */
export function report(el: HTMLElement, result: unknown): void {
  window.__spikeResult = result;
  el.textContent = JSON.stringify(result, null, 2);
}

export function $(id: string): HTMLElement {
  const el = document.getElementById(id);
  if (!el) throw new Error(`missing #${id}`);
  return el;
}

export function formatBytes(n: number): string {
  return n > 1e6 ? `${(n / 1e6).toFixed(1)} MB` : `${(n / 1e3).toFixed(0)} kB`;
}

/** Load a file chosen in an <input type=file>, or fetch `?src=` (a path served by Vite). */
export async function pickSource(input: HTMLInputElement, param = 'src'): Promise<{ blob: Blob; name: string } | null> {
  const file = input.files?.[0];
  if (file) return { blob: file, name: file.name };
  const src = new URLSearchParams(location.search).get(param);
  if (!src) return null;
  const res = await fetch(src);
  if (!res.ok) throw new Error(`could not fetch ${src}: HTTP ${res.status}`);
  return { blob: await res.blob(), name: src };
}
