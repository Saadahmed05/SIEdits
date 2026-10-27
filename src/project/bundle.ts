/**
 * Export bundles: a single JSON file containing the project and its asset files (base64), so
 * a project can be moved between machines and re-rendered reproducibly. Node-only (Buffer).
 */
import { z } from 'zod';
import { loadProject } from './migrate';
import type { Project, ValidationIssue } from './schema';

export const BUNDLE_FORMAT = 'scenewright.bundle';
export const BUNDLE_VERSION = 1;
export const MAX_ASSET_BYTES = 25 * 1024 * 1024;

const BundleSchema = z.strictObject({
  format: z.literal(BUNDLE_FORMAT),
  version: z.literal(BUNDLE_VERSION),
  project: z.unknown(),
  assets: z.record(
    z.string(),
    z.strictObject({ mimeType: z.string(), data: z.string().regex(/^[A-Za-z0-9+/]*={0,2}$/, 'invalid base64') }),
  ),
});

export interface BundleFile {
  file: string;
  data: Uint8Array;
}

export function isBundle(value: unknown): boolean {
  return typeof value === 'object' && value !== null && (value as { format?: unknown }).format === BUNDLE_FORMAT;
}

/** Detect the image type from magic bytes; never trust the declared type alone. */
export function sniffImageType(data: Uint8Array): 'image/png' | 'image/jpeg' | 'image/webp' | null {
  if (data.length >= 8 && data[0] === 0x89 && data[1] === 0x50 && data[2] === 0x4e && data[3] === 0x47) return 'image/png';
  if (data.length >= 3 && data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff) return 'image/jpeg';
  if (
    data.length >= 12 &&
    String.fromCharCode(...data.subarray(0, 4)) === 'RIFF' &&
    String.fromCharCode(...data.subarray(8, 12)) === 'WEBP'
  )
    return 'image/webp';
  return null;
}

export function packBundle(project: Project, files: BundleFile[]): unknown {
  const assets: Record<string, { mimeType: string; data: string }> = {};
  for (const asset of project.assets) {
    const f = files.find((x) => x.file === asset.file);
    if (f) assets[asset.file] = { mimeType: asset.mimeType, data: Buffer.from(f.data).toString('base64') };
  }
  return { format: BUNDLE_FORMAT, version: BUNDLE_VERSION, project, assets };
}

export function unpackBundle(
  input: unknown,
): { ok: true; project: Project; files: BundleFile[] } | { ok: false; issues: ValidationIssue[] } {
  const parsed = BundleSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, issues: parsed.error.issues.map((i) => ({ path: i.path.join('.') || '(root)', message: i.message })) };
  }
  const loaded = loadProject(parsed.data.project);
  if (!loaded.ok) return { ok: false, issues: loaded.issues.map((i) => ({ ...i, path: `project.${i.path}` })) };
  const project = loaded.value;
  const issues: ValidationIssue[] = [];
  const files: BundleFile[] = [];
  project.assets.forEach((asset, i) => {
    const entry = parsed.data.assets[asset.file];
    if (!entry) return; // Allowed: rendering will report the asset as missing if it is used.
    const data = new Uint8Array(Buffer.from(entry.data, 'base64'));
    if (data.byteLength > MAX_ASSET_BYTES) {
      issues.push({ path: `assets.${asset.file}`, message: `asset is larger than ${MAX_ASSET_BYTES} bytes` });
      return;
    }
    const sniffed = sniffImageType(data);
    if (!sniffed || sniffed !== asset.mimeType) {
      issues.push({ path: `project.assets[${i}]`, message: `file content is not a ${asset.mimeType} image` });
      return;
    }
    files.push({ file: asset.file, data });
  });
  for (const key of Object.keys(parsed.data.assets)) {
    if (!project.assets.some((a) => a.file === key)) issues.push({ path: `assets.${key}`, message: 'not referenced by any project asset' });
  }
  return issues.length ? { ok: false, issues } : { ok: true, project, files };
}
