/**
 * Environment the engine needs from its host (browser or Node). Keeping these as interfaces
 * lets the same drawing code run on an HTMLCanvasElement and on @napi-rs/canvas.
 */

/** The subset of CanvasRenderingContext2D the engine uses. Both browsers and @napi-rs/canvas satisfy it. */
export type Ctx2D = CanvasRenderingContext2D;

/** Anything drawable with ctx.drawImage and with known pixel dimensions. */
export interface Drawable {
  readonly width: number;
  readonly height: number;
}

export interface Surface {
  readonly ctx: Ctx2D;
  /** The underlying canvas, passed to drawImage when compositing. */
  readonly canvas: Drawable;
}

export interface AssetResolver {
  /** A decoded image for the asset id, or undefined if missing / not loaded yet. */
  get(assetId: string): Drawable | undefined;
}

export interface RenderEnv {
  assets: AssetResolver;
  /** Create an offscreen surface of the given pixel size (used for scene transitions). */
  createSurface(width: number, height: number): Surface;
  /** Device pixels per project pixel (e.g. 0.5 for a half-resolution preview). */
  pixelRatio: number;
  /** Draw placeholders for missing assets instead of skipping them (editor preview). */
  showMissingAssets?: boolean;
}

/** Axis-aligned box of a drawn element in project pixels, used for hit testing in the editor. */
export interface ElementBox {
  sceneId: string;
  elementId: string;
  x: number;
  y: number;
  width: number;
  height: number;
}
