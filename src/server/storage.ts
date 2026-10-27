/**
 * File-based project storage.
 *
 *   <dataDir>/projects/<projectId>/project.json
 *   <dataDir>/projects/<projectId>/assets/<file>
 *   <dataDir>/renders/<projectId>/<renderId>.mp4
 *
 * Every id is validated against a strict pattern before it is used in a path.
 */
import { existsSync } from 'node:fs';
import { mkdir, readdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { loadProject } from '../project/migrate';
import { sniffImageType, type BundleFile } from '../project/bundle';
import { newId } from '../project/ids';
import type { Asset, Project, ValidationIssue } from '../project/schema';
import { totalDuration } from '../engine/timeline';
import { decodeImage } from '../render/node-env';

const SAFE_ID = /^[A-Za-z0-9_-]{1,64}$/;
const SAFE_FILE = /^[A-Za-z0-9_-]{1,64}\.(png|jpg|jpeg|webp|mp4)$/;

export class StorageError extends Error {
  constructor(
    readonly status: 400 | 404 | 409 | 413 | 422,
    message: string,
    readonly issues: ValidationIssue[] = [],
  ) {
    super(message);
    this.name = 'StorageError';
  }
}

export interface ProjectSummary {
  id: string;
  name: string;
  updatedAt: string;
  width: number;
  height: number;
  fps: number;
  scenes: number;
  duration: number;
}

export async function writeFileAtomic(file: string, data: string | Uint8Array): Promise<void> {
  const tmp = `${file}.tmp-${newId('', 6)}`;
  await writeFile(tmp, data);
  await rename(tmp, file);
}

export async function writeBundleAssets(dir: string, files: BundleFile[]): Promise<void> {
  await mkdir(dir, { recursive: true });
  for (const f of files) {
    if (!SAFE_FILE.test(f.file)) throw new StorageError(400, `unsafe asset file name "${f.file}"`);
    await writeFile(path.join(dir, f.file), f.data);
  }
}

export class ProjectStore {
  readonly projectsDir: string;
  readonly rendersRoot: string;

  constructor(readonly dataDir: string) {
    this.projectsDir = path.join(dataDir, 'projects');
    this.rendersRoot = path.join(dataDir, 'renders');
  }

  private dir(id: string): string {
    if (!SAFE_ID.test(id)) throw new StorageError(400, 'invalid project id');
    return path.join(this.projectsDir, id);
  }

  assetsDir(id: string): string {
    return path.join(this.dir(id), 'assets');
  }

  rendersDir(id: string): string {
    this.dir(id);
    return path.join(this.rendersRoot, id);
  }

  async list(): Promise<ProjectSummary[]> {
    if (!existsSync(this.projectsDir)) return [];
    const summaries: ProjectSummary[] = [];
    for (const id of await readdir(this.projectsDir)) {
      if (!SAFE_ID.test(id)) continue;
      try {
        const p = await this.get(id);
        summaries.push({
          id: p.id,
          name: p.name,
          updatedAt: p.updatedAt,
          width: p.settings.width,
          height: p.settings.height,
          fps: p.settings.fps,
          scenes: p.scenes.length,
          duration: totalDuration(p.scenes),
        });
      } catch (err) {
        // A corrupt project must not hide the others; it is reported when opened directly.
        console.warn(`[storage] skipping project ${id}: ${(err as Error).message}`);
      }
    }
    return summaries.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  async get(id: string): Promise<Project> {
    const file = path.join(this.dir(id), 'project.json');
    let raw: string;
    try {
      raw = await readFile(file, 'utf8');
    } catch {
      throw new StorageError(404, `project "${id}" not found`);
    }
    let json: unknown;
    try {
      json = JSON.parse(raw);
    } catch (err) {
      throw new StorageError(422, `project file is not valid JSON: ${(err as Error).message}`);
    }
    const parsed = loadProject(json);
    if (!parsed.ok) throw new StorageError(422, 'stored project failed validation', parsed.issues);
    return parsed.value;
  }

  /** Validate and write a project. `mustExist` guards updates against typos in ids. */
  async save(input: unknown, opts: { mustExist?: boolean; touch?: boolean } = {}): Promise<Project> {
    const parsed = loadProject(input);
    if (!parsed.ok) throw new StorageError(422, 'project failed validation', parsed.issues);
    const project = opts.touch === false ? parsed.value : { ...parsed.value, updatedAt: new Date().toISOString() };
    const dir = this.dir(project.id);
    if (opts.mustExist && !existsSync(path.join(dir, 'project.json'))) throw new StorageError(404, `project "${project.id}" not found`);
    await mkdir(path.join(dir, 'assets'), { recursive: true });
    await writeFileAtomic(path.join(dir, 'project.json'), `${JSON.stringify(project, null, 2)}\n`);
    return project;
  }

  async delete(id: string): Promise<void> {
    const dir = this.dir(id);
    if (!existsSync(dir)) throw new StorageError(404, `project "${id}" not found`);
    await rm(dir, { recursive: true, force: true });
    await rm(this.rendersDir(id), { recursive: true, force: true });
  }

  /** Store an uploaded image and return its asset record (not yet referenced by the project). */
  async addAsset(id: string, originalName: string, data: Uint8Array): Promise<Asset> {
    const dir = this.dir(id);
    if (!existsSync(path.join(dir, 'project.json'))) throw new StorageError(404, `project "${id}" not found`);
    const mimeType = sniffImageType(data);
    if (!mimeType) throw new StorageError(400, 'only PNG, JPEG and WebP images are supported');
    let width: number;
    let height: number;
    try {
      const img = await decodeImage(Buffer.from(data));
      width = img.width;
      height = img.height;
    } catch (err) {
      throw new StorageError(400, `could not decode image: ${(err as Error).message}`);
    }
    const assetId = newId('asset');
    const ext = mimeType === 'image/png' ? 'png' : mimeType === 'image/jpeg' ? 'jpg' : 'webp';
    const file = `${assetId}.${ext}`;
    await mkdir(path.join(dir, 'assets'), { recursive: true });
    await writeFile(path.join(dir, 'assets', file), data);
    const name = originalName.replace(/[^\w .()-]/g, '').slice(0, 200) || file;
    return { id: assetId, kind: 'image', name, file, mimeType, width, height };
  }

  async readAssetFile(id: string, file: string): Promise<BundleFile> {
    if (!SAFE_FILE.test(file)) throw new StorageError(400, 'invalid file name');
    try {
      return { file, data: new Uint8Array(await readFile(path.join(this.assetsDir(id), file))) };
    } catch {
      throw new StorageError(404, `asset file "${file}" not found`);
    }
  }

  async listRenders(id: string): Promise<Array<{ file: string; size: number; createdAt: string }>> {
    const dir = this.rendersDir(id);
    if (!existsSync(dir)) return [];
    const out = [];
    for (const file of await readdir(dir)) {
      if (!/^[A-Za-z0-9_-]+\.mp4$/.test(file)) continue;
      const s = await stat(path.join(dir, file));
      out.push({ file, size: s.size, createdAt: s.mtime.toISOString() });
    }
    return out.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  renderFilePath(id: string, file: string): string {
    if (!/^[A-Za-z0-9_-]+\.mp4$/.test(file)) throw new StorageError(400, 'invalid render file name');
    return path.join(this.rendersDir(id), file);
  }
}
