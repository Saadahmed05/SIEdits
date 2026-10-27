/** Node implementations of the engine environment, backed by @napi-rs/canvas (Skia). */
import { createRequire } from 'node:module';
import path from 'node:path';
import { createCanvas, GlobalFonts, loadImage, type Image } from '@napi-rs/canvas';
import { FONT_FACES } from '../engine/fonts';
import type { AssetResolver, Ctx2D, Drawable, RenderEnv } from '../engine/types';

const require = createRequire(import.meta.url);
let fontsRegistered = false;

/** Absolute path of a bundled font file inside node_modules/@fontsource. */
export function fontFilePath(pkg: string, file: string): string {
  const pkgJson = require.resolve(`@fontsource/${pkg}/package.json`);
  return path.join(path.dirname(pkgJson), 'files', file);
}

/** Register every bundled font with Skia once per process. Throws if a font file is missing. */
export function registerFonts(): void {
  if (fontsRegistered) return;
  for (const face of FONT_FACES) {
    const file = fontFilePath(face.pkg, face.file);
    const key = GlobalFonts.registerFromPath(file, face.family);
    if (!key) throw new Error(`failed to register font ${face.family} ${face.weight} from ${file}`);
  }
  fontsRegistered = true;
}

export function mapAssetResolver(images: Map<string, Image>): AssetResolver {
  return { get: (id) => images.get(id) as Drawable | undefined };
}

export function createNodeEnv(assets: AssetResolver, pixelRatio = 1): RenderEnv {
  return {
    assets,
    pixelRatio,
    createSurface(width, height) {
      const canvas = createCanvas(width, height);
      return { canvas, ctx: canvas.getContext('2d') as unknown as Ctx2D };
    },
  };
}

export async function decodeImage(data: Buffer): Promise<Image> {
  return loadImage(data);
}
