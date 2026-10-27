/** Browser implementations of the engine environment: fonts, images, offscreen surfaces. */
import { useEffect, useMemo, useState } from 'react';
import { FONT_FACES } from '../engine/fonts';
import type { AssetResolver, Ctx2D, Drawable, RenderEnv } from '../engine/types';
import type { Project } from '../project/schema';
import { api } from './api';

let fontsPromise: Promise<void> | null = null;

/** Load the same woff2 files the exporter uses, so preview text metrics match the export. */
export function loadFonts(): Promise<void> {
  fontsPromise ??= Promise.all(
    FONT_FACES.map(async (f) => {
      const face = new FontFace(f.family, `url(/fonts/${f.pkg}/${f.file})`, { weight: String(f.weight), style: 'normal' });
      await face.load();
      document.fonts.add(face);
    }),
  ).then(() => undefined);
  return fontsPromise;
}

export function useFontsReady(): boolean {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    loadFonts()
      .catch((err) => console.error('Font loading failed; preview may differ from export', err))
      .finally(() => setReady(true));
  }, []);
  return ready;
}

const imageCache = new Map<string, Promise<HTMLImageElement>>();

function loadImage(url: string): Promise<HTMLImageElement> {
  let p = imageCache.get(url);
  if (!p) {
    p = new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error(`could not load ${url}`));
      img.src = url;
    });
    imageCache.set(url, p);
  }
  return p;
}

/** Decoded images for the project's assets; `version` changes when new images finish loading. */
export function useAssetResolver(project: Project): { resolver: AssetResolver; version: number } {
  const [images, setImages] = useState<Map<string, HTMLImageElement>>(new Map());
  const key = project.assets.map((a) => `${a.id}:${a.file}`).join('|');
  useEffect(() => {
    let cancelled = false;
    Promise.all(
      project.assets.map((a) =>
        loadImage(api.assetUrl(project.id, a.file))
          .then((img) => [a.id, img] as const)
          .catch(() => null),
      ),
    ).then((entries) => {
      if (!cancelled) setImages(new Map(entries.filter((e) => e !== null)));
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project.id, key]);
  const resolver = useMemo<AssetResolver>(() => ({ get: (id) => images.get(id) as Drawable | undefined }), [images]);
  return { resolver, version: images.size };
}

export function createBrowserEnv(assets: AssetResolver, pixelRatio: number): RenderEnv {
  return {
    assets,
    pixelRatio,
    showMissingAssets: true,
    createSurface(width, height) {
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      return { canvas, ctx: canvas.getContext('2d') as Ctx2D };
    },
  };
}
